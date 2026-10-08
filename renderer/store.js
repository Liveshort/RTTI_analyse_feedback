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
  let _activeUser = null;

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

  // ── Safe read-modify-write (shared OneDrive folder) ───────────────────────
  // update() re-reads relPath from disk, applies mutator and writes the result
  // only if nobody changed the file in between (compare-and-swap on a content
  // hash, checked in main.js); on a conflict it starts over with the fresh file.
  // mutator(current, onDisk): `current` is the on-disk data (or fallback() when
  // the file is absent) and may be mutated; onDisk is null for a new file.
  // Throwing from the mutator aborts the write. Writes per file are serialised.
  const writeQueues = {};

  // Run fn after all earlier queued work on relPath (own writes, external refreshes).
  function serialize(relPath, fn) {
    const queued = (writeQueues[relPath] ?? Promise.resolve()).then(fn, fn);
    writeQueues[relPath] = queued.catch(() => {});
    return queued;
  }

  function update(relPath, mutator, fallback = () => null) {
    const run = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const read = await window.rtti.readJsonVersioned(relPath);
        if (read?.error) throw new Error(`Bestand ${relPath} is onleesbaar: ${read.error}`);
        const next = mutator(read.data ?? fallback(), read.data);
        const result = await window.rtti.writeJson(relPath, next, {
          cas: true,
          expectedHash: read.hash,
        });
        if (result?.ok) return next;
        if (result?.reason !== 'conflict') {
          throw new Error(`Save failed for ${relPath}: ${result?.reason}`);
        }
      }
      throw new Error(`Save failed for ${relPath}: conflict`);
    };
    return serialize(relPath, run);
  }

  // Version info stored in single-object files (exams, groups, observaties, opdrachten).
  function stampMeta(obj, onDisk) {
    const now = new Date().toISOString();
    const userId = _activeUser?.id ?? null;
    const prev = onDisk?._meta;
    obj._meta = {
      rev: (prev?.rev ?? 0) + 1,
      createdBy: onDisk ? (prev?.createdBy ?? null) : userId,
      createdAt: onDisk ? (prev?.createdAt ?? null) : now,
      updatedBy: userId,
      updatedAt: now,
    };
    return obj;
  }

  // Thrown when saving an object someone else saved after it was loaded here.
  // err.updatedBy holds the other user's id (if known). Handled globally in app.js.
  function conflictError(meta) {
    const err = new Error('conflict');
    err.code = 'conflict';
    err.updatedBy = meta?.updatedBy ?? null;
    return err;
  }

  // Save a single-object file. baseRev is the _meta.rev of the version the edit
  // started from; if the file on disk has moved on since, nothing is written.
  // force: overwrite regardless (deliberate replacements such as a CSV import).
  function saveEntity(relPath, entity, baseRev, { force = false } = {}) {
    return update(relPath, (_current, onDisk) => {
      if (!force && onDisk && (onDisk._meta?.rev ?? 0) !== (baseRev ?? 0)) {
        throw conflictError(onDisk._meta);
      }
      return stampMeta({ ...entity }, onDisk);
    });
  }

  // ── Active subject ─────────────────────────────────────────────────────────
  function setActiveSubject(s) {
    _activeSubject = s;
  }
  function getActiveSubject() {
    return _activeSubject;
  }

  // ── Active user ────────────────────────────────────────────────────────────
  function setActiveUser(user) {
    _activeUser = user;
  }
  function getActiveUser() {
    return _activeUser;
  }
  function isAdminActive() {
    return _activeUser?.isAdmin === true;
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  async function loadUsers() {
    return (await load('gebruikers.json')) ?? [];
  }

  // ── School ─────────────────────────────────────────────────────────────────
  async function loadSchool() {
    return await load('school.json');
  }

  async function saveSchool(data) {
    await save('school.json', data);
  }

  async function upsertUser(user) {
    cache['gebruikers.json'] = await update(
      'gebruikers.json',
      (users) => {
        const idx = users.findIndex((u) => u.id === user.id);
        if (idx >= 0) users[idx] = user;
        else users.push(user);
        return users;
      },
      () => []
    );
  }

  // ── Session (machine-local, not synced via OneDrive) ──────────────────────
  async function saveLastSession(subject, userId) {
    const existing = (await window.rtti.readLocalSession()) ?? {};
    await window.rtti.writeLocalSession({ ...existing, lastSubject: subject, lastUserId: userId });
  }

  async function loadLastSession() {
    return await window.rtti.readLocalSession();
  }

  async function saveFilterState(userId, state) {
    const existing = (await window.rtti.readLocalSession()) ?? {};
    const filtersByUser = existing.filtersByUser ?? {};
    filtersByUser[userId] = {
      schoolsoorten: [...state.schoolsoorten],
      jaarlagen: [...state.jaarlagen],
      jaarlagenKlas: [...state.jaarlagenKlas],
      eigenOnly: state.eigenOnly,
    };
    await window.rtti.writeLocalSession({ ...existing, filtersByUser });
  }

  async function loadFilterState(userId) {
    const session = await window.rtti.readLocalSession();
    return session?.filtersByUser?.[userId] ?? null;
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
    const key = subject ? `${year}/groups/${subject}` : `${year}/groups/__all__`;
    if (cache[key] !== undefined) return cache[key];
    const all = await window.rtti.readAllJson(`${year}/groups`);
    cache[key] = subject ? all.filter((g) => g.subject === subject) : all;
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
    // subject === null means admin (all groups); subject === undefined means no subject yet
    if (subject !== undefined) tasks.push(loadGroups(year, subject));
    if (subject) tasks.push(loadExams(year, subject));
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
    await load('school.json');
    _years = await window.rtti.listYears();
  }

  async function initSubject(subject) {
    const year = getConfigSync().activeYear ?? currentSchoolYear();
    if (isAdminActive()) {
      // Admin sees all subjects — only preload students and all groups
      await loadYear(year, null);
    } else {
      setActiveSubject(subject);
      await Promise.all([loadYear(year, subject), loadObservaties(subject)]);
    }
  }

  // ── Sync getters (safe after preload / loadYear / initSubject) ────────────
  function getConfigSync() {
    return cache['config.json'] ?? { activeYear: currentSchoolYear() };
  }
  function getSchoolSync() {
    return cache['school.json'] ?? {};
  }
  function getStudentsSync(year) {
    return cache[ypStudents(year)] ?? [];
  }
  function getGroupsSync(year, subject = isAdminActive() ? null : _activeSubject) {
    const key = subject ? `${year}/groups/${subject}` : `${year}/groups/__all__`;
    return cache[key] ?? [];
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

  // The students file is one shared array per year, so every change is applied
  // to the latest version on disk (per student) instead of rewriting the cached list.
  async function updateStudents(year, mutator) {
    cache[ypStudents(year)] = await update(
      ypStudents(year),
      (list) => sortStudents(mutator(list)),
      () => []
    );
  }

  function mergeStudent(list, student) {
    const flat = {
      id: student.id,
      voornaam: student.voornaam ?? '',
      tussenvoegsel: student.tussenvoegsel ?? '',
      achternaam: student.achternaam ?? student.name ?? '',
      stamklas: student.stamklas ?? '',
      geslacht: student.geslacht ?? '',
      jaarlaag: student.jaarlaag ?? '',
      schoolsoort: student.schoolsoort ?? [],
    };
    const idx = list.findIndex((s) => s.id === flat.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...flat };
    else list.push(flat);
  }

  async function upsertStudent(student, year) {
    await updateStudents(year, (list) => {
      mergeStudent(list, student);
      return list;
    });
  }

  async function upsertStudents(students, year) {
    await updateStudents(year, (list) => {
      for (const student of students) mergeStudent(list, student);
      return list;
    });
  }

  async function deleteStudent(id, year) {
    await updateStudents(year, (list) => list.filter((s) => s.id !== id));
  }

  // ── Groups (year-scoped, subject-filtered) ────────────────────────────────
  async function getGroups(year, subject = isAdminActive() ? null : _activeSubject) {
    return loadGroups(year, subject);
  }

  async function upsertGroup(group, year, { force = false } = {}) {
    const subj = group.subject ?? subjectFromGroupName(group.name) ?? _activeSubject;
    const { academic_year: _ay, ...clean } = group;
    const updated = { ...clean, subject: subj };
    const saved = await saveEntity(ypGroup(year, updated.id), updated, updated._meta?.rev, {
      force,
    });
    const key = `${year}/groups/${subj}`;
    cache[key] = cache[key] ?? [];
    for (const k of [key, `${year}/groups/__all__`]) {
      const arr = cache[k];
      if (!arr) continue;
      const i = arr.findIndex((g) => g.id === saved.id);
      if (i >= 0) arr[i] = saved;
      else arr.push(saved);
    }
  }

  // Bulk import: replaces existing groups with the same id.
  async function upsertGroups(groups, year) {
    for (const group of groups) {
      await upsertGroup(group, year, { force: true });
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
    let merged = updated;
    if (i >= 0) {
      updated.volgnummer = updated.volgnummer ?? arr[i].volgnummer;
      merged = { ...arr[i], ...updated };
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
    }
    const saved = await saveEntity(ypExam(year, merged.id), merged, merged._meta?.rev);
    putCachedExam(key, saved);
    return saved;
  }

  function putCachedExam(key, exam) {
    const arr = cache[key] ?? [];
    const i = arr.findIndex((e) => e.id === exam.id);
    if (i >= 0) arr[i] = exam;
    else arr.push(exam);
    cache[key] = arr;
  }

  // The N-term is merged into the latest version on disk without a conflict
  // check: it is a single value, and other edits to the exam must not be lost.
  async function setExamNTerm(examId, nTerm, year, subject = _activeSubject) {
    const saved = await update(ypExam(year, examId), (exam, onDisk) => {
      if (!onDisk) throw new Error(`Toets ${examId} bestaat niet meer.`);
      exam.n_term = nTerm;
      return stampMeta(exam, onDisk);
    });
    putCachedExam(`${year}/exams/${saved.subject ?? subject}`, saved);
    return saved;
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

  // Apply a change to the latest version of a student's score file on disk, so
  // scores another teacher saved in the meantime (other exams, other cells) are kept.
  async function updateStudentScores(studentId, year, subject, mutator) {
    const file = ypScore(year, subject, studentId);
    cache[file] = await update(
      file,
      (rec) => {
        if (!rec.scores) rec.scores = {};
        mutator(rec);
        return rec;
      },
      () => ({ student_id: studentId, scores: {} })
    );
    return cache[file];
  }

  async function setScore(studentId, examId, questionId, value, year) {
    await updateStudentScores(studentId, year, _activeSubject, (rec) => {
      if (!rec.scores[examId]) rec.scores[examId] = {};
      if (value === undefined) delete rec.scores[examId][questionId];
      else rec.scores[examId][questionId] = value;
    });
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
    await saveEntity(ypObs(updated.id), updated, updated._meta?.rev);
    // Other subjects' caches may be affected too (multi-subject obs), so drop
    // them all and reload the active one so sync getters stay populated.
    invalidateObsCache();
    await loadObservaties(subject);
  }

  async function deleteObservation(id, subject = _activeSubject) {
    await window.rtti.deleteFile(ypObs(id));
    invalidateObsCache();
    await loadObservaties(subject);
  }

  async function setObservation(studentId, examId, obsId, checked, year) {
    await updateStudentScores(studentId, year, _activeSubject, (rec) => {
      if (!rec.observations) rec.observations = {};
      if (!rec.observations[examId]) rec.observations[examId] = [];
      if (checked) {
        if (!rec.observations[examId].includes(obsId)) rec.observations[examId].push(obsId);
      } else {
        rec.observations[examId] = rec.observations[examId].filter((id) => id !== obsId);
        if (rec.observations[examId].length === 0) delete rec.observations[examId];
      }
    });
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

  // Check all years × all subjects — used by admin to guard deletion.
  async function studentHasAnyScores(studentId) {
    const years = listYearsSync();
    const subjects = Object.keys(SUBJECT_DISPLAY);
    for (const year of years) {
      for (const subject of subjects) {
        if (await studentHasScores(studentId, year, subject)) return true;
      }
    }
    return false;
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
        if (!rec.observations?.[examId]?.includes(obsId)) return;
        await updateStudentScores(s.id, year, subject, (fresh) => {
          const arr = fresh.observations?.[examId];
          if (arr) fresh.observations[examId] = arr.filter((id) => id !== obsId);
        });
      })
    );
  }

  // ── Opdrachten ────────────────────────────────────────────────────────────

  async function loadOpdrachten() {
    if (cache['opdrachten'] !== undefined) return cache['opdrachten'];
    const all = await window.rtti.readAllJson('opdrachten');
    cache['opdrachten'] = all.filter((o) => o && o.id);
    return cache['opdrachten'];
  }

  function getOpdrachtenSync() {
    return cache['opdrachten'] ?? [];
  }

  async function getOpdrachten() {
    return loadOpdrachten();
  }

  async function upsertOpdracht(opdracht) {
    const baseRev =
      opdracht._meta?.rev ?? getOpdrachtenSync().find((o) => o.id === opdracht.id)?._meta?.rev;
    await saveEntity(`opdrachten/${opdracht.id}.json`, opdracht, baseRev);
    cache['opdrachten'] = undefined;
    await loadOpdrachten();
  }

  async function deleteOpdracht(id) {
    const opdracht = getOpdrachtenSync().find((o) => o.id === id);
    cache['opdrachten'] = undefined;
    await window.rtti.deleteFile(`opdrachten/${id}.json`);
    if (opdracht?.typFile) {
      await window.rtti.deleteFile(`opdrachten/${opdracht.typFile}`);
    }
    await loadOpdrachten();
  }

  // ── External changes (other teachers, reported by the watcher in main.js) ──
  // Brings the cache up to date for one changed file and describes the change:
  //   { type, kind, relPath, year, subject, id, before, after, meta, inScope }
  // type: 'scores' | 'exam' | 'group' | 'students' | 'observatie' | 'opdracht'
  //       | 'opdrachtTyp' | 'gebruikers' | 'school' | 'presence' | 'other'
  // Only data that is already cached is re-read; the rest loads lazily as before.
  // inScope: the change concerns the active subject (admin: any) and active year.
  const YEAR = '(\\d{4}-\\d{4})';
  const EXTERNAL_PATTERNS = [
    ['scores', new RegExp(`^${YEAR}/scores/([^/]+)/([^/]+)\\.json$`)],
    ['exam', new RegExp(`^${YEAR}/exams/([^/]+)\\.json$`)],
    ['group', new RegExp(`^${YEAR}/groups/([^/]+)\\.json$`)],
    ['students', new RegExp(`^${YEAR}/students-\\d{4}-\\d{4}\\.json$`)],
    ['observatie', /^observaties\/([^/]+)\.json$/],
    ['opdracht', /^opdrachten\/([^/]+)\.json$/],
    ['opdrachtTyp', /^opdrachten\/([^/]+)\.typ$/],
    ['gebruikers', /^gebruikers\.json$/],
    ['school', /^school\.json$/],
    ['presence', /^users\/([^/]+)\.json$/],
  ];

  // Replace (or remove, when `item` is null) the entry with this id in every
  // loaded cache array whose key starts with prefix; add it to the arrays in
  // `targetKeys` that are loaded but don't contain it yet. Returns the old entry.
  function patchCachedArrays(prefix, id, item, targetKeys) {
    let before = null;
    for (const key of Object.keys(cache)) {
      if (!key.startsWith(prefix) || !Array.isArray(cache[key])) continue;
      const arr = cache[key];
      const i = arr.findIndex((x) => x.id === id);
      if (i < 0) continue;
      before = before ?? arr[i];
      if (item && targetKeys.includes(key)) arr[i] = item;
      else arr.splice(i, 1);
    }
    if (item) {
      for (const key of targetKeys) {
        const arr = cache[key];
        if (Array.isArray(arr) && !arr.some((x) => x.id === id)) arr.push(item);
      }
    }
    return before;
  }

  async function applyExternalChange({ relPath, kind, meta }) {
    let type = 'other';
    let match = null;
    for (const [t, re] of EXTERNAL_PATTERNS) {
      match = relPath.match(re);
      if (match) {
        type = t;
        break;
      }
    }
    const ev = { type, kind, relPath, meta, year: null, subject: null, id: null };
    ev.before = null;
    ev.after = null;
    const readFresh = async () => (kind === 'deleted' ? null : window.rtti.readJson(relPath));

    // Serialised with own writes to the same file, so a refresh can never put an
    // older version in the cache than one this app just wrote.
    await serialize(relPath, async () => {
      switch (type) {
        case 'scores': {
          [, ev.year, ev.subject, ev.id] = match;
          if (cache[relPath] === undefined) break;
          ev.before = cache[relPath];
          ev.after = await readFresh();
          cache[relPath] = ev.after;
          break;
        }
        case 'exam': {
          [, ev.year, ev.id] = match;
          ev.after = await readFresh();
          const subj = ev.after?.subject;
          ev.before = patchCachedArrays(
            `${ev.year}/exams/`,
            ev.id,
            ev.after,
            subj ? [`${ev.year}/exams/${subj}`] : []
          );
          ev.subject = subj ?? ev.before?.subject ?? null;
          break;
        }
        case 'group': {
          [, ev.year, ev.id] = match;
          ev.after = await readFresh();
          const subj = ev.after?.subject;
          ev.before = patchCachedArrays(
            `${ev.year}/groups/`,
            ev.id,
            ev.after,
            [subj && `${ev.year}/groups/${subj}`, `${ev.year}/groups/__all__`].filter(Boolean)
          );
          ev.subject = subj ?? ev.before?.subject ?? null;
          break;
        }
        case 'students': {
          ev.year = match[1];
          if (cache[relPath] === undefined) break;
          ev.before = cache[relPath];
          ev.after = (await readFresh()) ?? [];
          cache[relPath] = ev.after;
          break;
        }
        case 'observatie': {
          ev.id = match[1];
          ev.before = getObservatiesSync().find((o) => o.id === ev.id) ?? null;
          ev.after = await readFresh();
          invalidateObsCache();
          if (_activeSubject) await loadObservaties(_activeSubject);
          break;
        }
        case 'opdracht': {
          ev.id = match[1];
          ev.before = getOpdrachtenSync().find((o) => o.id === ev.id) ?? null;
          ev.after = await readFresh();
          if (cache['opdrachten'] !== undefined) {
            cache['opdrachten'] = undefined;
            await loadOpdrachten();
          }
          break;
        }
        case 'opdrachtTyp':
        case 'presence':
          ev.id = match[1];
          ev.after = await readFresh();
          break;
        case 'gebruikers':
        case 'school':
          if (cache[relPath] === undefined) break;
          ev.before = cache[relPath];
          ev.after = await readFresh();
          cache[relPath] = ev.after;
          break;
      }
    });

    ev.inScope = changeIsInScope(ev);
    return ev;
  }

  function changeIsInScope(ev) {
    if (ev.year && ev.year !== getConfigSync().activeYear) return false;
    if (!_activeSubject) return true; // admin (or not logged in): every subject
    if (ev.type === 'observatie') {
      return [ev.before, ev.after].some((o) => o && obsMatchesSubject(o, _activeSubject));
    }
    return !ev.subject || ev.subject === _activeSubject;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    applyExternalChange,
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
    getActiveUser,
    setActiveUser,
    isAdminActive,
    loadUsers,
    upsertUser,
    loadSchool,
    saveSchool,
    getSchoolSync,
    saveLastSession,
    loadLastSession,
    saveFilterState,
    loadFilterState,
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
    setExamNTerm,
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
    studentHasAnyScores,
    obsIsUsedInAnyExam,
    removeObsFromExamScores,
    getResitsSync,
    examHasResits,
    computeBestGradeMap,
    resolveBestAttempts,
    getOpdrachtenSync,
    getOpdrachten,
    upsertOpdracht,
    deleteOpdracht,
  };
})();
