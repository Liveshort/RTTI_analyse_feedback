/**
 * store.js — Central data access layer.
 *
 * NEW per-year file layout (one subfolder per academic year):
 *
 *   data/
 *   ├── config.json                  { activeYear: "2025-2026" }
 *   └── 2025-2026/
 *       ├── students.json            [{ id, voornaam, tussenvoegsel, achternaam, stamklas, geslacht }]
 *       ├── groups.json              [{ id, name, jaarlaag, student_ids[] }]
 *       ├── exams.json               [{ id, title, jaarlaag, n_term, periode, volgnummer, structureMode, questions[] }]
 *       └── scores/
 *           └── <studentId>.json     { student_id, scores: { examId: { qId: pts|null|string } } }
 *
 * academic_year is no longer stored inside group/exam objects — it is implicit from the folder.
 * Students are flat per-year — no more schooljaren[] array.
 *
 * Migration: on first load, if legacy data/students.json exists it is automatically
 * migrated to the per-year layout and renamed to students.json.bak (etc.).
 */

const Store = (() => {
  // ── Cache ─────────────────────────────────────────────────────────────────
  // Keys are relative paths: 'config.json', '2025-2026/students.json', etc.
  const cache = {};
  let _years = null; // cached list of year folders

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

  // ── Path helpers ──────────────────────────────────────────────────────────
  const yp = (year, file) => `${year}/${file}`;
  const ypScore = (year, id) => `${year}/scores/${id}.json`;

  // ── Year management ───────────────────────────────────────────────────────

  /** Refresh the in-memory years list from the filesystem. */
  async function refreshYears() {
    _years = await window.rtti.listYears();
    return _years;
  }

  /** Returns the cached years list (newest first). Call after preload(). */
  function listYearsSync() {
    return _years ?? [];
  }

  /**
   * Ensure a year folder exists and its data is loaded into the cache.
   * Safe to call multiple times — no-ops if already loaded.
   */
  async function loadYear(year) {
    await window.rtti.ensureYear(year);
    await Promise.all([
      load(yp(year, 'students.json')),
      load(yp(year, 'groups.json')),
      load(yp(year, 'exams.json')),
    ]);
    if (_years && !_years.includes(year)) {
      _years.push(year);
      _years.sort((a, b) => b.localeCompare(a));
    }
  }

  // ── Preload: warm cache for active year before first render ───────────────
  async function preload() {
    await migrate(); // one-time migration (no-op if already done)
    _years = await window.rtti.listYears();
    const cfg = await load('config.json');
    const year = cfg?.activeYear ?? currentSchoolYear();
    // Ensure active year folder exists even if it has no data yet
    await loadYear(year);
    await load('observaties.json'); // global, not year-scoped
    // Refresh years after loadYear may have created a new folder
    _years = await window.rtti.listYears();
    if (!_years.includes(year)) _years.unshift(year);
    _years.sort((a, b) => b.localeCompare(a));
  }

  // ── Sync getters (safe after preload / loadYear) ──────────────────────────
  function getConfigSync() {
    return cache['config.json'] ?? { activeYear: currentSchoolYear() };
  }
  function getStudentsSync(year) {
    return cache[yp(year, 'students.json')] ?? [];
  }
  function getGroupsSync(year) {
    return cache[yp(year, 'groups.json')] ?? [];
  }
  function getExamsSync(year) {
    return cache[yp(year, 'exams.json')] ?? [];
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
    return (await load(yp(year, 'students.json'))) ?? [];
  }

  async function saveStudents(list, year) {
    sortStudents(list);
    await save(yp(year, 'students.json'), list);
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

  // ── Groups (year-scoped) ──────────────────────────────────────────────────

  async function getGroups(year) {
    return (await load(yp(year, 'groups.json'))) ?? [];
  }
  async function saveGroups(list, year) {
    await save(yp(year, 'groups.json'), list);
  }

  async function upsertGroup(group, year) {
    const list = await getGroups(year);
    const idx = list.findIndex((g) => g.id === group.id);
    // Strip academic_year if caller passed it (legacy); it's implicit from folder
    const { academic_year: _ay, ...clean } = group;
    if (idx >= 0) list[idx] = clean;
    else list.push(clean);
    await saveGroups(list, year);
  }

  async function upsertGroups(groups, year) {
    const list = await getGroups(year);
    for (const group of groups) {
      const { academic_year: _ay, ...clean } = group;
      const idx = list.findIndex((g) => g.id === clean.id);
      if (idx >= 0) list[idx] = clean;
      else list.push(clean);
    }
    await saveGroups(list, year);
  }

  async function deleteGroup(id, year) {
    const list = await getGroups(year);
    await saveGroups(
      list.filter((g) => g.id !== id),
      year
    );
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

  // ── Exams (year-scoped) ───────────────────────────────────────────────────

  async function getExams(year) {
    return (await load(yp(year, 'exams.json'))) ?? [];
  }
  async function saveExams(list, year) {
    await save(yp(year, 'exams.json'), list);
  }

  async function upsertExam(exam, year) {
    const list = await getExams(year);
    const idx = list.findIndex((e) => e.id === exam.id);
    // Strip academic_year (now implicit from folder)
    const { academic_year: _ay, ...clean } = exam;

    if (idx >= 0) {
      list[idx] = { ...list[idx], ...clean, volgnummer: list[idx].volgnummer };
    } else {
      if (!clean.volgnummer) {
        const jl = parseInt(clean.jaarlaag, 10);
        if (!isNaN(jl)) {
          const existing = list.filter(
            (e) => String(e.jaarlaag) === String(clean.jaarlaag) && e.volgnummer
          );
          const maxSeq =
            existing.length > 0 ? Math.max(...existing.map((e) => e.volgnummer % 100)) : 0;
          clean.volgnummer = jl * 100 + maxSeq + 1;
        }
      }
      list.push(clean);
    }
    await saveExams(list, year);
  }

  async function deleteExam(id, year) {
    const list = await getExams(year);
    await saveExams(
      list.filter((e) => e.id !== id),
      year
    );
  }

  // ── Scores (year-scoped) ──────────────────────────────────────────────────

  async function getStudentScores(studentId, year) {
    const file = ypScore(year, studentId);
    return (await load(file)) ?? { student_id: studentId, scores: {} };
  }

  async function saveStudentScores(record, year) {
    const file = ypScore(year, record.student_id);
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

  /**
   * Load history for a student across ALL years (for profile chart).
   * Lazily loads each year's exam list if not already cached.
   */
  async function getStudentHistory(studentId) {
    const years = listYearsSync();
    const results = [];
    for (const year of years) {
      await loadYear(year); // no-op if already cached
      const exams = getExamsSync(year);
      const record = await getStudentScores(studentId, year);
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
    const examMaxTotal = exam.questions.reduce((s, q) => s + q.max_points, 0);
    let scored = 0;
    const cats = { R: [0, 0], T1: [0, 0], T2: [0, 0], I: [0, 0] };
    let anyEntered = false;

    for (const q of exam.questions) {
      const raw = questionScores[q.id];
      if (raw === undefined) continue;
      anyEntered = true;
      const isN = raw === null || String(raw).toUpperCase() === 'N';
      if (!isN) {
        const num = Number(raw);
        if (isNaN(num) || num < 0 || num > q.max_points) {
          cats[q.rtti][1] += q.max_points;
          continue;
        }
        scored += num;
        cats[q.rtti][0] += num;
        cats[q.rtti][1] += q.max_points;
      } else {
        cats[q.rtti][1] += q.max_points;
      }
    }

    const grade = anyEntered && examMaxTotal > 0 ? calcGrade(scored, examMaxTotal, n) : null;
    const pct = (cat) =>
      cats[cat][1] > 0 ? Math.round((cats[cat][0] / cats[cat][1]) * 100) : 'NVT';
    return { scored, examMaxTotal, grade, R: pct('R'), T1: pct('T1'), T2: pct('T2'), I: pct('I') };
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
  function makeExamId(title, year) {
    return (
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      year.replace(/\//g, '-')
    );
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

  // ── One-time migration from legacy flat layout ────────────────────────────
  async function migrate() {
    const oldStudents = await window.rtti.readJson('students.json');
    if (!oldStudents) return; // already migrated or fresh install

    console.log('[store] Migrating legacy data to per-year layout…');

    const oldGroups = (await window.rtti.readJson('groups.json')) ?? [];
    const oldExams = (await window.rtti.readJson('exams.json')) ?? [];

    // Build examId → year lookup
    const examYear = {};
    for (const e of oldExams) if (e.academic_year) examYear[e.id] = e.academic_year;

    // Collect all years involved
    const yearSet = new Set();
    for (const s of oldStudents)
      (s.schooljaren ?? []).forEach((e) => e.year && yearSet.add(e.year));
    for (const g of oldGroups) if (g.academic_year) yearSet.add(g.academic_year);
    for (const e of oldExams) if (e.academic_year) yearSet.add(e.academic_year);
    // Add legacy-only students to their guessed year (we'll skip — they have no year info)

    for (const year of yearSet) {
      await window.rtti.ensureYear(year);

      // Students for this year (flat, stamklas/geslacht resolved)
      const yearStudents = [];
      for (const s of oldStudents) {
        const entry = (s.schooljaren ?? []).find((e) => e.year === year);
        if (!entry) {
          // Legacy flat student — add to year only if they have stamklas/geslacht
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
        await window.rtti.writeJson(yp(year, 'students.json'), yearStudents);
      }

      // Groups for this year (strip academic_year field)
      const yearGroups = oldGroups
        .filter((g) => g.academic_year === year)
        .map(({ academic_year: _ay, ...g }) => g);
      if (yearGroups.length) await window.rtti.writeJson(yp(year, 'groups.json'), yearGroups);

      // Exams for this year (strip academic_year field)
      const yearExams = oldExams
        .filter((e) => e.academic_year === year)
        .map(({ academic_year: _ay, ...e }) => e);
      if (yearExams.length) await window.rtti.writeJson(yp(year, 'exams.json'), yearExams);
    }

    // Scores: distribute each student's scores to the correct year folders
    const scoreIds = (await window.rtti.listScoreFiles_legacy?.()) ?? [];
    // Use direct readJson to get all old score files
    for (const s of oldStudents) {
      const rec = await window.rtti.readJson(`scores/${s.id}.json`);
      if (!rec?.scores) continue;
      // Group scores by year
      const byYear = {};
      for (const [examId, qs] of Object.entries(rec.scores)) {
        const year = examYear[examId];
        if (!year) continue;
        if (!byYear[year]) byYear[year] = {};
        byYear[year][examId] = qs;
      }
      for (const [year, scores] of Object.entries(byYear)) {
        if (!yearSet.has(year)) continue;
        await window.rtti.writeJson(ypScore(year, s.id), { student_id: s.id, scores });
      }
    }

    // Rename old files to .bak so this migration doesn't re-run
    await window.rtti.writeJson('students.json.bak', oldStudents);
    if (oldGroups.length) await window.rtti.writeJson('groups.json.bak', oldGroups);
    if (oldExams.length) await window.rtti.writeJson('exams.json.bak', oldExams);
    // Overwrite root files with null-sentinel so we know migration is done
    await window.rtti.writeJson('students.json', null);

    console.log('[store] Migration complete.');
  }

  // ── Observaties (global, not year-scoped) ─────────────────────────────────

  function getObservatiesSync() {
    return cache['observaties.json'] ?? [];
  }
  async function getObservaties() {
    return (await load('observaties.json')) ?? [];
  }
  async function saveObservaties(list) {
    cache['observaties.json'] = list;
    await save('observaties.json', list);
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

  /** Fire-and-forget: warm the score cache for every student in a year. */
  async function preloadScores(year) {
    const students = getStudentsSync(year);
    await Promise.all(students.map((s) => getStudentScores(s.id, year)));
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    preload,
    loadYear,
    preloadScores,
    listYearsSync,
    getConfigSync,
    getStudentsSync,
    getGroupsSync,
    getExamsSync,
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
    saveGroups,
    upsertGroup,
    upsertGroups,
    deleteGroup,
    getGroupsByJaarlaag,
    getJaarlagenSync,
    getJaarlagen,
    getStudentGroup,
    getExams,
    saveExams,
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
    getObservatiesSync,
    getObservaties,
    saveObservaties,
    setObservation,
  };
})();
