import {
  escHtml,
  SEL,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
  getAdminSubjectFilter,
} from '../app.js';
import { gradeStatHtml } from '../utils/grades.js';
import { openGroupStudentsModal } from './leerlingen.js';

// ── Modal imports (used directly in this screen file) ───────────────────────
import {
  openGroupModal,
  deleteGroup,
  openGroupCSVImport,
  openGroupAssignmentCSVImport,
} from '../modals/groep-edit.js';

// ── Re-exports for backward compatibility ───────────────────────────────────
export {
  openGroupModal,
  deleteGroup,
  openGroupCSVImport,
  openGroupAssignmentCSVImport,
} from '../modals/groep-edit.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Groepen
// ═══════════════════════════════════════════════════════════════════════════════

export function renderGroepen() {
  const cfg = Store.getConfigSync();
  const years = [...Store.listYearsSync()];
  if (!years.includes(cfg.activeYear)) years.unshift(cfg.activeYear);

  const currentYear = SEL.groupsYear.getValue() || cfg.activeYear;
  SEL.groupsYear.setOptions(years.map((y) => ({ value: y, label: y })));
  SEL.groupsYear.setValue(years.includes(currentYear) ? currentYear : years[0]);

  const isAdmin = Store.isAdminActive();
  const btnAdd = document.getElementById('btn-add-group');
  const btnImport = document.getElementById('btn-import-groups');
  const btnImportAssignment = document.getElementById('btn-import-group-assignment');
  btnAdd.classList.toggle('hidden', !isAdmin);
  btnImport.classList.toggle('hidden', !isAdmin);
  btnImportAssignment.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    btnAdd.onclick = () => openGroupModal(null);
    btnImport.onclick = () => openGroupCSVImport();
    btnImportAssignment.onclick = () => openGroupAssignmentCSVImport();
  }
  renderGroepenForYear(SEL.groupsYear.getValue());
}

const SUBCATEGORY_TO_FILTER = {
  onderbouw: 'OB',
  wisa: 'WisA',
  wisb: 'WisB',
  wisc: 'WisC',
  wisd: 'WisD',
};

export async function renderGroepenForYear(year) {
  let groups = Store.getGroupsSync(year);
  const students = Store.getStudentsSync(year);
  const users = await Store.loadUsers();
  const container = document.getElementById('group-list');

  // Admin: filter by selected subject in the topbar filter bar
  if (Store.isAdminActive()) {
    const adminSubj = getAdminSubjectFilter();
    if (adminSubj) {
      groups = groups.filter((g) => g.subject === adminSubj);
    }
  }

  const activeSubject = Store.isAdminActive() ? getAdminSubjectFilter() : Store.getActiveSubject();
  const schoolsoortFilter = getSchoolsoortFilter();
  const jaarlagFilter = getJaarlagFilter();
  const jaarlagKlasFilter = getJaarlagKlasFilter();
  const eigenOnly = getEigenOnly();
  const activeUser = Store.getActiveUser();

  // Schoolsoort filter — always applied (empty set = show nothing)
  groups = groups.filter((g) => (g.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss)));

  // Jaarlaag filter
  if (activeSubject === 'wi') {
    // Klas 1-6 filter (by numeric jaarlaag)
    groups = groups.filter((g) => jaarlagKlasFilter.has(String(g.jaarlaag)));
    // Subcategory filter (OB / WisA / WisB / WisC / WisD)
    groups = groups.filter((g) => {
      const filterKey = SUBCATEGORY_TO_FILTER[g.subcategory ?? ''];
      return filterKey ? jaarlagFilter.has(filterKey) : true;
    });
  } else {
    groups = groups.filter((g) => jaarlagFilter.has(String(g.jaarlaag)));
  }

  // Eigen filter
  if (eigenOnly && activeUser && !Store.isAdminActive()) {
    groups = groups.filter((g) => (g.docenten ?? []).includes(activeUser.id));
  }

  groups.sort(
    (a, b) =>
      String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
      a.name.localeCompare(b.name)
  );

  if (groups.length === 0) {
    container.innerHTML = `<p class="hint">Geen groepen voor ${escHtml(year)}.</p>`;
    return;
  }

  let html = '';
  let lastJl = null;
  for (const g of groups) {
    const jl = String(g.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    const memberNames = g.student_ids
      .map((id) => {
        const s = students.find((s) => s.id === id);
        return s ? s.voornaam || Store.fullName(s) : `#${id}`;
      })
      .sort()
      .join(', ');
    const schoolsoortText = (g.schoolsoort ?? []).join(', ') || '—';
    const docentNames =
      (g.docenten ?? [])
        .map((did) => {
          const u = users.find((u) => u.id === did);
          return u ? [u.voornaam, u.tussenvoegsel, u.achternaam].filter(Boolean).join(' ') : null;
        })
        .filter(Boolean)
        .join(', ') || '—';
    html += `
      <div class="card">
        <div class="card-main">
          <button class="student-name-btn group-name-btn" data-action="open-group" data-id="${escHtml(g.id)}" ${Store.isAdminActive() ? 'disabled' : ''}>${escHtml(g.name)}</button>
          <p class="small muted">${escHtml(schoolsoortText)} &nbsp;·&nbsp; Docent(en): ${escHtml(docentNames)}</p>
          <p class="small muted">${g.student_ids.length} leerlingen${memberNames ? ': ' + escHtml(memberNames) : ''}</p>
          ${g.student_ids.length > 0 ? `<p class="small" data-grade-stats="${escHtml(g.id)}"></p>` : ''}
        </div>
        ${
          Store.isAdminActive()
            ? `
        <div class="card-actions">
          <button class="btn-sm btn-sm-icon" data-action="edit-group" data-id="${escHtml(g.id)}" title="Groep bewerken">✎</button>
          <button class="btn-sm btn-danger btn-sm-icon" data-action="del-group" data-id="${escHtml(g.id)}"${g.student_ids.length > 0 ? ' disabled title="Deze groep heeft leerlingen en kan dus niet worden verwijderd."' : ' title="Groep verwijderen"'}>🗑</button>
        </div>`
            : ''
        }
      </div>`;
  }
  container.innerHTML = html;
  container
    .querySelectorAll('[data-action="open-group"]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        openGroupStudentsModal(
          b.dataset.id,
          SEL.groupsYear.getValue() || Store.getConfigSync().activeYear
        )
      )
    );
  container
    .querySelectorAll('[data-action="edit-group"]')
    .forEach((b) => b.addEventListener('click', () => openGroupModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="del-group"]')
    .forEach((b) => b.addEventListener('click', () => deleteGroup(b.dataset.id)));

  // Fill grade stats asynchronously — does not block initial render
  fillGroupGradeStats(
    groups.filter((g) => g.student_ids.length > 0),
    year,
    container
  );
}

// ── Grade stats helpers ────────────────────────────────────────────────────────

async function calcGroupGradeStats(group, year) {
  const subject = group.subject;
  if (!subject) return null;

  const allStudents = Store.getStudentsSync(year);
  const students = allStudents.filter((s) => group.student_ids.includes(s.id));
  if (students.length === 0) return null;

  const allExams = await Store.getExams(year, subject);
  const exams = allExams.filter(
    (e) => String(e.jaarlaag) === String(group.jaarlaag) && e.volgnummer
  );
  if (exams.length === 0) return null;

  const resitMap = {};
  exams
    .filter((e) => e.parent_id)
    .forEach((e) => {
      (resitMap[e.parent_id] ??= []).push(e);
    });
  const examFamilies = exams
    .filter((e) => !e.parent_id)
    .map((e) => ({
      original: e,
      resits: (resitMap[e.id] ?? []).sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1)),
    }));
  if (examFamilies.length === 0) return null;

  const scoreMap = {};
  await Promise.all(
    students.map(async (s) => {
      const rec = await Store.getStudentScores(s.id, year, subject);
      scoreMap[s.id] = rec?.scores ?? {};
    })
  );

  function studentGrade(s, exam) {
    const examScores = scoreMap[s.id]?.[exam.id];
    if (!examScores || Object.keys(examScores).length === 0) return null;
    const qs = {};
    exam.questions.forEach((q) => {
      const v = examScores[q.id];
      if (v !== undefined) qs[q.id] = v;
    });
    if (Object.keys(qs).length === 0) return null;
    return Store.calcResults(exam, qs).grade;
  }

  function bestGradeForFamily(s, family) {
    const candidates = [family.original, ...family.resits]
      .map((e) => ({ exam: e, grade: studentGrade(s, e) }))
      .filter((x) => x.grade !== null);
    if (candidates.length === 0) return { grade: null };
    return candidates.reduce((a, b) => (b.grade > a.grade ? b : a));
  }

  const yearAvgs = students
    .map((s) => {
      let sumW = 0,
        sumWG = 0;
      for (const f of examFamilies) {
        const { grade } = bestGradeForFamily(s, f);
        if (grade === null) continue;
        const w = Number(f.original.weging ?? 1);
        sumW += w;
        sumWG += w * grade;
      }
      return sumW > 0 ? sumWG / sumW : null;
    })
    .filter((g) => g !== null);

  if (yearAvgs.length === 0) return null;

  const mean = yearAvgs.reduce((a, b) => a + b, 0) / yearAvgs.length;
  const sd =
    yearAvgs.length < 2
      ? 0
      : Math.sqrt(yearAvgs.reduce((s, v) => s + (v - mean) ** 2, 0) / yearAvgs.length);
  const fails = Math.round((yearAvgs.filter((g) => g < 5.5).length / yearAvgs.length) * 100);

  return { mean, sd, fails };
}

async function fillGroupGradeStats(groups, year, container) {
  for (const g of groups) {
    const stats = await calcGroupGradeStats(g, year);
    if (!stats) continue;
    const el = container.querySelector('[data-grade-stats="' + g.id + '"]');
    if (el) el.innerHTML = gradeStatHtml(stats);
  }
}
