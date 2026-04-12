/**
 * store.js — Central data access layer.
 *
 * Per-subject file layout:
 *
 *   data/
 *   ├── config.json                          { activeYear }
 *   ├── observaties/
 *   │   └── <obsId>.json                     { id, naam, icon, jaarlagen[], subject }
 *   └── YYYY-YYYY/
 *       ├── students-YYYY-YYYY.json          [{ id, voornaam, … }]
 *       ├── exams/
 *       │   └── <examId>.json                { id, subject, title, jaarlaag, … }
 *       ├── groups/
 *       │   └── <groupId>.json               { id, subject, name, jaarlaag, student_ids[] }
 *       └── scores/
 *           ├── nat/  bio/  schk/  wi/
 *           │   └── <studentId>.json
 *
 * Subject field inside each JSON file is authoritative (not derived from path).
 */

/** Returns the kind of a question: 'normal' | 'bonus' | 'diag'. Absence means 'normal'. */
function qKind(q) {
  return q.kind ?? 'normal';
}

const Store = (() => {
  // ── Cache ─────────────────────────────────────────────────────────────────
  // Exam/group/obs entries keyed as: `${year}/exams/${subject}`, `obs/${subject}`, etc.
  const cache = {};
  let _years = null;
  let _activeSubject = null;

  async function load(relPath) {
    if (cache[relPath] !== undefined) return cache[relPath];
    const data = await window.rtti.readJson(relPath);
    cache[relPath] = data;
    return data;
  }

  async function save(relPath, data) {
    cache[relPath] = data;
    const result = await window.rtti.writeJson(relPath, data);
    if (!result?.ok) throw new Error(`Save failed for ${relPath}: ${result?.reason}`);
  }

  function invalidate(relPath) {
    delete cache[relPath];
  }

  // ── Active subject ─────────────────────────────────────────────────────────
  function setActiveSubject(s) {
    _activeSubject = s;
  }
  function getActiveSubject() {
    return _activeSubject;
  }

  // ── Path helpers ──────────────────────────────────────────────────────────
  const ypStudents = (year) => `${year}/students-${year}.json`;
  const ypExam = (year, id) => `${year}/exams/${id}.json`;
  const ypGroup = (year, id) => `${year}/groups/${id}.json`;
  const ypObs = (id) => `observaties/${id}.json`;
  const ypScore = (year, subj, id) => `${year}/scores/${subj}/${id}.json`;

  // ── Subject helpers ────────────────────────────────────────────────────────
  const SUBJECT_DISPLAY = {
    nat: 'Natuurkunde',
    bio: 'Biologie',
    schk: 'Scheikunde',
    wi: 'Wiskunde',
  };

  // Wiskunde sub-variants: wisob = onderbouw (jn 1-3), wisa/b/c/d = bovenbouw (jn 4-6)
  const WI_VARIANTS = new Set(['wisob', 'wisa', 'wisb', 'wisc', 'wisd']);

  function obsMatchesSubject(obs, subject) {
    const subjectsArr = Array.isArray(obs.subjects)
      ? obs.subjects
      : obs.subject
        ? [obs.subject]
        : [];
    if (subject === 'wi') return subjectsArr.some((s) => WI_VARIANTS.has(s));
    return subjectsArr.includes(subject);
  }

  function invalidateObsCache() {
    for (const key of Object.keys(cache)) {
      if (key.startsWith('obs/')) delete cache[key];
    }
  }

  function subjectFromGroupName(name) {
    const n = (name ?? '').toLowerCase();
    if (/nat/.test(n)) return 'nat';
    if (/biol/.test(n)) return 'bio';
    if (/schk/.test(n)) return 'schk';
    if (/wi/.test(n)) return 'wi';
    return null;
  }

  /**
   * Derive jaarlaag (and subcategory for wiskunde) from a group name.
   * Returns { jaarlaag: string|null, subcategory: string|null }
   * subcategory is only set when subject === 'wi'.
   */
  function parseGroupName(name, subject) {
    const n = (name ?? '').toLowerCase();
    const jlMatch = n.match(/^(\d+)/);
    const jaarlaag = jlMatch ? jlMatch[1] : null;

    let subcategory = null;
    if (subject === 'wi') {
      if (/wisd/.test(n)) subcategory = 'wisd';
      else if (/wisc/.test(n)) subcategory = 'wisc';
      else if (/wisb/.test(n)) subcategory = 'wisb';
      else if (/wisa/.test(n)) subcategory = 'wisa';
      else if (/awi/.test(n) || /bwi/.test(n)) {
        // common patterns like 4awi, 5bwi — treat as wisa/wisb if detectable
        subcategory = null;
      }
      if (!subcategory && jaarlaag && parseInt(jaarlaag, 10) <= 3) {
        subcategory = 'onderbouw';
      }
    }

    return { jaarlaag, subcategory };
  }

  // ── Year management ───────────────────────────────────────────────────────
  async function refreshYears() {
    _years = await window.rtti.listYears();
    return _years;
  }

  function listYearsSync() {
    return _years ?? [];
  }

  // ── Load functions (subject-scoped) ───────────────────────────────────────
  async function loadExams(year, subject) {
    const key = `${year}/exams/${subject}`;
    if (cache[key] !== undefined) return cache[key];
    const all = await window.rtti.readAllJson(`${year}/exams`);
    cache[key] = all.filter((e) => e.subject === subject);
    return cache[key];
  }

  async function loadGroups(year, subject) {
    const key = `${year}/groups/${subject}`;
    if (cache[key] !== undefined) return cache[key];
    const all = await window.rtti.readAllJson(`${year}/groups`);
    cache[key] = all.filter((g) => g.subject === subject);
    return cache[key];
  }

  async function loadObservaties(subject) {
    const key = `obs/${subject}`;
    if (cache[key] !== undefined) return cache[key];
    const all = await window.rtti.readAllJson('observaties');
    cache[key] = all.filter((o) => obsMatchesSubject(o, subject));
    return cache[key];
  }

  async function loadYear(year, subject = _activeSubject) {
    await window.rtti.ensureYear(year);
    const tasks = [load(ypStudents(year))];
    if (subject) {
      tasks.push(loadExams(year, subject));
      tasks.push(loadGroups(year, subject));
    }
    await Promise.all(tasks);
    if (_years && !_years.includes(year)) {
      _years.push(year);
      _years.sort((a, b) => b.localeCompare(a));
    }
  }

  // ── Preload: warm config + year list before startup screen ────────────────
  async function preload() {
    await migrate();
    _years = await window.rtti.listYears();
    await load('config.json');
    _years = await window.rtti.listYears();
  }

  async function initSubject(subject) {
    setActiveSubject(subject);
    const year = getConfigSync().activeYear ?? currentSchoolYear();
    await Promise.all([loadYear(year, subject), loadObservaties(subject)]);
  }

  // ── Sync getters (safe after preload / loadYear / initSubject) ────────────
  function getConfigSync() {
    return cache['config.json'] ?? { activeYear: currentSchoolYear() };
  }
  function getStudentsSync(year) {
    return cache[ypStudents(year)] ?? [];
  }
  function getGroupsSync(year, subject = _activeSubject) {
    return cache[`${year}/groups/${subject}`] ?? [];
  }
  function getExamsSync(year, subject = _activeSubject) {
    return cache[`${year}/exams/${subject}`] ?? [];
  }
  function getObservatiesSync(subject = _activeSubject) {
    return cache[`obs/${subject}`] ?? [];
  }

  // ── Config ────────────────────────────────────────────────────────────────
  async function getConfig() {
    return (await load('config.json')) ?? { activeYear: currentSchoolYear() };
  }

  async function setActiveYear(year) {
    const cfg = await getConfig();
    cfg.activeYear = year;
    await save('config.json', cfg);
  }

  function currentSchoolYear() {
    const now = new Date(),
      y = now.getFullYear();
    return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  }

  // ── Student helpers ───────────────────────────────────────────────────────
  function fullName(s) {
    if (s.voornaam || s.achternaam)
      return [s.voornaam, s.tussenvoegsel, s.achternaam].filter(Boolean).join(' ');
    return s.name ?? `#${s.id}`;
  }

  function jaarlaagFromStamklas(stamklas) {
    const m = String(stamklas ?? '').match(/^(\d+)/);
    return m ? m[1] : '';
  }

  function sortStudents(list) {
    list.sort((a, b) => {
      const ja = jaarlaagFromStamklas(a.stamklas),
        jb = jaarlaagFromStamklas(b.stamklas);
      const jcmp = ja.localeCompare(jb, undefined, { numeric: true });
      if (jcmp !== 0) return jcmp;
      const scmp = (a.stamklas ?? '').localeCompare(b.stamklas ?? '');
      if (scmp !== 0) return scmp;
      return (a.achternaam ?? '').localeCompare(b.achternaam ?? '');
    });
    return list;
  }

  // ── Students (year-scoped) ────────────────────────────────────────────────
  async function getStudents(year) {
    return (await load(ypStudents(year))) ?? [];
  }

  async function saveStudents(list, year) {
    sortStudents(list);
    await save(ypStudents(year), list);
  }

  async function upsertStudent(student, year) {
    const list = await getStudents(year);
    const flat = {
      id: student.id,
      voornaam: student.voornaam ?? '',
      tussenvoegsel: student.tussenvoegsel ?? '',
      achternaam: student.achternaam ?? student.name ?? '',
      stamklas: student.stamklas ?? '',
      geslacht: student.geslacht ?? '',
    };
    const idx = list.findIndex((s) => s.id === flat.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...flat };
    else list.push(flat);
    await saveStudents(list, year);
  }

  async function upsertStudents(students, year) {
    const list = await getStudents(year);
    for (const student of students) {
      const flat = {
        id: student.id,
        voornaam: student.voornaam ?? '',
        tussenvoegsel: student.tussenvoegsel ?? '',
        achternaam: student.achternaam ?? student.name ?? '',
        stamklas: student.stamklas ?? '',
        geslacht: student.geslacht ?? '',
      };
      const idx = list.findIndex((s) => s.id === flat.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...flat };
      else list.push(flat);
    }
    await saveStudents(list, year);
  }

  async function deleteStudent(id, year) {
    const list = await getStudents(year);
    await saveStudents(
      list.filter((s) => s.id !== id),
      year
    );
  }

  // ── Groups (year-scoped, subject-filtered) ────────────────────────────────
  async function getGroups(year, subject = _activeSubject) {
    return loadGroups(year, subject);
  }

  async function upsertGroup(group, year) {
    const subj = group.subject ?? subjectFromGroupName(group.name) ?? _activeSubject;
    const { academic_year: _ay, ...clean } = group;
    const updated = { ...clean, subject: subj };
    await window.rtti.writeJson(ypGroup(year, updated.id), updated);
    const key = `${year}/groups/${subj}`;
    const arr = cache[key] ?? [];
    const i = arr.findIndex((g) => g.id === updated.id);
    if (i >= 0) arr[i] = updated;
    else arr.push(updated);
    cache[key] = arr;
  }

  async function upsertGroups(groups, year) {
    for (const group of groups) {
      await upsertGroup(group, year);
    }
  }

  async function deleteGroup(id, year) {
    const group = getGroupsSync(year).find((g) => g.id === id);
    if (!group) return;
    await window.rtti.deleteFile(ypGroup(year, id));
    const key = `${year}/groups/${group.subject ?? _activeSubject}`;
    cache[key] = (cache[key] ?? []).filter((g) => g.id !== id);
  }

  function getGroupsByJaarlaag(year, jaarlaag) {
    return getGroupsSync(year).filter((g) => String(g.jaarlaag) === String(jaarlaag));
  }

  function getJaarlagenSync(year) {
    const set = new Set(
      getGroupsSync(year)
        .map((g) => String(g.jaarlaag ?? ''))
        .filter(Boolean)
    );
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  async function getJaarlagen(year) {
    await getGroups(year);
    return getJaarlagenSync(year);
  }

  function getStudentGroup(studentId, year) {
    return getGroupsSync(year).find((g) => g.student_ids.includes(studentId)) ?? null;
  }

  // ── Exams (year-scoped, subject-filtered) ─────────────────────────────────
  async function getExams(year, subject = _activeSubject) {
    return loadExams(year, subject);
  }

  async function upsertExam(exam, year) {
    const subj = exam.subject ?? _activeSubject;
    const { academic_year: _ay, ...clean } = exam;
    const updated = { ...clean, subject: subj };
    const key = `${year}/exams/${subj}`;
    const arr = cache[key] ?? [];
    const i = arr.findIndex((e) => e.id === updated.id);
    if (i >= 0) {
      updated.volgnummer = updated.volgnummer ?? arr[i].volgnummer;
      arr[i] = { ...arr[i], ...updated };
    } else {
      if (!updated.volgnummer) {
        const jl = parseInt(updated.jaarlaag, 10);
        if (!isNaN(jl)) {
          const existing = arr.filter(
            (e) => String(e.jaarlaag) === String(updated.jaarlaag) && e.volgnummer
          );
          const maxSeq =
            existing.length > 0 ? Math.max(...existing.map((e) => e.volgnummer % 100)) : 0;
          updated.volgnummer = jl * 100 + maxSeq + 1;
        }
      }
      arr.push(updated);
    }
    cache[key] = arr;
    await window.rtti.writeJson(ypExam(year, updated.id), updated);
  }

  async function deleteExam(id, year) {
    const exam = getExamsSync(year).find((e) => e.id === id);
    if (!exam) return;
    if (examHasResits(id, year)) throw new Error('has_resits');
    await window.rtti.deleteFile(ypExam(year, id));
    const key = `${year}/exams/${exam.subject ?? _activeSubject}`;
    cache[key] = (cache[key] ?? []).filter((e) => e.id !== id);
  }

  // ── Scores (year-scoped, subject-scoped) ──────────────────────────────────
  async function getStudentScores(studentId, year, subject = _activeSubject) {
    const file = ypScore(year, subject, studentId);
    return (await load(file)) ?? { student_id: studentId, scores: {} };
  }

  async function saveStudentScores(record, year, subject = _activeSubject) {
    const file = ypScore(year, subject, record.student_id);
    invalidate(file);
    await save(file, record);
  }

  async function setScore(studentId, examId, questionId, value, year) {
    const record = await getStudentScores(studentId, year);
    if (!record.scores[examId]) record.scores[examId] = {};
    if (value === undefined) delete record.scores[examId][questionId];
    else record.scores[examId][questionId] = value;
    await saveStudentScores(record, year);
  }

  async function getStudentHistory(studentId, subject = _activeSubject) {
    const years = listYearsSync();
    const results = [];
    for (const year of years) {
      await loadYear(year, subject);
      const exams = getExamsSync(year, subject);
      const record = await getStudentScores(studentId, year, subject);
      for (const [examId, questionScores] of Object.entries(record.scores ?? {})) {
        const exam = exams.find((e) => e.id === examId);
        if (!exam) continue;
        results.push({ exam: { ...exam, academic_year: year }, questionScores });
      }
    }
    results.sort((a, b) => {
      const ycmp = a.exam.academic_year.localeCompare(b.exam.academic_year);
      return ycmp !== 0 ? ycmp : (a.exam.volgnummer ?? 0) - (b.exam.volgnummer ?? 0);
    });
    return results;
  }

  // ── RTTI calculations ─────────────────────────────────────────────────────
  function calcResults(exam, questionScores) {
    const n = exam.n_term ?? 1;
    const normalMax = exam.questions
      .filter((q) => qKind(q) === 'normal')
      .reduce((s, q) => s + q.max_points, 0);
    const bonusMax = exam.questions
      .filter((q) => qKind(q) === 'bonus')
      .reduce((s, q) => s + q.max_points, 0);
    const examMaxTotal = normalMax + bonusMax;

    let scored = 0;
    const cats = { R: [0, 0], T1: [0, 0], T2: [0, 0], I: [0, 0] };
    let anyGradeableEntered = false;

    for (const q of exam.questions) {
      const raw = questionScores[q.id];
      if (raw === undefined) continue;
      const kind = qKind(q);
      const isN = raw === null || String(raw).toUpperCase() === 'N';
      if (!isN) {
        const num = Number(raw);
        if (isNaN(num) || num < 0 || num > q.max_points) {
          if (kind === 'normal') cats[q.rtti][1] += q.max_points;
          continue;
        }
        if (kind === 'diag') continue; // diag scores don't affect grade or RTTI
        anyGradeableEntered = true;
        scored += num; // normal and bonus both count towards scored
        if (kind === 'normal') {
          cats[q.rtti][0] += num;
          cats[q.rtti][1] += q.max_points;
        }
      } else {
        if (kind === 'normal') cats[q.rtti][1] += q.max_points;
        if (kind !== 'diag') anyGradeableEntered = true;
      }
    }

    let grade = null;
    if (anyGradeableEntered && normalMax > 0) {
      grade = scored >= normalMax ? 10 : calcGrade(scored, normalMax, n);
    }

    const pct = (cat) =>
      cats[cat][1] > 0 ? Math.round((cats[cat][0] / cats[cat][1]) * 100) : 'NVT';
    return {
      scored,
      normalMax,
      bonusMax,
      examMaxTotal,
      hasBonus: bonusMax > 0,
      grade,
      R: pct('R'),
      T1: pct('T1'),
      T2: pct('T2'),
      I: pct('I'),
    };
  }

  function calcGrade(scored, max, nTerm) {
    const raw = (scored / max) * 9 + nTerm;
    const lo1 = 1 + (2 * scored * 9) / max;
    const hi1 = 10 - (0.5 * (max - scored) * 9) / max;
    const lo2 = 1 + (0.5 * scored * 9) / max;
    const hi2 = 10 - (2 * (max - scored) * 9) / max;
    if (raw > lo1) return Math.min(lo1, 10);
    if (raw > hi1) return Math.min(hi1, 10);
    if (raw < lo2) return Math.max(lo2, 1);
    if (raw < hi2) return Math.max(hi2, 1);
    return Math.min(Math.max(raw, 1), 10);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function makeExamId(title, year, subject = _activeSubject) {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${subject}-${slug}-${year.replace(/\//g, '-')}`;
  }

  function makeGroupId(name, year) {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      year.replace(/\//g, '-')
    );
  }

  // ── Observaties (subject-scoped, individual files) ────────────────────────
  async function getObservaties(subject = _activeSubject) {
    return loadObservaties(subject);
  }

  async function upsertObservation(obs, subject = _activeSubject) {
    const subjects =
      Array.isArray(obs.subjects) && obs.subjects.length > 0
        ? obs.subjects
        : obs.subject
          ? [obs.subject]
          : [subject];
    const updated = { ...obs, subjects };
    delete updated.subject;
    await window.rtti.writeJson(ypObs(updated.id), updated);
    invalidateObsCache();
    const key = `obs/${subject}`;
    const arr = cache[key] ?? [];
    const i = arr.findIndex((o) => o.id === updated.id);
    if (i >= 0) arr[i] = updated;
    else if (obsMatchesSubject(updated, subject)) arr.push(updated);
    cache[key] = arr;
  }

  async function deleteObservation(id, subject = _activeSubject) {
    await window.rtti.deleteFile(ypObs(id));
    invalidateObsCache();
    const key = `obs/${subject}`;
    cache[key] = (cache[key] ?? []).filter((o) => o.id !== id);
  }

  async function setObservation(studentId, examId, obsId, checked, year) {
    const rec = await getStudentScores(studentId, year);
    if (!rec.observations) rec.observations = {};
    if (!rec.observations[examId]) rec.observations[examId] = [];
    if (checked) {
      if (!rec.observations[examId].includes(obsId)) rec.observations[examId].push(obsId);
    } else {
      rec.observations[examId] = rec.observations[examId].filter((id) => id !== obsId);
      if (rec.observations[examId].length === 0) delete rec.observations[examId];
    }
    await saveStudentScores(rec, year);
  }

  async function preloadScores(year, subject = _activeSubject) {
    const students = getStudentsSync(year);
    await Promise.all(students.map((s) => getStudentScores(s.id, year, subject)));
  }

  // ── Migration ─────────────────────────────────────────────────────────────
  async function migrate() {
    await migrateLegacyToPerYear();
    await migrateToPerSubject();
  }

  // Phase 1: very old flat root layout → per-year layout
  async function migrateLegacyToPerYear() {
    const oldStudents = await window.rtti.readJson('students.json');
    if (!oldStudents) return;

    console.log('[store] Migrating legacy data to per-year layout…');

    const oldGroups = (await window.rtti.readJson('groups.json')) ?? [];
    const oldExams = (await window.rtti.readJson('exams.json')) ?? [];

    const examYear = {};
    for (const e of oldExams) if (e.academic_year) examYear[e.id] = e.academic_year;

    const yearSet = new Set();
    for (const s of oldStudents)
      (s.schooljaren ?? []).forEach((e) => e.year && yearSet.add(e.year));
    for (const g of oldGroups) if (g.academic_year) yearSet.add(g.academic_year);
    for (const e of oldExams) if (e.academic_year) yearSet.add(e.academic_year);

    for (const year of yearSet) {
      await window.rtti.ensureYear(year);

      const yearStudents = [];
      for (const s of oldStudents) {
        const entry = (s.schooljaren ?? []).find((e) => e.year === year);
        if (!entry) {
          if (!s.schooljaren?.length && (s.stamklas || s.geslacht)) {
            yearStudents.push({
              id: s.id,
              voornaam: s.voornaam ?? '',
              tussenvoegsel: s.tussenvoegsel ?? '',
              achternaam: s.achternaam ?? s.name ?? '',
              stamklas: s.stamklas ?? '',
              geslacht: s.geslacht ?? '',
            });
          }
        } else {
          yearStudents.push({
            id: s.id,
            voornaam: s.voornaam ?? '',
            tussenvoegsel: s.tussenvoegsel ?? '',
            achternaam: s.achternaam ?? s.name ?? '',
            stamklas: entry.stamklas ?? '',
            geslacht: entry.geslacht ?? '',
          });
        }
      }
      if (yearStudents.length) {
        sortStudents(yearStudents);
        await window.rtti.writeJson(`${year}/students.json`, yearStudents);
      }

      const yearGroups = oldGroups
        .filter((g) => g.academic_year === year)
        .map(({ academic_year: _ay, ...g }) => g);
      if (yearGroups.length) await window.rtti.writeJson(`${year}/groups.json`, yearGroups);

      const yearExams = oldExams
        .filter((e) => e.academic_year === year)
        .map(({ academic_year: _ay, ...e }) => e);
      if (yearExams.length) await window.rtti.writeJson(`${year}/exams.json`, yearExams);
    }

    for (const s of oldStudents) {
      const rec = await window.rtti.readJson(`scores/${s.id}.json`);
      if (!rec?.scores) continue;
      const byYear = {};
      for (const [examId, qs] of Object.entries(rec.scores)) {
        const year = examYear[examId];
        if (!year) continue;
        if (!byYear[year]) byYear[year] = {};
        byYear[year][examId] = qs;
      }
      for (const [year, scores] of Object.entries(byYear)) {
        if (!yearSet.has(year)) continue;
        await window.rtti.writeJson(`${year}/scores/${s.id}.json`, { student_id: s.id, scores });
      }
    }

    await window.rtti.writeJson('students.json.bak', oldStudents);
    if (oldGroups.length) await window.rtti.writeJson('groups.json.bak', oldGroups);
    if (oldExams.length) await window.rtti.writeJson('exams.json.bak', oldExams);
    await window.rtti.writeJson('students.json', null);

    console.log('[store] Legacy migration complete.');
  }

  // Phase 2: per-year array layout → per-subject individual files
  async function migrateToPerSubject() {
    const years = (await window.rtti.listYears()) ?? [];
    let needsMigration = false;

    const obsRaw = await window.rtti.readJson('observaties.json');
    if (Array.isArray(obsRaw)) needsMigration = true;

    if (!needsMigration) {
      for (const year of years) {
        const examsRaw = await window.rtti.readJson(`${year}/exams.json`);
        if (Array.isArray(examsRaw)) {
          needsMigration = true;
          break;
        }
      }
    }

    if (!needsMigration) return;

    console.log('[store] Migrating to per-subject individual files…');

    // Migrate observaties.json → observaties/<id>.json
    if (Array.isArray(obsRaw)) {
      await window.rtti.ensureDir('observaties');
      for (const obs of obsRaw) {
        await window.rtti.writeJson(ypObs(obs.id), { ...obs, subject: obs.subject ?? 'nat' });
      }
      await window.rtti.writeJson('observaties.json.bak', obsRaw);
      await window.rtti.writeJson('observaties.json', null);
    }

    for (const year of years) {
      // Migrate exams.json → exams/<id>.json
      const examsRaw = await window.rtti.readJson(`${year}/exams.json`);
      if (Array.isArray(examsRaw)) {
        await window.rtti.ensureDir(`${year}/exams`);
        for (const exam of examsRaw) {
          await window.rtti.writeJson(ypExam(year, exam.id), {
            ...exam,
            subject: exam.subject ?? 'nat',
          });
        }
        await window.rtti.writeJson(`${year}/exams.json.bak`, examsRaw);
        await window.rtti.writeJson(`${year}/exams.json`, null);
      }

      // Migrate groups.json → groups/<id>.json
      const groupsRaw = await window.rtti.readJson(`${year}/groups.json`);
      if (Array.isArray(groupsRaw)) {
        await window.rtti.ensureDir(`${year}/groups`);
        for (const group of groupsRaw) {
          const subj = subjectFromGroupName(group.name) ?? 'nat';
          await window.rtti.writeJson(ypGroup(year, group.id), { ...group, subject: subj });
        }
        await window.rtti.writeJson(`${year}/groups.json.bak`, groupsRaw);
        await window.rtti.writeJson(`${year}/groups.json`, null);
      }

      // Migrate students.json → students-<year>.json
      const studentsRaw = await window.rtti.readJson(`${year}/students.json`);
      if (Array.isArray(studentsRaw)) {
        await window.rtti.writeJson(ypStudents(year), studentsRaw);
        await window.rtti.writeJson(`${year}/students.json.bak`, studentsRaw);
        await window.rtti.writeJson(`${year}/students.json`, null);
      }

      // Migrate scores/<studentId>.json → scores/nat/<studentId>.json
      const oldScoreRecs = await window.rtti.readAllJson(`${year}/scores`);
      for (const rec of oldScoreRecs) {
        if (!rec?.student_id) continue;
        await window.rtti.writeJson(ypScore(year, 'nat', rec.student_id), rec);
        await window.rtti.deleteFile(`${year}/scores/${rec.student_id}.json`);
      }
    }

    console.log('[store] Per-subject migration complete.');
  }

  async function examHasScores(examId, year, subject = _activeSubject) {
    const students = getStudentsSync(year);
    for (const s of students) {
      const rec = await getStudentScores(s.id, year, subject);
      const exScores = rec?.scores?.[examId];
      if (!exScores) continue;
      if (Object.values(exScores).some((v) => v !== null && v !== undefined)) return true;
    }
    return false;
  }

  async function studentHasScores(studentId, year, subject = _activeSubject) {
    const rec = await getStudentScores(studentId, year, subject);
    return Object.values(rec.scores ?? {}).some((exScores) =>
      Object.values(exScores ?? {}).some((v) => v !== null && v !== undefined)
    );
  }

  function obsIsUsedInAnyExam(obsId) {
    return Object.entries(cache).some(
      ([key, val]) =>
        key.includes('/exams/') &&
        Array.isArray(val) &&
        val.some((e) => (e.obs_ids ?? []).includes(obsId))
    );
  }

  // ── Resit helpers ─────────────────────────────────────────────────────────
  function getResitsSync(parentId, year, subject = _activeSubject) {
    return getExamsSync(year, subject)
      .filter((e) => e.parent_id === parentId)
      .sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
  }

  function examHasResits(examId, year, subject = _activeSubject) {
    return getExamsSync(year, subject).some((e) => e.parent_id === examId);
  }

  async function computeBestGradeMap(parentId, year, subject = _activeSubject) {
    const parentExam = getExamsSync(year, subject).find((e) => e.id === parentId);
    if (!parentExam) return {};
    const allAttempts = [parentExam, ...getResitsSync(parentId, year, subject)];
    const students = getStudentsSync(year);
    const bestMap = {};
    for (const s of students) {
      const rec = await getStudentScores(s.id, year, subject);
      let bestGrade = -Infinity;
      let bestEntry = null;
      for (const attempt of allAttempts) {
        const examScores = rec?.scores?.[attempt.id];
        if (!examScores || Object.keys(examScores).length === 0) continue;
        const qs = {};
        attempt.questions.forEach((q) => {
          const v = examScores[q.id];
          if (v !== undefined) qs[q.id] = v;
        });
        if (Object.keys(qs).length === 0) continue;
        const res = calcResults(attempt, qs);
        if (res.grade !== null && res.grade > bestGrade) {
          bestGrade = res.grade;
          bestEntry = { examId: attempt.id, exam: attempt, questionScores: qs, grade: res.grade };
        }
      }
      if (bestEntry) bestMap[s.id] = bestEntry;
    }
    return bestMap;
  }

  /**
   * Given a flat history array (from getStudentHistory), collapses resit groups
   * so that only the attempt with the highest grade appears per exam group.
   * Standalone exams (no parent_id, no resits in history) pass through unchanged.
   */
  function resolveBestAttempts(history) {
    const parentsWithResits = new Set(
      history.filter((h) => h.exam.parent_id).map((h) => h.exam.parent_id)
    );
    const handledParents = new Set();
    const result = [];

    // Process originals (no parent_id) first
    for (const entry of history) {
      if (entry.exam.parent_id) continue;
      const examId = entry.exam.id;
      if (!parentsWithResits.has(examId)) {
        result.push(entry); // standalone — pass through
        continue;
      }
      handledParents.add(examId);
      const candidates = [entry, ...history.filter((h) => h.exam.parent_id === examId)];
      let best = candidates[0];
      for (const c of candidates) {
        if (
          (calcResults(c.exam, c.questionScores).grade ?? -1) >
          (calcResults(best.exam, best.questionScores).grade ?? -1)
        )
          best = c;
      }
      result.push(best);
    }

    // Handle resits whose parent has no history entry (student only did the resit)
    for (const entry of history) {
      if (!entry.exam.parent_id) continue;
      const parentId = entry.exam.parent_id;
      if (handledParents.has(parentId)) continue;
      handledParents.add(parentId);
      const resitGroup = history.filter((h) => h.exam.parent_id === parentId);
      let best = resitGroup[0];
      for (const c of resitGroup) {
        if (
          (calcResults(c.exam, c.questionScores).grade ?? -1) >
          (calcResults(best.exam, best.questionScores).grade ?? -1)
        )
          best = c;
      }
      result.push(best);
    }

    result.sort((a, b) => {
      const ycmp = (a.exam.academic_year ?? '').localeCompare(b.exam.academic_year ?? '');
      return ycmp !== 0 ? ycmp : (a.exam.volgnummer ?? 0) - (b.exam.volgnummer ?? 0);
    });
    return result;
  }

  async function removeObsFromExamScores(obsId, examId, year, subject = _activeSubject) {
    const students = getStudentsSync(year);
    await Promise.all(
      students.map(async (s) => {
        const rec = await getStudentScores(s.id, year, subject);
        const arr = rec.observations?.[examId];
        if (!arr || !arr.includes(obsId)) return;
        rec.observations[examId] = arr.filter((id) => id !== obsId);
        await saveStudentScores(rec, year, subject);
      })
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    preload,
    initSubject,
    loadYear,
    preloadScores,
    listYearsSync,
    getConfigSync,
    getStudentsSync,
    getGroupsSync,
    getExamsSync,
    getObservatiesSync,
    getActiveSubject,
    setActiveSubject,
    SUBJECT_DISPLAY,
    subjectFromGroupName,
    parseGroupName,
    getConfig,
    setActiveYear,
    currentSchoolYear,
    fullName,
    jaarlaagFromStamklas,
    sortStudents,
    getStudents,
    saveStudents,
    upsertStudent,
    upsertStudents,
    deleteStudent,
    getGroups,
    upsertGroup,
    upsertGroups,
    deleteGroup,
    getGroupsByJaarlaag,
    getJaarlagenSync,
    getJaarlagen,
    getStudentGroup,
    getExams,
    upsertExam,
    deleteExam,
    getStudentScores,
    saveStudentScores,
    setScore,
    getStudentHistory,
    calcResults,
    calcGrade,
    makeExamId,
    makeGroupId,
    getObservaties,
    upsertObservation,
    deleteObservation,
    setObservation,
    examHasScores,
    studentHasScores,
    obsIsUsedInAnyExam,
    removeObsFromExamScores,
    getResitsSync,
    examHasResits,
    computeBestGradeMap,
    resolveBestAttempts,
  };
})();
