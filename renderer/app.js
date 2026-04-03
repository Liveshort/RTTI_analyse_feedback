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
import { renderRapport } from './screens/rapport.js';

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
  if (screens[name]) {
    renderScreen(name); // render content while still hidden
    screens[name].classList.add('active'); // then reveal — no flash/reflow
    window.scrollTo(0, 0); // reset scroll so all tabs start at top
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

export function showModal(html, onShow, wide = false) {
  modalContent.innerHTML = html;
  modalBox.classList.remove('modal-xl', 'modal-scores', 'modal-profile');
  if (wide === true) modalBox.classList.add('modal-xl');
  else if (typeof wide === 'string') modalBox.classList.add(wide);
  overlay.classList.remove('hidden');
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
  SEL.rapportExam = new CustomSelect(document.getElementById('rapport-exam-select'), {
    placeholder: '— kies toets —',
    onChange: (v) => {
      const content = document.getElementById('rapport-content');
      content.innerHTML = v
        ? `<p>Rapport genereren komt in Phase 4.</p>
           <button class="btn-primary" disabled>&#128196; Download .docx (binnenkort)</button>`
        : '<p class="hint">Selecteer een toets.</p>';
    },
  });
}

// ── Wi-filter ─────────────────────────────────────────────────────────────────
const wiFilterBar = document.getElementById('wi-filter-bar');
let _wiFilter = new Set(['OB', 'WisA', 'WisB', 'WisC', 'WisD']);

export function getWiFilter() {
  return _wiFilter;
}

wiFilterBar.querySelectorAll('.wi-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.wiFilter;
    if (_wiFilter.has(key)) {
      _wiFilter.delete(key);
      btn.classList.remove('selected');
    } else {
      _wiFilter.add(key);
      btn.classList.add('selected');
    }
    // Re-render whichever content screen is currently active
    const active = document.querySelector('.screen.active');
    if (active && active.id !== 'screen-startup') {
      renderScreen(active.id.replace('screen-', ''));
    }
  });
});

// ── Subject badge ─────────────────────────────────────────────────────────────
const subjectLabel = document.getElementById('subject-label');

export function showSubjectBadge(subject) {
  subjectLabel.textContent = Store.SUBJECT_DISPLAY[subject] ?? subject;
  subjectLabel.classList.remove('hidden');
  if (subject === 'wi') {
    wiFilterBar.classList.remove('hidden');
  } else {
    wiFilterBar.classList.add('hidden');
  }
}

subjectLabel.addEventListener('click', () => {
  subjectLabel.classList.add('hidden');
  wiFilterBar.classList.add('hidden');
  navigateTo('startup');
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await Store.preload();
  initSelects();
  navigateTo('startup');
}

init();
