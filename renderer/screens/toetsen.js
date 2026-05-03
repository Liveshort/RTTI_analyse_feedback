import { lerpColor } from '../utils/colors.js';
import {
  escHtml,
  SEL,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
  getAdminSubjectFilter,
} from '../app.js';
import { openScoreModal } from './scores.js';

// ── Modal imports (used directly in this screen file) ───────────────────────
import { openExamOverviewModal } from '../modals/toets-overzicht.js';
import { openExamModal, deleteExam } from '../modals/toets-edit.js';
import {
  openResitModal,
  openBestGradesOverviewModal,
  openSummaryEditModal,
} from '../modals/herkansing.js';

// ── Re-exports for backward compatibility ───────────────────────────────────
export { openExamOverviewModal } from '../modals/toets-overzicht.js';
export {
  openExamModal,
  showExamEditor,
  extractBoundaries,
  secIndexOf,
  cascadeStructure,
  deleteExam,
} from '../modals/toets-edit.js';
export {
  openResitModal,
  openBestGradesOverviewModal,
  openSummaryEditModal,
} from '../modals/herkansing.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Toetsen
// ═══════════════════════════════════════════════════════════════════════════════

// Helpers for cascade-based section/number system
export const SEC_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const SEC_ALPHA2 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export function renderToetsen() {
  const cfg = Store.getConfigSync();
  const years = [...Store.listYearsSync()];
  if (!years.includes(cfg.activeYear)) years.unshift(cfg.activeYear);

  const currentYear = SEL.toetsenYear.getValue() || cfg.activeYear;
  SEL.toetsenYear.setOptions(years.map((y) => ({ value: y, label: y })));
  SEL.toetsenYear.setValue(years.includes(currentYear) ? currentYear : years[0]);

  document.getElementById('btn-add-exam').onclick = () => openExamModal(null);
  renderToetsenList();
  Store.preloadScores(SEL.toetsenYear.getValue() || cfg.activeYear);
}

export async function computeExamStats(year, exam) {
  const students = Store.getStudentsSync(year);
  const normalMax = exam.questions
    .filter((q) => qKind(q) === 'normal')
    .reduce((s, q) => s + q.max_points, 0);
  const grades = [],
    points = [];
  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    const examScores = rec?.scores?.[exam.id];
    if (!examScores || Object.keys(examScores).length === 0) continue;
    const qs = {};
    exam.questions.forEach((q) => {
      const v = examScores[q.id];
      if (v !== undefined) qs[q.id] = v;
    });
    if (Object.keys(qs).length === 0) continue;
    const res = Store.calcResults(exam, qs);
    if (res.grade !== null) {
      grades.push(res.grade);
      points.push(res.scored);
    }
  }
  if (grades.length === 0) return null;
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = (arr, m) =>
    arr.length < 2 ? 0 : Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  const mg = mean(grades),
    mp = mean(points);
  return {
    n: grades.length,
    avgPts: mp.toFixed(1).replace('.', ','),
    avgG: mg.toFixed(1).replace('.', ','),
    sd: sd(grades, mg).toFixed(1).replace('.', ','),
    fails: Math.round((grades.filter((g) => g < 5.5).length / grades.length) * 100),
    normalMax,
  };
}

export async function computeExamWarnings(year, exam) {
  const students = Store.getStudentsSync(year);
  const problems = [];
  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    const examScores = rec?.scores?.[exam.id];
    if (!examScores || Object.keys(examScores).length === 0) continue;
    let filled = 0,
      invalid = false;
    for (const q of exam.questions) {
      const v = examScores[q.id];
      if (v === undefined) continue; // not entered
      filled++;
      if (v === null) continue; // 'N' — valid
      const num = Number(v);
      if (isNaN(num) || num < 0 || num > q.max_points) invalid = true;
    }
    if (invalid) problems.push({ name: Store.fullName(s), issue: 'ongeldig' });
    else if (filled > 0 && filled < exam.questions.length)
      problems.push({ name: Store.fullName(s), issue: 'onvolledig' });
  }
  return problems.length > 0 ? problems : null;
}

export async function computeBestGradeStats(parentId, year) {
  const bestMap = await Store.computeBestGradeMap(parentId, year);
  const grades = Object.values(bestMap)
    .map((e) => e.grade)
    .filter((g) => g !== null);
  if (grades.length === 0) return null;
  const mean = grades.reduce((a, b) => a + b, 0) / grades.length;
  const sd = Math.sqrt(grades.reduce((s, g) => s + (g - mean) ** 2, 0) / grades.length);
  return {
    n: grades.length,
    avgG: mean.toFixed(1).replace('.', ','),
    sd: sd.toFixed(1).replace('.', ','),
    fails: Math.round((grades.filter((g) => g < 5.5).length / grades.length) * 100),
  };
}

const SUBCATEGORY_TO_FILTER = {
  onderbouw: 'OB',
  wisa: 'WisA',
  wisb: 'WisB',
  wisc: 'WisC',
  wisd: 'WisD',
};

export async function renderToetsenList() {
  const year = SEL.toetsenYear.getValue();
  let exams = Store.getExamsSync(year);
  const container = document.getElementById('exam-list');

  const activeSubject = Store.isAdminActive() ? getAdminSubjectFilter() : Store.getActiveSubject();
  const schoolsoortFilter = getSchoolsoortFilter();
  const jaarlagFilter = getJaarlagFilter();
  const jaarlagKlasFilter = getJaarlagKlasFilter();
  const eigenOnly = getEigenOnly();
  const activeUser = Store.getActiveUser();

  // Schoolsoort filter — always applied; exams without schoolsoort always pass
  exams = exams.filter(
    (e) =>
      !(e.schoolsoort ?? []).length || (e.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss))
  );

  // Jaarlaag filter
  if (activeSubject === 'wi') {
    // Klas 1-6 filter (by numeric jaarlaag)
    exams = exams.filter((e) => jaarlagKlasFilter.has(String(e.jaarlaag ?? '')));
    // Subcategory filter (OB / WisA / WisB / WisC / WisD)
    exams = exams.filter((e) => {
      const filterKey = SUBCATEGORY_TO_FILTER[e.subcategory ?? ''];
      return filterKey ? jaarlagFilter.has(filterKey) : true;
    });
  } else {
    exams = exams.filter((e) => jaarlagFilter.has(String(e.jaarlaag ?? '')));
  }

  // Eigen filter: exam overlaps with at least one of teacher's groups
  if (eigenOnly && activeUser && !Store.isAdminActive()) {
    const myGroups = Store.getGroupsSync(year).filter((g) =>
      (g.docenten ?? []).includes(activeUser.id)
    );
    exams = exams.filter((e) =>
      myGroups.some(
        (g) =>
          String(g.jaarlaag) === String(e.jaarlaag) &&
          (g.schoolsoort ?? []).some((ss) => (e.schoolsoort ?? []).includes(ss))
      )
    );
  }

  exams.sort(
    (a, b) =>
      String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
      (a.volgnummer ?? 0) - (b.volgnummer ?? 0) ||
      (a.attempt ?? 1) - (b.attempt ?? 1)
  );

  if (exams.length === 0) {
    container.innerHTML = `<p class="hint">Geen toetsen voor ${escHtml(year)}.</p>`;
    return;
  }

  // Partition into originals (no parent_id) and resits (has parent_id)
  const originals = exams.filter((e) => !e.parent_id);
  const resitsByParent = {};
  exams
    .filter((e) => e.parent_id)
    .forEach((e) => {
      (resitsByParent[e.parent_id] ??= []).push(e);
    });

  function rttiLine(e) {
    const cats = ['R', 'T1', 'T2', 'I']
      .map((c) => {
        const pts = e.questions
          .filter((q) => qKind(q) === 'normal' && q.rtti === c)
          .reduce((s, q) => s + q.max_points, 0);
        return pts > 0 ? `${c}: ${pts}p` : null;
      })
      .filter(Boolean)
      .join(' · ');
    return cats;
  }

  function ptsTotalDisplay(e) {
    const normalTotal = e.questions
      .filter((q) => qKind(q) === 'normal')
      .reduce((s, q) => s + q.max_points, 0);
    const bonusTotal = e.questions
      .filter((q) => qKind(q) === 'bonus')
      .reduce((s, q) => s + q.max_points, 0);
    return bonusTotal > 0 ? `${normalTotal}p (+${bonusTotal}p bonus)` : `${normalTotal}p`;
  }

  function examSummaryLine(e) {
    const t = ptsTotalDisplay(e);
    const r = rttiLine(e);
    return r ? `${t} · ${r}` : t;
  }

  function statsSpanHtml(examId, isBest = false) {
    return `<span class="exam-stats muted" data-examid="${escHtml(examId)}"${isBest ? ' data-best-stats="1"' : ''} style="display:none"></span>`;
  }

  function warningSpanHtml(examId) {
    return `<span class="exam-warning" data-examid="${escHtml(examId)}" style="display:none" aria-label="Waarschuwing">⚠</span>`;
  }

  function metaLine(e) {
    const ss = (e.schoolsoort ?? []).join(' / ');
    const ssPrefix = ss ? escHtml(ss) + ' · ' : '';
    return `${ssPrefix}${e.periode ? 'Periode ' + escHtml(String(e.periode)) + ' · ' : ''}N-term: ${String(e.n_term).replace('.', ',')} · Weging: ${String(e.weging ?? 1).replace('.', ',')}${e.type === 'pta' ? ` · Weging SE: ${String(e.weging_se ?? e.weging ?? 1).replace('.', ',')}` : ''}`;
  }

  function typeColor(e) {
    return e?.type === 'pta' ? '#d9534f' : e?.type === 'po' ? '#f0ad4e' : '#4A90D9';
  }

  const SUBCATEGORY_LETTER = { wisa: 'A', wisb: 'B', wisc: 'C', wisd: 'D' };
  function wiSubBadge(e) {
    if (e.subject !== 'wi') return '';
    const letter = SUBCATEGORY_LETTER[e.subcategory];
    if (!letter) return '';
    const jl = parseInt(e.jaarlaag, 10);
    if (jl < 4) return '';
    return `<span class="volgnummer" style="background:#111;margin-right:0">${letter}</span> `;
  }

  function attemptBadge(e) {
    if (!e.parent_id) {
      // Original exam: show just the volgnummer
      return String(e.volgnummer ?? '');
    }
    // Resit: volgnummer + dash + first letter of description
    const letter = (e.description ?? '').trim().charAt(0).toUpperCase() || '?';
    return `${e.volgnummer ?? ''}-${letter}`;
  }

  function attemptCardHtml(e) {
    return `
      <div class="card exam-attempt-card">
        <div class="card-main">
          <strong>${wiSubBadge(e)}<span class="volgnummer" style="background:${typeColor(e)}">${escHtml(attemptBadge(e))}</span> <button class="student-name-btn exam-title-link" style="vertical-align:middle" data-action="exam-overview" data-examid="${escHtml(e.id)}">${escHtml(e.title)}</button>${warningSpanHtml(e.id)}</strong>
          <span class="rtti-summary">${examSummaryLine(e)}</span>
          ${statsSpanHtml(e.id)}
        </div>
        <div class="card-actions">
          <button class="btn-sm exam-card-btn" data-action="goto-scores" data-examid="${escHtml(e.id)}">Scores invoeren</button>
          <button class="btn-sm exam-card-btn" data-action="exam-overview" data-examid="${escHtml(e.id)}">Overzicht openen</button>
          <div class="card-vsep"></div>
          <button class="btn-sm btn-sm-icon" data-action="edit-exam" data-id="${escHtml(e.id)}" title="Toets bewerken">✎</button>
          <button class="btn-sm btn-danger btn-sm-icon" data-action="del-exam" data-id="${escHtml(e.id)}" title="Toets verwijderen">🗑</button>
        </div>
      </div>`;
  }

  let html = '';
  let lastJl = null;
  for (const e of originals) {
    const jl = String(e.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    const resits = resitsByParent[e.id] ?? [];
    const hasResits = resits.length > 0;

    if (!hasResits) {
      // ── Solo exam card (original behaviour + Inhaal button) ────────────────
      html += `
        <div class="card">
          <div class="card-main">
            <strong>${wiSubBadge(e)}${e.volgnummer ? `<span class="volgnummer" style="background:${typeColor(e)}">${e.volgnummer}</span> ` : ''}<button class="student-name-btn exam-title-link" style="vertical-align:middle" data-action="exam-overview" data-examid="${escHtml(e.id)}">${escHtml(e.title)}</button>${warningSpanHtml(e.id)}</strong>
            <span class="muted">${metaLine(e)}</span>
            <span class="rtti-summary">${examSummaryLine(e)}</span>
            ${statsSpanHtml(e.id)}
          </div>
          <div class="card-actions">
            <button class="btn-sm btn-sm-icon" data-action="add-resit" data-id="${escHtml(e.id)}" title="+ Inhaal / herkansing">+</button>
            <div class="card-vsep"></div>
            <button class="btn-sm exam-card-btn" data-action="goto-scores" data-examid="${escHtml(e.id)}">Scores invoeren</button>
            <button class="btn-sm exam-card-btn" data-action="exam-overview" data-examid="${escHtml(e.id)}">Overzicht openen</button>
            <div class="card-vsep"></div>
            <button class="btn-sm btn-sm-icon" data-action="edit-exam" data-id="${escHtml(e.id)}" title="Toets bewerken">✎</button>
            <button class="btn-sm btn-danger btn-sm-icon" data-action="del-exam" data-id="${escHtml(e.id)}" title="Toets verwijderen">🗑</button>
          </div>
        </div>`;
    } else {
      // ── Summary card + attempt cards ────────────────────────────────────────
      html += `
        <div class="card exam-summary-card">
          <div class="card-main">
            <strong>${wiSubBadge(e)}${e.volgnummer ? `<span class="volgnummer" style="background:${typeColor(e)}">${e.volgnummer}</span> ` : ''}<button class="student-name-btn exam-title-link" style="vertical-align:middle" data-action="exam-overview-best" data-parentid="${escHtml(e.id)}">${escHtml(e.title)}</button>${warningSpanHtml(e.id)}</strong>
            <span class="muted">${metaLine(e)}</span>
            ${statsSpanHtml(e.id, true)}
          </div>
          <div class="card-actions">
            <button class="btn-sm btn-sm-icon" data-action="add-resit" data-id="${escHtml(e.id)}" title="+ Inhaal / herkansing">+</button>
            <div class="card-vsep"></div>
            <button class="btn-sm exam-card-btn" data-action="exam-overview-best" data-parentid="${escHtml(e.id)}">Overzicht openen</button>
            <div class="card-vsep"></div>
            <button class="btn-sm btn-sm-icon" data-action="edit-summary" data-id="${escHtml(e.id)}" title="Verzamelkaart bewerken">✎</button>
            <span style="cursor:not-allowed;display:inline-flex" title="Deze toets bestaat uit meerdere pogingen. De individuele pogingen moeten eerst worden verwijderd."><button class="btn-sm btn-danger btn-sm-icon" disabled style="pointer-events:none">🗑</button></span>
          </div>
        </div>
        <div class="attempt-cards-wrapper">
          ${attemptCardHtml(e)}
          ${resits.map((r) => attemptCardHtml(r)).join('')}
        </div>`;
    }
  }
  container.innerHTML = html;

  // ── Event listeners ────────────────────────────────────────────────────────
  container
    .querySelectorAll('[data-action="edit-exam"]')
    .forEach((b) => b.addEventListener('click', () => openExamModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="del-exam"]')
    .forEach((b) => b.addEventListener('click', () => deleteExam(b.dataset.id)));
  container.querySelectorAll('[data-action="goto-scores"]').forEach((b) =>
    b.addEventListener('click', () => {
      const yr = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
      openScoreModal(b.dataset.examid, yr, { openExamModal, renderToetsenList });
    })
  );
  container.querySelectorAll('[data-action="exam-overview"]').forEach((b) =>
    b.addEventListener('click', () => {
      const yr = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
      openExamOverviewModal(b.dataset.examid, yr);
    })
  );
  container.querySelectorAll('[data-action="exam-overview-best"]').forEach((b) =>
    b.addEventListener('click', () => {
      const yr = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
      openBestGradesOverviewModal(b.dataset.parentid, yr);
    })
  );
  container.querySelectorAll('[data-action="add-resit"]').forEach((b) =>
    b.addEventListener('click', () => {
      const yr = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
      openResitModal(b.dataset.id, yr);
    })
  );
  container.querySelectorAll('[data-action="edit-summary"]').forEach((b) =>
    b.addEventListener('click', () => {
      const yr = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
      openSummaryEditModal(b.dataset.id, yr);
    })
  );

  // ── Fill stats asynchronously ──────────────────────────────────────────────
  function applyStats(el, st) {
    if (!st) {
      el.remove();
      return;
    }
    const gv = parseFloat(st.avgG.replace(',', '.'));
    const circleColor = gv < 5.5 ? '#e57373' : lerpColor('#ffd54f', '#66bb6a', (gv - 5.5) / 4.5);
    el.innerHTML =
      `<svg width="10" height="10" viewBox="0 0 10 10" style="vertical-align:middle;margin-right:5px;flex-shrink:0"><circle cx="5" cy="5" r="5" fill="${circleColor}"/></svg>` +
      `${st.avgG} ± ${st.sd} · ${st.fails}% onvoldoende`;
    el.style.display = 'flex';
    el.style.alignItems = 'center';
  }

  // Per-attempt stats and summary (best-grade) stats
  for (const e of originals) {
    const resits = resitsByParent[e.id] ?? [];
    const hasResits = resits.length > 0;

    if (!hasResits) {
      const statsEl = container.querySelector(`.exam-stats[data-examid="${CSS.escape(e.id)}"]`);
      if (statsEl) computeExamStats(year, e).then((st) => applyStats(statsEl, st));
    } else {
      // Summary card stats (best grades)
      const summaryStatsEl = container.querySelector(
        `.exam-stats[data-examid="${CSS.escape(e.id)}"][data-best-stats]`
      );
      if (summaryStatsEl)
        computeBestGradeStats(e.id, year).then((st) => applyStats(summaryStatsEl, st));
      // Attempt 1 (original) stats
      const allAttempts = [e, ...resits];
      for (const attempt of allAttempts) {
        const statsEl = container.querySelector(
          `.exam-attempt-card .exam-stats[data-examid="${CSS.escape(attempt.id)}"]`
        );
        if (statsEl) computeExamStats(year, attempt).then((st) => applyStats(statsEl, st));
      }
    }
  }

  // ── Fill warning icons asynchronously ─────────────────────────────────────
  function applyWarning(el, problems) {
    if (!problems || problems.length === 0) {
      el.remove();
      return;
    }
    el.title = problems
      .map(
        (p) =>
          `${p.name} \u2014 ${p.issue === 'ongeldig' ? 'ongeldige score' : 'onvolledige scores'}`
      )
      .join('\n');
    el.style.display = 'inline';
  }

  for (const e of originals) {
    const resits = resitsByParent[e.id] ?? [];
    if (resits.length === 0) {
      const warnEl = container.querySelector(`.exam-warning[data-examid="${CSS.escape(e.id)}"]`);
      if (warnEl) computeExamWarnings(year, e).then((p) => applyWarning(warnEl, p));
    } else {
      for (const attempt of [e, ...resits]) {
        const warnEl = container.querySelector(
          `.exam-attempt-card .exam-warning[data-examid="${CSS.escape(attempt.id)}"]`
        );
        if (warnEl) computeExamWarnings(year, attempt).then((p) => applyWarning(warnEl, p));
      }
    }
  }

  // ── Disable Verwijderen for exams with scores or resits ────────────────────
  for (const e of originals) {
    // Sync resit check: disable original's delete button if it has resits
    if (Store.examHasResits(e.id, year)) {
      const btn = container.querySelector(
        `[data-action="del-exam"][data-id="${CSS.escape(e.id)}"]`
      );
      if (btn) {
        btn.disabled = true;
        btn.title = 'Er zijn herkansingen gekoppeld aan deze toets, verwijder die eerst.';
      }
    }
    const allAttempts = [e, ...(resitsByParent[e.id] ?? [])];
    for (const attempt of allAttempts) {
      Store.examHasScores(attempt.id, year).then((has) => {
        if (!has) return;
        const btn = container.querySelector(
          `[data-action="del-exam"][data-id="${CSS.escape(attempt.id)}"]`
        );
        if (btn) {
          btn.disabled = true;
          btn.title =
            'Er zijn scores ingevoerd voor deze toets, de toets kan dus niet worden verwijderd.';
        }
      });
    }
  }
}
