/**
 * app.js — Renderer process entry point.
 * Shared services (modal, toast, nav, SEL) + orchestration of all screens.
 * CSP: NO inline event handlers. All cancel buttons use data-close-modal="1".
 */

// ── Screen imports ────────────────────────────────────────────────────────────
import { renderStartup } from './screens/startup.js';
import { renderLeerlingen, renderStudentList, leerlingenState } from './screens/leerlingen.js';
import { renderGroepen, renderGroepenForYear } from './screens/groepen.js';
import { renderToetsen, renderToetsenList } from './screens/toetsen.js';
import { renderObservaties } from './screens/observaties.js';
import { renderRapport, updateRapportExamsByJaarlaag, generateRapport } from './screens/rapport.js';
import { renderGebruikers } from './screens/gebruikers.js';
import { renderSchool } from './screens/school.js';

// ── Navigation ────────────────────────────────────────────────────────────────
const topbar = document.getElementById('topbar');
const screens = {};
document.querySelectorAll('.screen').forEach((el) => {
  screens[el.id.replace('screen-', '')] = el;
});
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
});

export function navigateTo(name) {
  document
    .querySelectorAll('.nav-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  if (name === 'startup') {
    topbar.classList.add('hidden');
  } else {
    topbar.classList.remove('hidden');
  }
  // Gray out admin vakken filter on leerlingen (doesn't apply there)
  const adminFilterDisabled = Store.isAdminActive() && name === 'leerlingen';
  document
    .getElementById('admin-vak-wrap')
    ?.classList.toggle('admin-filter-disabled', adminFilterDisabled);

  // Sync eigen button label for the new screen
  updateEigenLabel(name);

  if (screens[name]) {
    renderScreen(name); // render content (may be async; screen shows immediately)
    screens[name].classList.add('active');
    window.scrollTo(0, 0);
    const targetRow = document.getElementById(`filter-row-${name}`);
    if (targetRow) targetRow.appendChild(filterBar);
  }
}

function renderScreen(name) {
  switch (name) {
    case 'startup':
      return renderStartup();
    case 'leerlingen':
      return renderLeerlingen();
    case 'groepen':
      return renderGroepen();
    case 'toetsen':
      return renderToetsen();
    case 'observaties':
      return renderObservaties();
    case 'rapport':
      return renderRapport();
    case 'gebruikers':
      return renderGebruikers();
    case 'school':
      return renderSchool();
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────
const overlay = document.getElementById('modal-overlay');
const modalBox = document.getElementById('modal-box');
const modalContent = document.getElementById('modal-content');

/** The overlay DOM node, exported for use in csv.js askSchoolYear calls. */
export { overlay as overlayElement };

let _modalCharts = [];

/** Register a Chart.js instance to be destroyed when the modal closes. */
export function pushModalChart(chart) {
  _modalCharts.push(chart);
}

let _onCloseModal = null;

export function showModal(html, onShow, wide = false, onClose) {
  modalContent.innerHTML = html;
  modalBox.classList.remove('modal-xl', 'modal-scores', 'modal-profile');
  if (wide === true) modalBox.classList.add('modal-xl');
  else if (typeof wide === 'string') modalBox.classList.add(wide);
  overlay.classList.remove('hidden');
  _onCloseModal = onClose || null;
  if (onShow) onShow(modalContent);
}

export function closeModal() {
  overlay.classList.add('hidden');
  modalBox.classList.remove('modal-xl', 'modal-scores', 'modal-profile');
  modalContent.innerHTML = '';
  if (_modalCharts) {
    _modalCharts.forEach((c) => {
      try {
        c.destroy();
      } catch (_) {}
    });
    _modalCharts = [];
  }
  const cb = _onCloseModal;
  _onCloseModal = null;
  if (cb) cb();
}

modalContent.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-modal]')) closeModal();
});
document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});

// ── Notifications ─────────────────────────────────────────────────────────────
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

export function persistentError(message) {
  const container = document.getElementById('toast-container');
  for (const existing of container.querySelectorAll('.toast-persistent')) {
    if (existing.dataset.msg === message) return;
  }
  const el = document.createElement('div');
  el.className = 'toast toast-error toast-persistent show';
  el.dataset.msg = message;
  el.innerHTML = `<span>${escHtml(message)}</span><button class="toast-dismiss">✕</button>`;
  el.querySelector('.toast-dismiss').addEventListener('click', () => el.remove());
  container.appendChild(el);
}

// ── Shared utilities ──────────────────────────────────────────────────────────
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatGrade(g) {
  if (g === null || g === undefined) return '—';
  return (Math.round(g * 10) / 10).toFixed(1).replace('.', ',');
}

// ── CustomSelect instances (created once at init, reused every render) ─────────
export const SEL = {}; // populated by initSelects(); exported as live object

function initSelects() {
  SEL.studentYear = new CustomSelect(document.getElementById('student-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: async (v) => {
      await Store.loadYear(v);
      leerlingenState.year = v;
      renderStudentList();
    },
  });
  SEL.groupsYear = new CustomSelect(document.getElementById('groups-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: async (v) => {
      await Store.loadYear(v);
      renderGroepenForYear(v);
    },
  });
  SEL.toetsenYear = new CustomSelect(document.getElementById('toetsen-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: async (v) => {
      await Store.loadYear(v);
      renderToetsenList();
      Store.preloadScores(v);
    },
  });
  SEL.rapportJaarlaag = new CustomSelect(document.getElementById('rapport-jaarlaag-select'), {
    placeholder: '— kies jaarlaag —',
    onChange: (v) => updateRapportExamsByJaarlaag(v),
  });
  SEL.rapportExam = new CustomSelect(document.getElementById('rapport-exam-select'), {
    placeholder: '— kies toets —',
    disabled: true,
    onChange: (v) => {
      if (v) generateRapport(v);
    },
  });
}

// ── Admin vakken filter (popover, single-select) ──────────────────────────────
let _adminSubjectFilter = null; // null = show all

export function getAdminSubjectFilter() {
  return _adminSubjectFilter;
}

const VAKKEN_OPTIONS = [
  { code: 'bio', label: 'Biologie' },
  { code: 'nat', label: 'Natuurkunde' },
  { code: 'schk', label: 'Scheikunde' },
  { code: 'wi', label: 'Wiskunde' },
];

function updateVakLabel() {
  const found = VAKKEN_OPTIONS.find((v) => v.code === _adminSubjectFilter);
  document.getElementById('lbl-filter-vak').textContent = found ? found.label : 'Alle vakken';
  document.getElementById('btn-filter-vak').classList.toggle('filter-btn-active', !!found);
}

function buildVakkenPopover() {
  const container = document.getElementById('pop-vak-toggles');
  container.innerHTML = '';
  for (const { code, label } of VAKKEN_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (_adminSubjectFilter === code ? ' selected' : '');
    btn.textContent = label;
    btn.dataset.vakCode = code;
    btn.addEventListener('click', () => {
      _adminSubjectFilter = _adminSubjectFilter === code ? null : code;
      container
        .querySelectorAll('.filter-pop-toggle')
        .forEach((b) => b.classList.toggle('selected', b.dataset.vakCode === _adminSubjectFilter));
      updateVakLabel();
      rebuildJaarlagPopover(_adminSubjectFilter);
      rerenderActive();
    });
    container.appendChild(btn);
  }
  document.getElementById('pop-vak-alles').addEventListener('click', () => {
    _adminSubjectFilter = null;
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.remove('selected'));
    updateVakLabel();
    rebuildJaarlagPopover(null);
    rerenderActive();
  });
}

document.getElementById('btn-filter-vak').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('pop-ss').classList.add('hidden');
  document.getElementById('pop-jl').classList.add('hidden');
  document.getElementById('pop-vak').classList.toggle('hidden');
});

// ── Filter bar (schoolsoort + jaarlaag + eigen) ───────────────────────────────
const filterBar = document.getElementById('filter-bar');

// Filter state
let _filterState = {
  schoolsoorten: new Set(),
  jaarlagen: new Set(),
  jaarlagenKlas: new Set(),
  eigenOnly: false,
};
let _activeUserId = null;

// The jaarlaag options depend on current subject
const WI_JAARLAG_OPTIONS = [
  { key: 'OB', label: 'Onderbouw' },
  { key: 'WisA', label: 'Wiskunde A' },
  { key: 'WisB', label: 'Wiskunde B' },
  { key: 'WisC', label: 'Wiskunde C' },
  { key: 'WisD', label: 'Wiskunde D' },
];
const KLAS_JAARLAG_OPTIONS = [
  { key: '1', label: 'Klas 1' },
  { key: '2', label: 'Klas 2' },
  { key: '3', label: 'Klas 3' },
  { key: '4', label: 'Klas 4' },
  { key: '5', label: 'Klas 5' },
  { key: '6', label: 'Klas 6' },
];

export function getSchoolsoortFilter() {
  return _filterState.schoolsoorten;
}
export function getJaarlagFilter() {
  return _filterState.jaarlagen;
}
export function getJaarlagKlasFilter() {
  return _filterState.jaarlagenKlas;
}
export function getEigenOnly() {
  return _filterState.eigenOnly;
}

// ── Label helpers ─────────────────────────────────────────────────────────────
function schoolsoortLabel(selected, allOptions) {
  if (selected.size === allOptions.length) return 'Alle schoolsoorten';
  const arr = allOptions.filter((s) => selected.has(s));
  if (arr.length === 0) return 'Geen schoolsoorten';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} & ${arr[1]}`;
  return `${arr[0]}, ${arr[1]} +${arr.length - 2}`;
}

function jaarlagLabel(selected, options) {
  const allKeys = options.map((o) => o.key);
  if (selected.size === allKeys.length && allKeys.every((k) => selected.has(k))) {
    // All selected
    if (options === WI_JAARLAG_OPTIONS) return 'Onder- & bovenbouw';
    return 'Alle jaarlagen';
  }
  if (options === WI_JAARLAG_OPTIONS) {
    const hasOB = selected.has('OB');
    const wisKeys = ['WisA', 'WisB', 'WisC', 'WisD'];
    const selWis = wisKeys.filter((k) => selected.has(k));
    if (selected.size === 0) return 'Geen';
    if (!hasOB && selWis.length === wisKeys.length) return 'Bovenbouw';
    if (hasOB && selWis.length === 0) return 'Onderbouw';
    const wisLetters = selWis.map((k) => k.replace('Wis', ''));
    const wisStr = wisLetters.length === 0 ? '' : listLabel(wisLetters, 'Wis ');
    if (hasOB && selWis.length > 0) return `OB & ${wisStr}`;
    return wisStr;
  }
  // Klas 1-6
  const klassen = [...selected].sort((a, b) => Number(a) - Number(b));
  if (klassen.length === 0) return 'Geen klassen';
  return 'Klas ' + listLabel(klassen);
}

function listLabel(items, prefix = '') {
  if (items.length === 1) return prefix + items[0];
  return prefix + items.slice(0, -1).join(', ') + ' & ' + items[items.length - 1];
}

const EIGEN_LABELS = {
  leerlingen: { alle: 'Alle leerlingen', eigen: 'Eigen leerlingen' },
  groepen: { alle: 'Alle groepen', eigen: 'Eigen groepen' },
  toetsen: { alle: 'Alle toetsen', eigen: 'Eigen toetsen' },
  observaties: { alle: 'Alle observaties', eigen: 'Observaties eigen groepen' },
};

function updateEigenLabel(screenName) {
  const map = EIGEN_LABELS[screenName];
  if (!map) return;
  const lbl = _filterState.eigenOnly ? map.eigen : map.alle;
  document.getElementById('lbl-filter-eigen').textContent = lbl;
  document
    .getElementById('btn-filter-eigen')
    .classList.toggle('filter-btn-active', _filterState.eigenOnly);
}

// ── Popover open/close ────────────────────────────────────────────────────────
function closeAllPopovers() {
  document.getElementById('pop-vak').classList.add('hidden');
  document.getElementById('pop-ss').classList.add('hidden');
  document.getElementById('pop-jl-klas').classList.add('hidden');
  document.getElementById('pop-jl').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.filter-popover-wrap')) closeAllPopovers();
});

document.getElementById('btn-filter-ss').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('pop-jl-klas').classList.add('hidden');
  document.getElementById('pop-jl').classList.add('hidden');
  document.getElementById('pop-ss').classList.toggle('hidden');
});

document.getElementById('btn-filter-jl-klas').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('pop-ss').classList.add('hidden');
  document.getElementById('pop-jl').classList.add('hidden');
  document.getElementById('pop-jl-klas').classList.toggle('hidden');
});

document.getElementById('btn-filter-jl').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('pop-ss').classList.add('hidden');
  document.getElementById('pop-jl-klas').classList.add('hidden');
  document.getElementById('pop-jl').classList.toggle('hidden');
});

// ── Schoolsoort popover builder ───────────────────────────────────────────────
let _schoolsoortOptions = []; // list of strings from school.json

function buildSchoolsoortPopover(options, savedSelection) {
  _schoolsoortOptions = options;
  const selection = savedSelection ?? new Set(options);
  _filterState.schoolsoorten = selection;

  const container = document.getElementById('pop-ss-toggles');
  container.innerHTML = '';
  for (const ss of options) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (selection.has(ss) ? ' selected' : '');
    btn.textContent = ss;
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        _filterState.schoolsoorten.add(ss);
      } else {
        _filterState.schoolsoorten.delete(ss);
      }
      updateSchoolsoortLabel();
      persistFilters();
      rerenderActive();
    });
    container.appendChild(btn);
  }

  document.getElementById('pop-ss-alles').addEventListener('click', () => {
    _filterState.schoolsoorten = new Set(_schoolsoortOptions);
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.add('selected'));
    updateSchoolsoortLabel();
    persistFilters();
    rerenderActive();
  });
  document.getElementById('pop-ss-niets').addEventListener('click', () => {
    _filterState.schoolsoorten = new Set();
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.remove('selected'));
    updateSchoolsoortLabel();
    persistFilters();
    rerenderActive();
  });

  updateSchoolsoortLabel();
}

function updateSchoolsoortLabel() {
  document.getElementById('lbl-filter-ss').textContent = schoolsoortLabel(
    _filterState.schoolsoorten,
    _schoolsoortOptions
  );
}

// ── Jaarlaag popover builder ──────────────────────────────────────────────────
let _jaarlagOptions = KLAS_JAARLAG_OPTIONS;

function rebuildJaarlagPopover(subject, savedSelection) {
  _jaarlagOptions = subject === 'wi' ? WI_JAARLAG_OPTIONS : KLAS_JAARLAG_OPTIONS;
  const allKeys = _jaarlagOptions.map((o) => o.key);
  const selection = savedSelection ?? new Set(allKeys);
  _filterState.jaarlagen = selection;

  const container = document.getElementById('pop-jl-toggles');
  container.innerHTML = '';
  for (const { key, label } of _jaarlagOptions) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (selection.has(key) ? ' selected' : '');
    btn.textContent = label;
    btn.dataset.jlKey = key;
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        _filterState.jaarlagen.add(key);
      } else {
        _filterState.jaarlagen.delete(key);
      }
      updateJaarlagLabel();
      persistFilters();
      rerenderActive();
    });
    container.appendChild(btn);
  }

  // Re-bind Alles/Niets (remove old listeners by replacing the elements)
  const allesOld = document.getElementById('pop-jl-alles');
  const allesNew = allesOld.cloneNode(true);
  allesOld.replaceWith(allesNew);
  allesNew.addEventListener('click', () => {
    _filterState.jaarlagen = new Set(_jaarlagOptions.map((o) => o.key));
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.add('selected'));
    updateJaarlagLabel();
    persistFilters();
    rerenderActive();
  });

  const nietsOld = document.getElementById('pop-jl-niets');
  const nietsNew = nietsOld.cloneNode(true);
  nietsOld.replaceWith(nietsNew);
  nietsNew.addEventListener('click', () => {
    _filterState.jaarlagen = new Set();
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.remove('selected'));
    updateJaarlagLabel();
    persistFilters();
    rerenderActive();
  });

  updateJaarlagLabel();

  // Show/hide the Klas 1-6 popover (only for wiskunde)
  const jlKlasWrap = document.getElementById('jl-klas-wrap');
  const isWi = subject === 'wi';
  jlKlasWrap.classList.toggle('hidden', !isWi);
  if (isWi) {
    buildJaarlagKlasPopover();
  } else {
    _filterState.jaarlagenKlas = new Set(KLAS_JAARLAG_OPTIONS.map((o) => o.key));
  }
}

function updateJaarlagLabel() {
  document.getElementById('lbl-filter-jl').textContent = jaarlagLabel(
    _filterState.jaarlagen,
    _jaarlagOptions
  );
}

// ── Jaarlaag-klas popover builder (wiskunde only, Klas 1–6) ──────────────────
function buildJaarlagKlasPopover(savedSelection) {
  const allKeys = KLAS_JAARLAG_OPTIONS.map((o) => o.key);
  const selection = savedSelection ?? new Set(allKeys);
  _filterState.jaarlagenKlas = selection;

  const container = document.getElementById('pop-jl-klas-toggles');
  container.innerHTML = '';
  for (const { key, label } of KLAS_JAARLAG_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (selection.has(key) ? ' selected' : '');
    btn.textContent = label;
    btn.dataset.jlklasKey = key;
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        _filterState.jaarlagenKlas.add(key);
      } else {
        _filterState.jaarlagenKlas.delete(key);
      }
      updateJaarlagKlasLabel();
      persistFilters();
      rerenderActive();
    });
    container.appendChild(btn);
  }

  const allesOld = document.getElementById('pop-jl-klas-alles');
  const allesNew = allesOld.cloneNode(true);
  allesOld.replaceWith(allesNew);
  allesNew.addEventListener('click', () => {
    _filterState.jaarlagenKlas = new Set(KLAS_JAARLAG_OPTIONS.map((o) => o.key));
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.add('selected'));
    updateJaarlagKlasLabel();
    persistFilters();
    rerenderActive();
  });

  const nietsOld = document.getElementById('pop-jl-klas-niets');
  const nietsNew = nietsOld.cloneNode(true);
  nietsOld.replaceWith(nietsNew);
  nietsNew.addEventListener('click', () => {
    _filterState.jaarlagenKlas = new Set();
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.remove('selected'));
    updateJaarlagKlasLabel();
    persistFilters();
    rerenderActive();
  });

  updateJaarlagKlasLabel();
}

function updateJaarlagKlasLabel() {
  document.getElementById('lbl-filter-jl-klas').textContent = jaarlagLabel(
    _filterState.jaarlagenKlas,
    KLAS_JAARLAG_OPTIONS
  );
}

// ── Eigen toggle ──────────────────────────────────────────────────────────────
document.getElementById('btn-filter-eigen').addEventListener('click', () => {
  _filterState.eigenOnly = !_filterState.eigenOnly;
  const active = document.querySelector('.screen.active');
  const screenName = active?.id.replace('screen-', '') ?? 'leerlingen';
  updateEigenLabel(screenName);
  persistFilters();
  rerenderActive();
});

// ── Persist & re-render helpers ───────────────────────────────────────────────
function persistFilters() {
  if (_activeUserId) Store.saveFilterState(_activeUserId, _filterState);
}

function rerenderActive() {
  const active = document.querySelector('.screen.active');
  if (active && active.id !== 'screen-startup') {
    renderScreen(active.id.replace('screen-', ''));
  }
}

// ── Init filter bar on login ──────────────────────────────────────────────────
async function initFilterBar(user, subject) {
  _activeUserId = user.id;
  const school = Store.getSchoolSync();
  const schoolSoorten = school.schoolsoort ?? [];
  const saved = await Store.loadFilterState(user.id);

  // Admin vakken popover (single-select, not persisted per-user — always starts at null)
  if (user.isAdmin) {
    _adminSubjectFilter = null;
    buildVakkenPopover();
    updateVakLabel();
  }

  // Schoolsoort popover
  const savedSS = saved?.schoolsoorten ? new Set(saved.schoolsoorten) : null;
  buildSchoolsoortPopover(schoolSoorten, savedSS);

  // Jaarlaag popover (for admin: subject is null initially)
  const savedJL = saved?.jaarlagen ? new Set(saved.jaarlagen) : null;
  rebuildJaarlagPopover(user.isAdmin ? null : subject, savedJL);

  // Jaarlaag klas popover (wi only) — re-apply saved selection on top of default
  if (!user.isAdmin && subject === 'wi' && saved?.jaarlagenKlas) {
    buildJaarlagKlasPopover(new Set(saved.jaarlagenKlas));
  }

  // Eigen
  _filterState.eigenOnly = saved?.eigenOnly ?? false;
}

// ── User badge (topbar) ───────────────────────────────────────────────────────
const userBadgeBtn = document.getElementById('user-badge-btn');

export async function showUserBadge(user, subject) {
  const shape = user.isAdmin ? 'badge-square' : 'badge-circle';
  userBadgeBtn.className = `user-badge-mini ${shape}`;
  userBadgeBtn.style.setProperty('--badge-color', user.kleur ?? '#888');
  userBadgeBtn.textContent = user.afkorting || user.voornaam[0] || '?';
  userBadgeBtn.title = `${user.voornaam} — klik om uit te loggen`;
  userBadgeBtn.classList.remove('hidden');

  // Admin sees vakken popover; teacher sees eigen toggle
  document.getElementById('admin-vak-wrap').classList.toggle('hidden', !user.isAdmin);
  document.getElementById('btn-filter-eigen').classList.toggle('hidden', user.isAdmin);

  await initFilterBar(user, subject);
  applyRoleVisibility(user);
}

function applyRoleVisibility(user) {
  const adminOnly = ['gebruikers', 'school'];
  const teacherOnly = ['toetsen', 'observaties', 'rapport'];
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    const screen = btn.dataset.screen;
    if (user.isAdmin) {
      btn.classList.toggle('hidden', teacherOnly.includes(screen));
    } else {
      btn.classList.toggle('hidden', adminOnly.includes(screen));
    }
  });
}

userBadgeBtn.addEventListener('click', () => {
  userBadgeBtn.classList.add('hidden');
  _adminSubjectFilter = null;
  _activeUserId = null;
  navigateTo('startup');
});

// ── Watermerk ─────────────────────────────────────────────────────────────────
async function applyWatermerk() {
  const dataUrl = await window.rtti.readPhotoAsDataUrl('fotos/school-watermerk.svg');
  if (dataUrl) document.documentElement.style.setProperty('--watermerk-url', `url("${dataUrl}")`);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await Store.preload();
  applyWatermerk();
  initSelects();
  navigateTo('startup');
}

init();
