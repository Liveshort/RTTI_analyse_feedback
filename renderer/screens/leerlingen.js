import { ICONS } from '../utils/icons.js';
import {
  escHtml,
  SEL,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
} from '../app.js';
import { openProfielModal } from '../modals/profiel.js';
import { openStudentModal, deleteStudent, openStudentCSVImport } from '../modals/leerling-edit.js';

// Re-export modals so existing consumers keep working
export { openGroupStudentsModal } from '../modals/groep-leerlingen.js';
export { openProfielModal } from '../modals/profiel.js';
export { openStudentModal, deleteStudent, openStudentCSVImport } from '../modals/leerling-edit.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Leerlingen
// ═══════════════════════════════════════════════════════════════════════════════

export const leerlingenState = { year: null, search: '' };

export const JAARLAGEN = ['1', '2', '3', '4', '5', '6'];
export const SCHOOLSOORTEN = [
  'Vmbo-bb',
  'Vmbo-kb',
  'Vmbo-gl',
  'Vmbo-tl',
  'Havo',
  'Vwo',
  'Gymnasium',
];

export function renderLeerlingen() {
  const cfg = Store.getConfigSync();
  const allYears = [...Store.listYearsSync()];
  if (!allYears.includes(cfg.activeYear)) allYears.unshift(cfg.activeYear);

  SEL.studentYear.setOptions(allYears.map((y) => ({ value: y, label: y })));
  if (!leerlingenState.year || !allYears.includes(leerlingenState.year))
    leerlingenState.year = cfg.activeYear;
  SEL.studentYear.setValue(leerlingenState.year);

  const searchInput = document.getElementById('student-search');
  searchInput.value = leerlingenState.search;
  searchInput.oninput = () => {
    leerlingenState.search = searchInput.value;
    renderStudentList();
  };

  const isAdmin = Store.isAdminActive();
  const btnAdd = document.getElementById('btn-add-student');
  const btnImport = document.getElementById('btn-import-students');
  btnAdd.classList.toggle('hidden', !isAdmin);
  btnImport.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    btnAdd.onclick = () => openStudentModal(null);
    btnImport.onclick = () => openStudentCSVImport();
  }

  renderStudentList();
}

export function renderStudentList() {
  const year = leerlingenState.year;
  const query = leerlingenState.search.trim().toLowerCase();
  const container = document.getElementById('student-list');

  let students = [...Store.getStudentsSync(year)];

  const activeSubject = Store.getActiveSubject();
  const schoolsoortFilter = getSchoolsoortFilter();
  const jaarlagFilter = getJaarlagFilter();
  const jaarlagKlasFilter = getJaarlagKlasFilter();
  const eigenOnly = getEigenOnly();
  const activeUser = Store.getActiveUser();

  // Schoolsoort filter — always applied (empty set = show nothing)
  students = students.filter((s) => (s.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss)));

  // Jaarlaag filter
  if (activeSubject === 'wi') {
    // Klas 1-6 filter (by numeric jaarlaag)
    students = students.filter((s) => jaarlagKlasFilter.has(String(s.jaarlaag ?? '')));
    // Subcategory filter: OB covers jaarlaag 1-3; any WisX covers jaarlaag 4-6
    const allowedJl = new Set();
    if (jaarlagFilter.has('OB')) {
      allowedJl.add('1');
      allowedJl.add('2');
      allowedJl.add('3');
    }
    if (
      jaarlagFilter.has('WisA') ||
      jaarlagFilter.has('WisB') ||
      jaarlagFilter.has('WisC') ||
      jaarlagFilter.has('WisD')
    ) {
      allowedJl.add('4');
      allowedJl.add('5');
      allowedJl.add('6');
    }
    students = students.filter((s) => allowedJl.has(String(s.jaarlaag ?? '')));
  } else {
    students = students.filter((s) => jaarlagFilter.has(String(s.jaarlaag ?? '')));
  }

  // Eigen filter: student must be in at least one group where teacher is a docent
  if (eigenOnly && activeUser && !Store.isAdminActive()) {
    const myGroups = Store.getGroupsSync(year).filter((g) =>
      (g.docenten ?? []).includes(activeUser.id)
    );
    const myStudentIds = new Set(myGroups.flatMap((g) => g.student_ids));
    students = students.filter((s) => myStudentIds.has(s.id));
  }

  // Filter by search (after sort so filtered results stay ordered)
  if (query) {
    students = students.filter(
      (s) =>
        Store.fullName(s).toLowerCase().includes(query) ||
        String(s.id).includes(query) ||
        (s.stamklas ?? '').toLowerCase().includes(query)
    );
  }

  if (students.length === 0) {
    container.innerHTML = query
      ? '<p class="hint">Geen leerlingen gevonden voor deze zoekopdracht.</p>'
      : '<p class="hint">Geen leerlingen voor dit schooljaar. Voeg leerlingen toe of kies een ander schooljaar.</p>';
    return;
  }

  let html = '';
  let lastJl = null;
  let lastSk = null;

  for (const s of students) {
    const stamklas = s.stamklas || '—';
    const jl = Store.jaarlaagFromStamklas(stamklas) || '—';
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
      lastSk = null;
    }
    if (stamklas !== lastSk) {
      html += `<div class="section-heading-stamklas">${escHtml(stamklas)}</div>`;
      lastSk = stamklas;
    }
    html += `
      <div class="card">
        <div class="card-main">
          <div class="student-card-row">
            <button class="student-name-btn" data-action="profile" data-id="${s.id}" ${Store.isAdminActive() ? 'disabled' : ''}>${escHtml(Store.fullName(s))}</button>
            <span class="card-sep">·</span>
            <span class="student-id-inline">${s.id}${s._geslacht ? ' · ' + escHtml(s._geslacht) : ''}</span>
          </div>
        </div>
        ${
          Store.isAdminActive()
            ? `
        <div class="card-actions">
          <button class="btn-sm btn-sm-icon" data-action="edit-student" data-id="${s.id}" title="Leerling bewerken">${ICONS.pen}</button>
          <button class="btn-sm btn-danger btn-sm-icon" data-action="del-student" data-id="${s.id}" title="Leerling verwijderen">${ICONS.trash}</button>
        </div>`
            : ''
        }
      </div>`;
  }
  container.innerHTML = html;

  const _peers = students; // capture current filtered+sorted list for nav
  container
    .querySelectorAll('[data-action="profile"]')
    .forEach((b) =>
      b.addEventListener('click', () => openProfielModal(Number(b.dataset.id), null, _peers))
    );
  container
    .querySelectorAll('[data-action="edit-student"]')
    .forEach((b) => b.addEventListener('click', () => openStudentModal(Number(b.dataset.id))));
  container
    .querySelectorAll('[data-action="del-student"]')
    .forEach((b) => b.addEventListener('click', () => deleteStudent(Number(b.dataset.id))));

  // Disable Verwijderen for students that cannot be deleted (non-blocking)
  for (const s of students) {
    const checkHasScores = Store.isAdminActive()
      ? Store.studentHasAnyScores(s.id)
      : Store.studentHasScores(s.id, year);

    checkHasScores.then((hasScores) => {
      const btn = container.querySelector(
        `[data-action="del-student"][data-id="${CSS.escape(String(s.id))}"]`
      );
      if (!btn) return;
      if (hasScores) {
        btn.disabled = true;
        btn.title =
          'Er zijn scores ingevoerd voor deze leerling, de leerling kan dus niet worden verwijderd.';
        return;
      }
      if (Store.isAdminActive()) {
        // Also block if the student is in any group in any loaded year
        const allGroups = Store.getGroupsSync(year);
        const inGroup = allGroups.some((g) => (g.student_ids ?? []).includes(s.id));
        if (inGroup) {
          btn.disabled = true;
          btn.title = 'Deze leerling zit in een groep en kan dus niet worden verwijderd.';
        }
      }
    });
  }
}
