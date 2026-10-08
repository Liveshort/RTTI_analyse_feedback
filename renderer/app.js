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
import { renderOpdrachten } from './screens/opdrachten.js';
import { openEditor } from './modals/editor.js';
import { renderGebruikers } from './screens/gebruikers.js';
import { renderSchool } from './screens/school.js';
import * as Sync from './sync.js';
import * as Presence from './presence.js';

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

  // Opdrachten: replace the eigen toggle with the observatie filter
  document
    .getElementById('obs-filter-wrap')
    .classList.toggle('filter-screen-hidden', name !== 'opdrachten');
  document
    .getElementById('btn-filter-eigen')
    .classList.toggle('filter-screen-hidden', name === 'opdrachten');

  _screenRefreshPending = false;
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
    case 'opdrachten':
      return renderOpdrachten();
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

/** Open the full-screen Typst editor for an assignment. Imported from modals/editor.js. */
export { openEditor };

let _modalCharts = [];

/** Register a Chart.js instance to be destroyed when the modal closes. */
export function pushModalChart(chart) {
  _modalCharts.push(chart);
}

let _onCloseModal = null;

function destroyModalCharts() {
  _modalCharts.forEach((c) => {
    try {
      c.destroy();
    } catch (_) {}
  });
  _modalCharts = [];
}

export function showModal(html, onShow, wide = false, onClose) {
  _modalSession++;
  clearModalSubs();
  destroyModalCharts();
  modalContent.innerHTML = html;
  modalBox.classList.remove('modal-xl', 'modal-scores', 'modal-profile', 'modal-pdf');
  if (wide === true) modalBox.classList.add('modal-xl');
  else if (typeof wide === 'string') modalBox.classList.add(wide);
  overlay.classList.remove('hidden');
  _onCloseModal = onClose || null;
  if (onShow) onShow(modalContent);
}

export function closeModal() {
  _modalSession++;
  clearModalSubs();
  overlay.classList.add('hidden');
  modalBox.classList.remove('modal-xl', 'modal-scores', 'modal-profile', 'modal-pdf');
  modalContent.innerHTML = '';
  destroyModalCharts();
  const cb = _onCloseModal;
  _onCloseModal = null;
  if (cb) cb();
  if (_screenRefreshPending) scheduleScreenRefresh();
}

modalContent.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-modal]')) closeModal();
});
document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});

// ── Background changes while a modal is open ──────────────────────────────────
// Subscriptions made with onModalSync() end automatically when the modal closes
// or is replaced by another one, so modals never react to changes after they
// are gone. _modalSession changes on every open/close for the same reason.
let _modalSubs = [];
let _modalSession = 0;

function clearModalSubs() {
  _modalSubs.forEach((off) => off());
  _modalSubs = [];
}

/** Subscribe to background changes of `type` for as long as the current modal is open. */
export function onModalSync(type, handler) {
  _modalSubs.push(Sync.on(type, handler));
}

/** Run fn when the current modal closes or is replaced by another one. */
export function onModalCleanup(fn) {
  _modalSubs.push(fn);
}

/**
 * Returns a function that runs `reopen` (re-running the modal's open function)
 * at most once per `ms`, keeping the modal's scroll position. Does nothing if
 * the modal has been closed or replaced in the meantime. Used for modals that
 * only display data, so they can refresh silently.
 */
export function modalRefresher(reopen, ms = 500) {
  const session = _modalSession;
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (session !== _modalSession || document.getElementById('reload-notice')) return;
      const y = modalBox.scrollTop;
      await reopen();
      modalBox.scrollTop = y;
    }, ms);
  };
}

/** Full name of the user who made a background change, or 'een collega' if unknown. */
export async function changedByName(ev) {
  const id = ev.meta?.updatedBy ?? ev.after?._meta?.updatedBy;
  const user = id ? (await Store.loadUsers()).find((u) => u.id === id) : null;
  return user ? Store.fullName(user) : 'een collega';
}

/**
 * Blocking notice on top of an open modal whose data changed in the background.
 * OK calls onOk (typically: close and reopen the modal). Only one notice is
 * shown at a time; the reload that follows picks up any later changes too.
 */
export function showReloadNotice(message, onOk) {
  if (document.getElementById('reload-notice')) return;
  const el = document.createElement('div');
  el.id = 'reload-notice';
  el.className = 'reload-notice-backdrop';
  el.innerHTML = `
    <div class="reload-notice" role="alertdialog" aria-modal="true" aria-labelledby="reload-notice-msg">
      <p id="reload-notice-msg">${escHtml(message)}</p>
      <button class="btn-primary">OK</button>
    </div>`;
  const btn = el.querySelector('button');
  btn.addEventListener('click', async () => {
    el.remove();
    await onOk?.();
  });
  document.body.appendChild(el);
  btn.focus();
}

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
  closeAllPopovers('pop-vak');
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

/**
 * True when an item with these jaarlagen passes the jaarlaag filter(s).
 * Items without jaarlagen always pass. For wiskunde the OB/WisX filter maps
 * to klas 1-3 / 4-6 and is combined with the Klas 1-6 filter.
 */
export function matchesJaarlaagFilter(jaarlagen) {
  const jls = (jaarlagen ?? []).map(String);
  if (jls.length === 0) return true;
  if (_jaarlagOptions !== WI_JAARLAG_OPTIONS) {
    return jls.some((jl) => _filterState.jaarlagen.has(jl));
  }
  const allowed = new Set();
  if (_filterState.jaarlagen.has('OB')) ['1', '2', '3'].forEach((k) => allowed.add(k));
  if (['WisA', 'WisB', 'WisC', 'WisD'].some((k) => _filterState.jaarlagen.has(k))) {
    ['4', '5', '6'].forEach((k) => allowed.add(k));
  }
  return jls.some((jl) => allowed.has(jl) && _filterState.jaarlagenKlas.has(jl));
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
const FILTER_POPOVER_IDS = ['pop-vak', 'pop-ss', 'pop-jl-klas', 'pop-jl', 'pop-obs'];

function closeAllPopovers(except) {
  FILTER_POPOVER_IDS.filter((id) => id !== except).forEach((id) =>
    document.getElementById(id).classList.add('hidden')
  );
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.filter-popover-wrap')) closeAllPopovers();
});

for (const [btnId, popId] of [
  ['btn-filter-ss', 'pop-ss'],
  ['btn-filter-jl-klas', 'pop-jl-klas'],
  ['btn-filter-jl', 'pop-jl'],
  ['btn-filter-obs', 'pop-obs'],
]) {
  document.getElementById(btnId).addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopovers(popId);
    document.getElementById(popId).classList.toggle('hidden');
  });
}

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

// ── Observatie popover (opdrachten only) ──────────────────────────────────────
// Options are supplied by the opdrachten screen (observaties matching the current
// schoolsoort/jaarlaag filters). The selection is kept across option changes so
// that narrowing and widening the other filters does not lose it.
let _obsFilter = null; // null = alle observaties (no filtering), else Set of obs ids
let _obsFilterOptions = []; // [{ id, naam, icon }]

/** Effective observatie filter: null (no filtering) or the selected ids among the current options. */
export function getObservatieFilter() {
  if (!_obsFilter) return null;
  return new Set(_obsFilterOptions.map((o) => o.id).filter((id) => _obsFilter.has(id)));
}

export function setObservatieFilterOptions(options) {
  const sameOptions =
    options.length === _obsFilterOptions.length &&
    options.every((o, i) => o.id === _obsFilterOptions[i].id);
  _obsFilterOptions = options;
  if (!sameOptions) buildObservatiePopover();
  updateObservatieLabel();
}

function obsIsSelected(id) {
  return !_obsFilter || _obsFilter.has(id);
}

function buildObservatiePopover() {
  const container = document.getElementById('pop-obs-toggles');
  container.innerHTML = '';
  if (_obsFilterOptions.length === 0) {
    container.innerHTML =
      '<div class="filter-pop-empty">Geen observaties voor deze schoolsoort en jaarlagen.</div>';
    return;
  }
  for (const obs of _obsFilterOptions) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (obsIsSelected(obs.id) ? ' selected' : '');
    btn.textContent = `${obs.icon ?? ''} ${obs.naam ?? ''}`.trim();
    btn.title = obs.naam ?? '';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_obsFilter) _obsFilter = new Set(_obsFilterOptions.map((o) => o.id));
      if (_obsFilter.has(obs.id)) _obsFilter.delete(obs.id);
      else _obsFilter.add(obs.id);
      // Everything selected again → back to "no filtering"
      if (_obsFilterOptions.every((o) => _obsFilter.has(o.id))) _obsFilter = null;
      btn.classList.toggle('selected', obsIsSelected(obs.id));
      updateObservatieLabel();
      rerenderActive();
    });
    container.appendChild(btn);
  }
}

function updateObservatieLabel() {
  const sel = getObservatieFilter();
  let label = 'Alle observaties';
  if (sel && sel.size === 0) label = 'Geen observaties';
  else if (sel && sel.size === 1) {
    const obs = _obsFilterOptions.find((o) => sel.has(o.id));
    label = `${obs.icon ?? ''} ${obs.naam ?? ''}`.trim();
  } else if (sel) label = `${sel.size} observaties`;
  document.getElementById('lbl-filter-obs').textContent = label;
  document.getElementById('btn-filter-obs').classList.toggle('filter-btn-active', !!sel);
}

document.getElementById('pop-obs-alles').addEventListener('click', () => {
  _obsFilter = null;
  buildObservatiePopover();
  updateObservatieLabel();
  rerenderActive();
});
document.getElementById('pop-obs-niets').addEventListener('click', () => {
  _obsFilter = new Set();
  buildObservatiePopover();
  updateObservatieLabel();
  rerenderActive();
});

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
  userBadgeBtn.dataset.len = userBadgeBtn.textContent.length;
  userBadgeBtn.title = `${user.voornaam} — klik om uit te loggen`;
  userBadgeBtn.classList.remove('hidden');

  // Admin sees vakken popover; teacher sees eigen toggle
  document.getElementById('admin-vak-wrap').classList.toggle('hidden', !user.isAdmin);
  document.getElementById('btn-filter-eigen').classList.toggle('hidden', user.isAdmin);

  await initFilterBar(user, subject);
  applyRoleVisibility(user);
  Presence.start(user.id);
}

function applyRoleVisibility(user) {
  const adminOnly = ['gebruikers', 'school'];
  const teacherOnly = ['toetsen', 'observaties'];
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
  Presence.stop();
  userBadgeBtn.classList.add('hidden');
  _adminSubjectFilter = null;
  _activeUserId = null;
  _obsFilter = null;
  navigateTo('startup');
});

// ── Watermerk ─────────────────────────────────────────────────────────────────
async function applyWatermerk() {
  const dataUrl = await window.rtti.readPhotoAsDataUrl('fotos/school-watermerk.svg');
  if (dataUrl) document.documentElement.style.setProperty('--watermerk-url', `url("${dataUrl}")`);
}

// ── Save conflicts ────────────────────────────────────────────────────────────
// Store throws { code: 'conflict' } when saving something another teacher changed
// after it was opened here. The save is aborted, so the open modal stays as it is.
window.addEventListener('unhandledrejection', async (e) => {
  if (e.reason?.code !== 'conflict') return;
  e.preventDefault();
  const users = await Store.loadUsers();
  const other = users.find((u) => u.id === e.reason.updatedBy);
  const door = other ? ` door ${Store.fullName(other)}` : '';
  persistentError(
    `Niet opgeslagen: dit is intussen${door} gewijzigd. Sluit het venster en open het opnieuw.`
  );
});

// ── Background changes (other teachers) ──────────────────────────────────────
// The visible list is redrawn when data it shows changes in the background.
// Filters, the selected year and the scroll position are kept. While a modal or
// an exam menu is open the redraw waits, so nothing moves under the user's hands.
// The school screen is left alone: it is edited inline.
const SCREEN_REFRESH = {
  leerlingen: {
    types: ['students', 'group'],
    year: () => leerlingenState.year,
    render: () => renderStudentList(),
  },
  groepen: {
    types: ['group', 'students', 'exam', 'scores'],
    year: () => SEL.groupsYear.getValue(),
    render: () => renderGroepenForYear(SEL.groupsYear.getValue()),
  },
  toetsen: {
    types: ['exam', 'scores', 'group'],
    year: () => SEL.toetsenYear.getValue(),
    render: () => renderToetsenList(),
  },
  observaties: {
    types: ['observatie', 'group'],
    year: () => Store.getConfigSync().activeYear,
    render: () => renderObservaties(),
  },
  opdrachten: { types: ['opdracht', 'observatie'], render: () => renderOpdrachten() },
  gebruikers: { types: ['gebruikers'], render: () => renderGebruikers() },
};

const SCREEN_REFRESH_DELAY_MS = 750;
let _screenRefreshPending = false;
let _screenRefreshTimer = null;

function activeScreenName() {
  return document.querySelector('.screen.active')?.id.replace('screen-', '') ?? null;
}

function scheduleScreenRefresh() {
  _screenRefreshPending = true;
  clearTimeout(_screenRefreshTimer);
  _screenRefreshTimer = setTimeout(runScreenRefresh, SCREEN_REFRESH_DELAY_MS);
}

async function runScreenRefresh() {
  _screenRefreshTimer = null;
  if (!_screenRefreshPending) return;
  if (!overlay.classList.contains('hidden')) return; // closeModal() picks it up
  if (document.querySelector('.exam-menu')) {
    _screenRefreshTimer = setTimeout(runScreenRefresh, 2000);
    return;
  }
  _screenRefreshPending = false;
  const name = activeScreenName();
  const cfg = SCREEN_REFRESH[name];
  if (!cfg) return;
  const pageScroller = document.scrollingElement;
  const pageY = pageScroller.scrollTop;
  const screenY = screens[name].scrollTop;
  await cfg.render();
  pageScroller.scrollTop = pageY;
  screens[name].scrollTop = screenY;
}

Sync.on('*', (ev) => {
  const cfg = SCREEN_REFRESH[activeScreenName()];
  if (!cfg || !cfg.types.includes(ev.type)) return;
  const shownYear = cfg.year?.();
  if (ev.year && shownYear && ev.year !== shownYear) return;
  const subject = Store.getActiveSubject();
  if (ev.subject && subject && ev.subject !== subject) return;
  scheduleScreenRefresh();
});

// ── "Nieuwe toets" popover ────────────────────────────────────────────────────
// A colleague added an exam in the active subject and year: show who added
// what in a card at the top right. It stays until it is clicked.
Sync.on('exam', (ev) => {
  if (ev.kind !== 'added' || !ev.after || !ev.inScope) return;
  const me = Store.getActiveUser();
  if (!me || ev.after._meta?.createdBy === me.id) return;
  showExamAddedNotice(ev.after, ev.year);
});

async function showExamAddedNotice(exam, year) {
  const creatorId = exam._meta?.createdBy;
  const creator = creatorId ? (await Store.loadUsers()).find((u) => u.id === creatorId) : null;
  let container = document.getElementById('bg-notices');
  if (!container) {
    container = document.createElement('div');
    container.id = 'bg-notices';
    document.body.appendChild(container);
  }
  const schoolsoort = (exam.schoolsoort ?? []).join(' / ');
  const details = [
    `Klas ${exam.jaarlaag}${schoolsoort ? ` ${schoolsoort}` : ''}`,
    exam.periode ? `periode ${exam.periode}` : null,
    year,
  ]
    .filter(Boolean)
    .join(' · ');
  const initials = creator ? creator.afkorting || creator.voornaam?.[0] || '?' : '?';
  const card = document.createElement('div');
  card.className = 'bg-notice';
  card.setAttribute('role', 'status');
  card.title = 'Klik om te sluiten';
  card.innerHTML = `
    <span class="user-badge-mini ${creator?.isAdmin ? 'badge-square' : 'badge-circle'}"
      data-len="${initials.length}" style="--badge-color:${escHtml(creator?.kleur ?? '#888')}">${escHtml(initials)}</span>
    <div class="bg-notice-body">
      <div class="bg-notice-title">Nieuwe toets toegevoegd</div>
      <div class="bg-notice-exam">${escHtml(exam.title)}</div>
      <div class="bg-notice-meta">${escHtml(details)}</div>
      <div class="bg-notice-meta">door ${escHtml(creator ? Store.fullName(creator) : 'een collega')}</div>
    </div>
    <button class="bg-notice-close" aria-label="Melding sluiten">✕</button>`;
  card.addEventListener('click', () => card.remove());
  container.appendChild(card);
}

Sync.start();

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await Store.preload();
  applyWatermerk();
  initSelects();
  navigateTo('startup');
}

init();
