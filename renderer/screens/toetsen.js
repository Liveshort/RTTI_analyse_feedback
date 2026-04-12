import { lerpColor } from '../utils/colors.js';
import { wireSpinners, spinnerValue } from '../utils/spinners.js';
import {
  showModal,
  closeModal,
  toast,
  escHtml,
  formatGrade,
  SEL,
  getWiFilter,
  pushModalChart,
} from '../app.js';
import { openScoreModal } from './scores.js';

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

  if (Store.getActiveSubject() === 'wi') {
    const wiFilter = getWiFilter();
    exams = exams.filter((e) => {
      const filterKey = SUBCATEGORY_TO_FILTER[e.subcategory ?? ''];
      return filterKey ? wiFilter.has(filterKey) : true;
    });
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

  function metaLine(e) {
    return `${e.periode ? 'Periode ' + escHtml(String(e.periode)) + ' · ' : ''}N-term: ${String(e.n_term).replace('.', ',')} · Weging: ${String(e.weging ?? 1).replace('.', ',')}${e.type === 'pta' ? ` · Weging SE: ${String(e.weging_se ?? e.weging ?? 1).replace('.', ',')}` : ''}`;
  }

  function typeColor(e) {
    return e?.type === 'pta' ? '#d9534f' : e?.type === 'po' ? '#f0ad4e' : '#4A90D9';
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
          <strong><span class="volgnummer" style="background:${typeColor(e)}">${escHtml(attemptBadge(e))}</span> <button class="student-name-btn exam-title-link" data-action="exam-overview" data-examid="${escHtml(e.id)}">${escHtml(e.title)}</button></strong>
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
            <strong>${e.volgnummer ? `<span class="volgnummer" style="background:${typeColor(e)}">${e.volgnummer}</span> ` : ''}<button class="student-name-btn exam-title-link" data-action="exam-overview" data-examid="${escHtml(e.id)}">${escHtml(e.title)}</button></strong>
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
            <strong>${e.volgnummer ? `<span class="volgnummer" style="background:${typeColor(e)}">${e.volgnummer}</span> ` : ''}<button class="student-name-btn exam-title-link" data-action="exam-overview-best" data-parentid="${escHtml(e.id)}">${escHtml(e.title)}</button></strong>
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

const GROUP_PALETTE = [
  '#4A90D9',
  '#E8823A',
  '#2ECC71',
  '#9B59B6',
  '#E67E22',
  '#1ABC9C',
  '#E74C3C',
  '#F39C12',
];

const GRADE_GROUP_LABELS = ['<4', '4–5', '5–6', '6–7', '7–8', '>8'];
// Midpoint grade for each group — used to derive gradient colors
const GRADE_GROUP_MIDPOINTS = [2.5, 4.5, 5.5, 6.5, 7.5, 9.0];

function _gradeGroupIdx(g) {
  if (g < 4) return 0;
  if (g < 5) return 1;
  if (g < 6) return 2;
  if (g < 7) return 3;
  if (g < 8) return 4;
  return 5;
}

// Same gradient used across the app: flat red below 5.5, yellow→green above.
function gradeColor(g) {
  return g < 5.5 ? '#e57373' : lerpColor('#ffd54f', '#66bb6a', Math.min((g - 5.5) / 4.5, 1));
}

export async function openExamOverviewModal(examId, year, scoreOverride = null, isSummary = false) {
  const all = await Store.getExams(year);
  const exam = all.find((e) => e.id === examId);
  if (!exam) return;

  const RTTI_CATS = ['R', 'T1', 'T2', 'I'];
  const students = Store.getStudentsSync(year);
  const grades = [];
  const qStats = exam.questions.map((q) => ({ q, totalScored: 0, totalMax: 0 }));

  const groups = Store.getGroupsSync(year);
  const studentGroupMap = new Map();
  for (const g of groups) {
    for (const sid of g.student_ids) {
      if (!studentGroupMap.has(String(sid))) studentGroupMap.set(String(sid), g);
    }
  }
  const groupStatsMap = new Map();
  const rttiAccum = Array.from({ length: 6 }, () => RTTI_CATS.map(() => ({ scored: 0, max: 0 })));

  const allObs = Store.getObservatiesSync();
  const examObsIds = exam.obs_ids ?? [];
  const examObsObjects = examObsIds.map((id) => allObs.find((o) => o.id === id)).filter(Boolean);
  // obsAccum[obsId] = { count, byGroup: {groupId: n}, byGradeGroup: [6] }
  const obsAccum = {};
  for (const o of examObsObjects) {
    obsAccum[o.id] = { count: 0, byGroup: {}, byGradeGroup: Array(6).fill(0) };
  }

  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    const overrideEntry = scoreOverride ? (scoreOverride[s.id] ?? null) : null;
    // overrideEntry may be { questionScores, exam, grade } (from computeBestGradeMap)
    const examScores = overrideEntry
      ? (overrideEntry.questionScores ?? overrideEntry)
      : rec?.scores?.[exam.id];
    // Track observations even if no scores
    const studentObs = rec?.observations?.[exam.id] ?? [];
    const grpForObs = studentGroupMap.get(String(s.id));
    if (!examScores || Object.keys(examScores).length === 0) {
      for (const obsId of studentObs) {
        if (!obsAccum[obsId]) continue;
        obsAccum[obsId].count++;
        if (grpForObs)
          obsAccum[obsId].byGroup[grpForObs.id] = (obsAccum[obsId].byGroup[grpForObs.id] ?? 0) + 1;
      }
      continue;
    }

    const qs = {};
    exam.questions.forEach((q) => {
      const v = examScores[q.id];
      if (v !== undefined) qs[q.id] = v;
    });
    // Use pre-computed grade from bestMap if available (correct attempt structure),
    // otherwise compute against this exam's structure.
    let grade = overrideEntry?.grade ?? null;
    if (grade === null && Object.keys(qs).length > 0) {
      const evalExam = overrideEntry?.exam ?? exam;
      const res = Store.calcResults(evalExam, qs);
      if (res.grade !== null) grade = res.grade;
    }
    if (grade !== null) {
      grades.push(grade);
      const ggi = _gradeGroupIdx(grade);
      for (const [ci, cat] of RTTI_CATS.entries()) {
        for (const q of exam.questions.filter((q) => q.rtti === cat)) {
          const val = examScores[q.id];
          if (val == null || String(val).toUpperCase() === 'N') continue;
          const num = Number(val);
          if (isNaN(num) || num < 0) continue;
          rttiAccum[ggi][ci].scored += num;
          rttiAccum[ggi][ci].max += q.max_points;
        }
      }
    }

    for (const stat of qStats) {
      const val = examScores[stat.q.id];
      if (val == null || String(val).toUpperCase() === 'N') continue;
      const num = Number(val);
      if (isNaN(num) || num < 0) continue;
      stat.totalScored += num;
      stat.totalMax += stat.q.max_points;
    }

    const grp = studentGroupMap.get(String(s.id));
    if (grp) {
      if (!groupStatsMap.has(grp.id)) {
        groupStatsMap.set(grp.id, {
          group: grp,
          grades: [],
          qStats: exam.questions.map((q) => ({ q, totalScored: 0, totalMax: 0 })),
        });
      }
      const entry = groupStatsMap.get(grp.id);
      if (grade !== null) entry.grades.push(grade);
      for (const stat of entry.qStats) {
        const val = examScores[stat.q.id];
        if (val == null || String(val).toUpperCase() === 'N') continue;
        const num = Number(val);
        if (isNaN(num) || num < 0) continue;
        stat.totalScored += num;
        stat.totalMax += stat.q.max_points;
      }
    }

    for (const obsId of studentObs) {
      if (!obsAccum[obsId]) continue;
      obsAccum[obsId].count++;
      if (grpForObs)
        obsAccum[obsId].byGroup[grpForObs.id] = (obsAccum[obsId].byGroup[grpForObs.id] ?? 0) + 1;
      if (grade !== null) obsAccum[obsId].byGradeGroup[_gradeGroupIdx(grade)]++;
    }
  }

  const hasGrades = grades.length > 0;
  const hasQStats = qStats.some((s) => s.totalMax > 0);
  const groupEntries = [...groupStatsMap.values()]
    .filter((e) => e.qStats.some((s) => s.totalMax > 0))
    .sort((a, b) => a.group.name.localeCompare(b.group.name));
  const hasGroupData = groupEntries.length > 0;
  const hasRttiData = rttiAccum.some((grp) => grp.some((cat) => cat.max > 0));
  const hasObsData = examObsObjects.length > 0 && Object.values(obsAccum).some((a) => a.count > 0);

  let summaryHtml = '<p class="hint" style="margin:0">Nog geen scores ingevoerd.</p>';
  if (hasGrades) {
    const mean = grades.reduce((a, b) => a + b, 0) / grades.length;
    const sd =
      grades.length < 2
        ? 0
        : Math.sqrt(grades.reduce((s, v) => s + (v - mean) ** 2, 0) / grades.length);
    const fails = Math.round((grades.filter((g) => g < 5.5).length / grades.length) * 100);
    const dotColor = mean < 5.5 ? '#e57373' : lerpColor('#ffd54f', '#66bb6a', (mean - 5.5) / 4.5);
    const dot = `<svg width="10" height="10" viewBox="0 0 10 10" style="vertical-align:middle;margin:0 3px;flex-shrink:0"><circle cx="5" cy="5" r="5" fill="${dotColor}"/></svg>`;
    summaryHtml = `<span class="muted" style="display:flex;align-items:center;flex-wrap:wrap;gap:0">${grades.length} leerlingen &nbsp;·&nbsp; ${dot} ${mean.toFixed(1).replace('.', ',')} ± ${sd.toFixed(1).replace('.', ',')} &nbsp;·&nbsp; ${fails}% onvoldoende</span>`;
  }

  const qChartHeight = Math.max(180, exam.questions.length * 22 + 60);
  const groupQHeight = hasGroupData ? Math.round(qChartHeight * groupEntries.length * 0.8) : 0;

  // Build a 2-column grid of group chart containers with card styling
  function groupGrid(idFn, heightPx) {
    if (!hasGroupData) return '';
    let html = '';
    const card = (j) =>
      `<div style="flex:1;min-width:0;border:1px solid var(--border);border-radius:var(--radius);padding:8px;background:var(--surface)">` +
      `<div style="position:relative;height:${heightPx}px"><canvas id="${idFn(j)}"></canvas></div></div>`;
    for (let i = 0; i < groupEntries.length; i += 2) {
      html += `<div style="display:flex;gap:14px;margin-bottom:14px">${card(i)}${
        i + 1 < groupEntries.length ? card(i + 1) : '<div style="flex:1;min-width:0"></div>'
      }</div>`;
    }
    return html;
  }

  showModal(
    `<h3>Overzicht: <em>${escHtml(exam.title)}</em>
      <span style="font-weight:normal;font-size:13px;font-style:normal"> — Jaarlaag ${escHtml(String(exam.jaarlaag))}, ${escHtml(year)}</span>
    </h3>
    <div style="margin-bottom:10px">${summaryHtml}</div>
    <div class="overview-tab-bar">
      <button class="overview-tab selected" data-tab="cijferverdeling">Cijferverdeling</button>
      <button class="overview-tab" data-tab="boxplots">Boxplot cijfers</button>
      <button class="overview-tab" data-tab="vraaganalyse"${isSummary ? ' disabled title="Dit tabblad is alleen beschikbaar voor individuele toetsen, niet voor het verzameloverzicht."' : ''}>Vraaganalyse</button>
      <button class="overview-tab" data-tab="rtti-analyse"${isSummary ? ' disabled title="Dit tabblad is alleen beschikbaar voor individuele toetsen, niet voor het verzameloverzicht."' : ''}>RTTI-analyse</button>
      <button class="overview-tab" data-tab="observaties"${isSummary ? ' disabled title="Dit tabblad is alleen beschikbaar voor individuele toetsen, niet voor het verzameloverzicht."' : ''}>Observaties</button>
    </div>
    <div style="margin:0 -28px -28px;padding:16px 28px 28px;background:var(--bg)">

    <div class="tab-pane" id="tab-cijferverdeling">
      ${
        hasGrades
          ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px 14px;margin-bottom:20px;background:var(--surface)">
          <div style="height:200px;position:relative;margin-bottom:12px"><canvas id="chart-hist"></canvas></div>
          <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px">
            <span style="font-size:13px;color:var(--muted)">Stapgrootte:</span>
            <div class="btn-toggle-group">
              <button class="tog-btn hist-bin-btn selected" data-bin="0.5" style="min-width:90px">0,5 punten</button>
              <button class="tog-btn hist-bin-btn" data-bin="1" style="min-width:90px">1 punt</button>
            </div>
          </div>
        </div>
        ${groupGrid((i) => `chart-hist-grp-${i}`, 150)}
      `
          : '<p class="hint">Nog geen scores ingevoerd.</p>'
      }
    </div>

    <div class="tab-pane hidden" id="tab-boxplots">
      ${
        hasGrades
          ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--surface)">
          <div style="height:${Math.max(200, (groupEntries.length + 1) * 55 + 60)}px;position:relative">
            <canvas id="chart-box-combined"></canvas>
          </div>
        </div>
      `
          : '<p class="hint">Nog geen scores ingevoerd.</p>'
      }
    </div>

    <div class="tab-pane hidden" id="tab-vraaganalyse">
      ${
        hasQStats
          ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:8px;margin-bottom:16px;background:var(--surface)">
          <div style="height:${qChartHeight}px;position:relative"><canvas id="chart-q-all"></canvas></div>
        </div>
        ${
          hasGroupData
            ? `
          <div style="border:1px solid var(--border);border-radius:var(--radius);padding:8px;background:var(--surface)">
            <div style="height:${groupQHeight}px;position:relative"><canvas id="chart-q-groups"></canvas></div>
          </div>
        `
            : ''
        }
      `
          : '<p class="hint">Geen vraagdata beschikbaar.</p>'
      }
    </div>

    <div class="tab-pane hidden" id="tab-rtti-analyse">
      ${
        hasRttiData
          ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:16px;background:var(--surface)">
          <div style="height:240px;position:relative"><canvas id="chart-rtti"></canvas></div>
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:16px;background:var(--surface)">
          <div style="height:240px;position:relative"><canvas id="chart-rtti-groups"></canvas></div>
        </div>
        <div id="rtti-history-container"><p class="hint" style="margin:0">Laden\u2026</p></div>
      `
          : '<p class="hint">Geen RTTI data beschikbaar.</p>'
      }
    </div>

    <div class="tab-pane hidden" id="tab-observaties">
      ${
        examObsObjects.length === 0
          ? '<p class="hint">Geen observaties gekoppeld aan deze toets.</p>'
          : !hasObsData
            ? '<p class="hint">Nog geen observaties ingevoerd voor deze toets.</p>'
            : `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:16px;background:var(--surface)">
          <div style="height:220px;position:relative"><canvas id="chart-obs-hist"></canvas></div>
        </div>
        ${
          hasGroupData
            ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:16px;background:var(--surface)">
          <div style="height:220px;position:relative"><canvas id="chart-obs-groups"></canvas></div>
        </div>
        `
            : ''
        }
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:16px;background:var(--surface)">
          <div style="height:220px;position:relative"><canvas id="chart-obs-grades"></canvas></div>
        </div>
      `
      }
    </div>
    </div>

    `,

    (el) => {
      const qLabels = exam.questions.map((q) =>
        q.section ? `${q.section}${q.number}` : String(q.number)
      );

      // ── Inline data-label plugins ─────────────────────────────────────────
      // Shows count/value above vertical bars (skips zero or very short bars)
      const dlAbove = {
        id: '_dlAbove',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.data.datasets.forEach((ds, i) => {
            chart.getDatasetMeta(i).data.forEach((bar, j) => {
              const v = ds.data[j];
              if (v == null || v === 0) return;
              if (bar.y >= bar.base - 12) return;
              ctx.save();
              ctx.fillStyle = '#444';
              ctx.font = 'bold 10px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              ctx.fillText(String(v), bar.x, bar.y - 1);
              ctx.restore();
            });
          });
        },
      };

      // Same as dlAbove but appends '%'
      const dlAbovePct = {
        id: '_dlAbovePct',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.data.datasets.forEach((ds, i) => {
            chart.getDatasetMeta(i).data.forEach((bar, j) => {
              const v = ds.data[j];
              if (v == null) return;
              const isZero = v === 0;
              if (!isZero && bar.y >= bar.base - 12) return;
              ctx.save();
              ctx.fillStyle = '#444';
              ctx.font = 'bold 10px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              ctx.fillText(v + '%', bar.x, isZero ? bar.base - 4 : bar.y - 1);
              ctx.restore();
            });
          });
        },
      };

      // NVT support: grey half-height bar + 'NVT' label; otherwise shows 'X%'
      const NVT_CLR = '#c0c8d4';
      const dlAbovePctNvt = {
        id: '_dlAbovePctNvt',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.data.datasets.forEach((ds, i) => {
            chart.getDatasetMeta(i).data.forEach((bar, j) => {
              const v = ds.data[j];
              if (v == null) return;
              const isNvt = ds.nvtArr?.[j] === true;
              if (!isNvt && (v === 0 || bar.y >= bar.base - 12)) return;
              ctx.save();
              ctx.fillStyle = isNvt ? '#8895a4' : '#444';
              ctx.font = 'bold 10px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              ctx.fillText(isNvt ? 'NVT' : v + '%', bar.x, bar.y - 1);
              ctx.restore();
            });
          });
        },
      };

      // Shows 'X%' to the right of horizontal bars (skips very short bars)
      const dlRight = {
        id: '_dlRight',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.data.datasets.forEach((ds, i) => {
            chart.getDatasetMeta(i).data.forEach((bar, j) => {
              const v = ds.data[j];
              if (v == null) return;
              if (bar.x <= bar.base + 8) return;
              ctx.save();
              ctx.fillStyle = '#444';
              ctx.font = '10px sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(v + '%', bar.x + 3, bar.y);
              ctx.restore();
            });
          });
        },
      };

      // Shared: nudges legend up so it doesn't overlap chart area
      const lgUp = {
        id: '_lgUp',
        afterLayout(chart) {
          const lg = chart.legend;
          if (!lg) return;
          lg.top -= 10;
          lg.bottom -= 10;
        },
      };

      // ── Histogram helpers ─────────────────────────────────────────────────
      function makeHistBins(step, gradeArr) {
        const start = step === 0.5 ? 1.0 : 0.5;
        const count = step === 0.5 ? 18 : 10;
        const bins = Array(count).fill(0);
        for (const g of gradeArr) {
          let i = Math.floor((g - start) / step);
          if (g >= 10.0) i = count - 1;
          bins[Math.max(0, Math.min(count - 1, i))]++;
        }
        const binLabels = bins.map((_, i) => {
          const upper = Math.min(start + (i + 1) * step, 10.0);
          return '<' + upper.toFixed(1).replace('.', ',');
        });
        const passBinIndex = Math.round((5.5 - start) / step);
        const barColors = bins.map((_, i) => gradeColor(start + (i + 0.5) * step));
        return { data: bins, binLabels, barColors, passBinIndex };
      }

      function buildHistChart(canvas, bins, title) {
        return new Chart(canvas, {
          type: 'bar',
          plugins: [dlAbove],
          data: {
            labels: bins.binLabels,
            datasets: [
              {
                data: bins.data,
                backgroundColor: bins.barColors,
                borderRadius: 3,
                borderSkipped: false,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              title: { display: true, text: title, font: { size: 13 }, padding: { bottom: 14 } },
              annotation: {
                annotations: {
                  passLine: {
                    type: 'line',
                    xMin: bins.passBinIndex - 0.5,
                    xMax: bins.passBinIndex - 0.5,
                    borderColor: '#555',
                    borderWidth: 2,
                    borderDash: [4, 4],
                  },
                },
              },
            },
            scales: {
              x: { ticks: { font: { size: 10 }, maxRotation: 0, minRotation: 0 } },
              y: {
                beginAtZero: true,
                ticks: { stepSize: 1, precision: 0 },
                afterFit(s) {
                  s.paddingTop = 35;
                },
              },
            },
          },
        });
      }

      // ── Boxplot helpers ───────────────────────────────────────────────────
      function boxStats(vals) {
        if (!vals || !vals.length) return null;
        const s = [...vals].sort((a, b) => a - b);
        const n = s.length;
        return {
          min: s[0],
          max: s[n - 1],
          q1: s[Math.floor(n * 0.25)],
          median: s[Math.floor(n * 0.5)],
          q3: s[Math.floor(n * 0.75)],
        };
      }

      function makeBoxPlugin(statsArr, colors) {
        return {
          id: '_box',
          afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            statsArr.forEach((stats, i) => {
              if (!stats) return;
              const bar = meta.data[i];
              if (!bar) return;
              const rawH = bar.height > 0 ? bar.height : chart.chartArea.height / statsArr.length;
              const bh = Math.min(rawH * 0.55, 60);
              const capH = bh * 0.35;
              const xS = chart.scales.x;
              const y = bar.y;
              const xMin = xS.getPixelForValue(stats.min);
              const xMax = xS.getPixelForValue(stats.max);
              const xQ1 = xS.getPixelForValue(stats.q1);
              const xQ3 = xS.getPixelForValue(stats.q3);
              const xMed = xS.getPixelForValue(stats.median);
              const color = colors[i] || '#4A90D9';
              ctx.save();
              ctx.strokeStyle = color;
              ctx.fillStyle = color + '44';
              ctx.lineWidth = 1.5;
              // IQR box (horizontal)
              ctx.fillRect(xQ1, y - bh / 2, xQ3 - xQ1, bh);
              ctx.strokeRect(xQ1, y - bh / 2, xQ3 - xQ1, bh);
              // Median line (vertical)
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(xMed, y - bh / 2);
              ctx.lineTo(xMed, y + bh / 2);
              ctx.stroke();
              // Whiskers (horizontal) + caps (vertical)
              ctx.lineWidth = 1.5;
              [
                [xQ1, xMin],
                [xQ3, xMax],
              ].forEach(([from, to]) => {
                ctx.beginPath();
                ctx.moveTo(from, y);
                ctx.lineTo(to, y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(to, y - capH / 2);
                ctx.lineTo(to, y + capH / 2);
                ctx.stroke();
              });
              // Value labels above each key position
              ctx.font = '9px sans-serif';
              ctx.fillStyle = color;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              const yt = y - bh / 2 - 2;
              [
                [xMin, stats.min],
                [xQ1, stats.q1],
                [xMed, stats.median],
                [xQ3, stats.q3],
                [xMax, stats.max],
              ].forEach(([xPos, val]) => ctx.fillText(val.toFixed(1).replace('.', ','), xPos, yt));
              ctx.restore();
            });
          },
        };
      }

      function buildBoxChart(canvas, labels, gradeArrays, colors, title) {
        const statsArr = gradeArrays.map(boxStats);
        return new Chart(canvas, {
          type: 'bar',
          plugins: [makeBoxPlugin(statsArr, colors)],
          data: {
            labels,
            datasets: [
              {
                data: statsArr.map((s) => (s ? s.median : null)),
                backgroundColor: 'transparent',
                borderColor: 'transparent',
                borderWidth: 0,
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              title: { display: !!title, text: title ?? '', font: { size: 13 } },
              annotation: {},
            },
            scales: {
              x: { min: 0, max: 11, ticks: { stepSize: 1 } },
              y: {
                ticks: { font: { size: 11 } },
                afterFit(s) {
                  s.paddingTop = 18;
                },
              },
            },
          },
        });
      }

      // ── % correct chart helper ────────────────────────────────────────────
      function buildQChart(canvas, pcts, title) {
        const colors = pcts.map((p) => {
          if (p === null) return '#ccc';
          const t = p / 100;
          return t <= 0.5
            ? lerpColor('#e57373', '#ffd54f', t * 2)
            : lerpColor('#ffd54f', '#66bb6a', (t - 0.5) * 2);
        });
        return new Chart(canvas, {
          type: 'bar',
          plugins: [dlRight],
          data: {
            labels: qLabels,
            datasets: [{ data: pcts, backgroundColor: colors, borderRadius: 3 }],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              title: { display: true, text: title, font: { size: 13 } },
            },
            scales: {
              x: {
                beginAtZero: true,
                max: 100,
                ticks: { callback: (v) => v + '%', font: { size: 10 } },
                afterFit(s) {
                  s.paddingRight = 35;
                },
              },
              y: { ticks: { font: { size: 10 } } },
            },
          },
        });
      }

      // ── Tab: Cijferverdeling ──────────────────────────────────────────────
      function initCijferverdeling() {
        if (!hasGrades) return;
        let histChart = null;
        function renderHistogram(step) {
          if (histChart) {
            histChart.destroy();
            histChart = null;
          }
          const canvas = el.querySelector('#chart-hist');
          if (!canvas) return;
          histChart = buildHistChart(canvas, makeHistBins(step, grades), 'Cijferverdeling');
          pushModalChart(histChart);
        }
        renderHistogram(0.5);
        el.querySelectorAll('.hist-bin-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            el.querySelectorAll('.hist-bin-btn').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
            renderHistogram(parseFloat(btn.dataset.bin));
          });
        });
        groupEntries.forEach((entry, i) => {
          const canvas = el.querySelector(`#chart-hist-grp-${i}`);
          if (!canvas || !entry.grades.length) return;
          pushModalChart(buildHistChart(canvas, makeHistBins(1, entry.grades), entry.group.name));
        });
      }

      // ── Tab: Boxplots ─────────────────────────────────────────────────────
      function initBoxplots() {
        if (!hasGrades) return;
        const canvas = el.querySelector('#chart-box-combined');
        if (!canvas) return;
        const labels = ['Alle', ...groupEntries.map((e) => e.group.name)];
        const gradeArrays = [grades, ...groupEntries.map((e) => e.grades)];
        const colors = [
          '#9e9e9e',
          ...groupEntries.map((_, i) => GROUP_PALETTE[i % GROUP_PALETTE.length]),
        ];
        pushModalChart(buildBoxChart(canvas, labels, gradeArrays, colors, null));
      }

      // ── Tab: Vraaganalyse ─────────────────────────────────────────────────
      function initVraaganalyse() {
        if (!hasQStats) return;
        const qPcts = qStats.map((s) =>
          s.totalMax > 0 ? Math.round((s.totalScored / s.totalMax) * 100) : null
        );
        const allCanvas = el.querySelector('#chart-q-all');
        if (allCanvas)
          pushModalChart(buildQChart(allCanvas, qPcts, '% correct \u2014 alle leerlingen'));
        if (hasGroupData) {
          const groupsCanvas = el.querySelector('#chart-q-groups');
          if (groupsCanvas) {
            pushModalChart(
              new Chart(groupsCanvas, {
                type: 'bar',
                plugins: [dlRight],
                data: {
                  labels: qLabels,
                  datasets: groupEntries.map((entry, i) => ({
                    label: entry.group.name,
                    data: entry.qStats.map((s) =>
                      s.totalMax > 0 ? Math.round((s.totalScored / s.totalMax) * 100) : null
                    ),
                    backgroundColor: GROUP_PALETTE[i % GROUP_PALETTE.length],
                    borderRadius: 2,
                  })),
                },
                options: {
                  indexAxis: 'y',
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: true,
                      position: 'top',
                      labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                    },
                    title: { display: true, text: '% correct per groep', font: { size: 13 } },
                  },
                  scales: {
                    x: {
                      beginAtZero: true,
                      max: 100,
                      ticks: { callback: (v) => v + '%', font: { size: 10 } },
                      afterFit(s) {
                        s.paddingRight = 35;
                      },
                    },
                    y: { ticks: { font: { size: 10 } } },
                  },
                },
              })
            );
          }
        }
      }

      // ── Tab: RTTI-analyse ─────────────────────────────────────────────────
      function initRttiAnalyse() {
        // generateLabels that always uses the dataset's intended color, ignoring per-bar NVT grey
        const rttiGenLabels = (chart) =>
          chart.data.datasets.map((ds, i) => ({
            text: ds.label,
            fillStyle: ds._legendColor,
            strokeStyle: 'transparent',
            lineWidth: 0,
            borderRadius: 2,
            hidden: !chart.isDatasetVisible(i),
            datasetIndex: i,
          }));

        // Draws a thin 2 px coloured line at the baseline for bars with value === 0
        const zeroBar = {
          id: '_zeroBar',
          afterDatasetsDraw(chart) {
            const { ctx } = chart;
            chart.data.datasets.forEach((ds, i) => {
              const meta = chart.getDatasetMeta(i);
              if (meta.hidden) return;
              meta.data.forEach((bar, j) => {
                if (ds.data[j] !== 0) return;
                const color = Array.isArray(ds.backgroundColor)
                  ? ds.backgroundColor[j]
                  : ds.backgroundColor;
                ctx.save();
                ctx.fillStyle = color;
                ctx.fillRect(bar.x - bar.width / 2, bar.base - 2, bar.width, 2);
                ctx.restore();
              });
            });
          },
        };

        // Chart 1: RTTI per cijfergroep (synchronous)
        const rttiCanvas = el.querySelector('#chart-rtti');
        if (rttiCanvas && hasRttiData) {
          pushModalChart(
            new Chart(rttiCanvas, {
              type: 'bar',
              plugins: [dlAbovePct, lgUp, zeroBar],
              data: {
                labels: RTTI_CATS,
                datasets: GRADE_GROUP_LABELS.map((label, gi) => ({
                  label,
                  data: RTTI_CATS.map((_, ci) => {
                    const { scored, max } = rttiAccum[gi][ci];
                    return max > 0 ? Math.round((scored / max) * 100) : null;
                  }),
                  backgroundColor: gi === 0 ? '#c62828' : gradeColor(GRADE_GROUP_MIDPOINTS[gi]),
                  borderRadius: 2,
                })),
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: 'top',
                    labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                  },
                  title: { display: true, text: 'RTTI-scores per cijfergroep', font: { size: 13 } },
                },
                scales: {
                  x: { ticks: { font: { size: 12 } } },
                  y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: (v) => v + '%' },
                    afterFit(s) {
                      s.paddingTop = 35;
                    },
                  },
                },
              },
            })
          );
        }

        // Chart 2: RTTI per groep (synchronous)
        const rttiGroupsCanvas = el.querySelector('#chart-rtti-groups');
        if (rttiGroupsCanvas && hasQStats) {
          function rttiPctsFor(qStatsArr) {
            return RTTI_CATS.map((cat) => {
              let scored = 0,
                max = 0;
              exam.questions.forEach((q, qi) => {
                if (q.rtti !== cat) return;
                scored += qStatsArr[qi].totalScored;
                max += qStatsArr[qi].totalMax;
              });
              return max > 0 ? Math.round((scored / max) * 100) : null;
            });
          }
          const mkDs = (label, pcts, color) => ({
            label,
            data: pcts.map((v) => (v === null ? 50 : v)),
            backgroundColor: pcts.map((v) => (v === null ? NVT_CLR : color)),
            borderRadius: 2,
            nvtArr: pcts.map((v) => v === null),
            _legendColor: color,
          });
          const rttiColors = ['#5cb85c', '#5bc0de', '#f0ad4e', '#d9534f'];
          const groupSources = [
            { label: 'Alle', pcts: rttiPctsFor(qStats) },
            ...groupEntries.map((entry) => ({
              label: entry.group.name,
              pcts: rttiPctsFor(entry.qStats),
            })),
          ];
          pushModalChart(
            new Chart(rttiGroupsCanvas, {
              type: 'bar',
              plugins: [dlAbovePctNvt, lgUp],
              data: {
                labels: groupSources.map((s) => s.label),
                datasets: RTTI_CATS.map((cat, ci) =>
                  mkDs(
                    cat,
                    groupSources.map((s) => s.pcts[ci]),
                    rttiColors[ci]
                  )
                ),
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: 'top',
                    labels: {
                      font: { size: 11 },
                      boxWidth: 12,
                      padding: 10,
                      generateLabels: rttiGenLabels,
                    },
                  },
                  title: { display: true, text: 'RTTI-scores per groep', font: { size: 13 } },
                },
                scales: {
                  x: { ticks: { font: { size: 12 } } },
                  y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: (v) => v + '%' },
                    afterFit(s) {
                      s.paddingTop = 35;
                    },
                  },
                },
              },
            })
          );
        }

        // Chart 3: RTTI comparison across exams in this year (async, uses cached scores)
        (async () => {
          const container = el.querySelector('#rtti-history-container');
          if (!container) return;
          const allExams = await Store.getExams(year);
          const examRttiRows = [];
          for (const ex of allExams.filter((ex) => String(ex.jaarlaag) === String(exam.jaarlaag))) {
            const cats = RTTI_CATS.map(() => ({ scored: 0, max: 0 }));
            for (const s of students) {
              const rec = await Store.getStudentScores(s.id, year);
              const exScores = rec?.scores?.[ex.id];
              if (!exScores) continue;
              for (const [ci, cat] of RTTI_CATS.entries()) {
                for (const q of ex.questions.filter((q) => q.rtti === cat)) {
                  const val = exScores[q.id];
                  if (val == null || String(val).toUpperCase() === 'N') continue;
                  const num = Number(val);
                  if (isNaN(num) || num < 0) continue;
                  cats[ci].scored += num;
                  cats[ci].max += q.max_points;
                }
              }
            }
            const pcts = cats.map(({ scored, max }) =>
              max > 0 ? Math.round((scored / max) * 100) : null
            );
            if (pcts.some((p) => p !== null))
              examRttiRows.push({ title: ex.title, id: ex.id, pcts });
          }
          if (!el.isConnected) return;
          if (!examRttiRows.length) {
            container.innerHTML = '<p class="hint">Geen data voor vergelijking.</p>';
            return;
          }
          container.innerHTML =
            '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--surface)"><div style="height:240px;position:relative"><canvas id="chart-rtti-history"></canvas></div></div>';
          const histCanvas = el.querySelector('#chart-rtti-history');
          if (!histCanvas) return;
          const RTTI_PALETTE = ['#5cb85c', '#5bc0de', '#f0ad4e', '#d9534f'];
          pushModalChart(
            new Chart(histCanvas, {
              type: 'bar',
              plugins: [dlAbovePctNvt, lgUp],
              data: {
                labels: examRttiRows.map((ex) => ex.title),
                datasets: RTTI_CATS.map((cat, ci) => {
                  const raw = examRttiRows.map((ex) => ex.pcts[ci]);
                  return {
                    label: cat,
                    data: raw.map((v) => (v === null ? 50 : v)),
                    backgroundColor: raw.map((v) => (v === null ? NVT_CLR : RTTI_PALETTE[ci])),
                    borderRadius: 2,
                    nvtArr: raw.map((v) => v === null),
                    _legendColor: RTTI_PALETTE[ci],
                  };
                }),
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: 'top',
                    labels: {
                      font: { size: 11 },
                      boxWidth: 12,
                      padding: 10,
                      generateLabels: rttiGenLabels,
                    },
                  },
                  title: { display: true, text: 'RTTI-scores per toets', font: { size: 13 } },
                },
                scales: {
                  x: {
                    ticks: {
                      maxRotation: 30,
                      color: (ctx) =>
                        examRttiRows[ctx.index]?.id === exam.id ? '#4a90d9' : undefined,
                      font: (ctx) => ({
                        size: 11,
                        weight: examRttiRows[ctx.index]?.id === exam.id ? 'bold' : 'normal',
                      }),
                    },
                  },
                  y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: (v) => v + '%' },
                    afterFit(s) {
                      s.paddingTop = 35;
                    },
                  },
                },
              },
            })
          );
        })();
      }

      // ── Tab: Observaties ──────────────────────────────────────────────────
      function initObservaties() {
        if (!hasObsData) return;
        const obsLabels = examObsObjects.map((o) => `${o.icon} ${o.naam}`);
        const obsCounts = examObsObjects.map((o) => obsAccum[o.id]?.count ?? 0);
        const obsBarColors = examObsObjects.map((_, i) => GROUP_PALETTE[i % GROUP_PALETTE.length]);

        // Chart 1: histogram
        const histCanvas = el.querySelector('#chart-obs-hist');
        if (histCanvas) {
          pushModalChart(
            new Chart(histCanvas, {
              type: 'bar',
              plugins: [dlAbove, lgUp],
              data: {
                labels: obsLabels,
                datasets: [{ data: obsCounts, backgroundColor: obsBarColors, borderRadius: 3 }],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  title: { display: true, text: 'Observaties', font: { size: 13 } },
                },
                scales: {
                  x: { ticks: { font: { size: 11 }, maxRotation: 20 } },
                  y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, precision: 0 },
                    afterFit(s) {
                      s.paddingTop = 30;
                    },
                  },
                },
              },
            })
          );
        }

        // Chart 2: per group
        if (hasGroupData) {
          const grpCanvas = el.querySelector('#chart-obs-groups');
          if (grpCanvas) {
            pushModalChart(
              new Chart(grpCanvas, {
                type: 'bar',
                plugins: [dlAbove, lgUp],
                data: {
                  labels: obsLabels,
                  datasets: groupEntries.map((entry, i) => ({
                    label: entry.group.name,
                    data: examObsObjects.map((o) => obsAccum[o.id]?.byGroup[entry.group.id] ?? 0),
                    backgroundColor: GROUP_PALETTE[i % GROUP_PALETTE.length],
                    borderRadius: 2,
                  })),
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: true,
                      position: 'top',
                      labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                    },
                    title: { display: true, text: 'Observaties per groep', font: { size: 13 } },
                  },
                  scales: {
                    x: { ticks: { font: { size: 11 }, maxRotation: 20 } },
                    y: {
                      beginAtZero: true,
                      ticks: { stepSize: 1, precision: 0 },
                      afterFit(s) {
                        s.paddingTop = 30;
                      },
                    },
                  },
                },
              })
            );
          }
        }

        // Chart 3: per cijfergroep (same structure as RTTI-per-cijfergroep)
        const gradeCanvas = el.querySelector('#chart-obs-grades');
        if (gradeCanvas) {
          pushModalChart(
            new Chart(gradeCanvas, {
              type: 'bar',
              plugins: [dlAbove, lgUp],
              data: {
                labels: obsLabels,
                datasets: GRADE_GROUP_LABELS.map((label, gi) => ({
                  label,
                  data: examObsObjects.map((o) => obsAccum[o.id]?.byGradeGroup[gi] ?? 0),
                  backgroundColor: gi === 0 ? '#c62828' : gradeColor(GRADE_GROUP_MIDPOINTS[gi]),
                  borderRadius: 2,
                })),
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: 'top',
                    labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                  },
                  title: { display: true, text: 'Observaties per cijfergroep', font: { size: 13 } },
                },
                scales: {
                  x: { ticks: { font: { size: 11 }, maxRotation: 20 } },
                  y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, precision: 0 },
                    afterFit(s) {
                      s.paddingTop = 30;
                    },
                  },
                },
              },
            })
          );
        }
      }

      // ── Tab switching ─────────────────────────────────────────────────────
      const tabInited = new Set(['cijferverdeling']);
      function switchTab(name) {
        el.querySelectorAll('.overview-tab').forEach((b) =>
          b.classList.toggle('selected', b.dataset.tab === name)
        );
        el.querySelectorAll('.tab-pane').forEach((p) =>
          p.classList.toggle('hidden', p.id !== `tab-${name}`)
        );
        if (!tabInited.has(name)) {
          tabInited.add(name);
          if (name === 'boxplots') initBoxplots();
          else if (name === 'vraaganalyse') initVraaganalyse();
          else if (name === 'rtti-analyse') initRttiAnalyse();
          else if (name === 'observaties') initObservaties();
        }
      }
      el.querySelectorAll('.overview-tab').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
      });

      initCijferverdeling();
    },
    true
  );
}

export async function openExamModal(existingId, afterSave = null) {
  const cfg = await Store.getConfig();
  const toetsYear = SEL.toetsenYear.getValue() || cfg.activeYear;
  await Store.loadYear(toetsYear);

  const isWi = Store.getActiveSubject() === 'wi';

  if (!existingId) {
    showModal(
      `
      <h3>Nieuwe toets — stap 1 van 2</h3>
      <div class="form-row" style="align-items:flex-end;gap:20px">
        <div class="form-group" style="flex:999;min-width:0;margin-bottom:0">
          <label>Naam</label>
          <input id="f-etitle" type="text" placeholder="PTA t.na-3 (H4, 9, 11, K3)" />
        </div>
        <div class="form-group" style="flex:none;margin-bottom:0">
          <label>PTA</label>
          <button type="button" class="pta-btn" id="f-epta-btn" data-checked="false">✓</button>
        </div>
        <div style="flex:1"></div>
        <div class="form-group" style="flex:none;width:110px;margin-bottom:0">
          <label>Schooljaar</label>
          <div id="f-exam-year-label" style="height:30px;display:flex;align-items:center;font-size:13px;color:var(--muted);font-style:italic"></div>
        </div>
      </div>
      ${
        isWi
          ? `
      <div class="form-row" style="align-items:flex-end;gap:20px;margin-top:10px">
        <div class="form-group" style="flex:none;margin-bottom:0">
          <label>Subcategorie</label>
          <div class="btn-toggle-group">
            <button class="tog-btn sub-btn" data-sub="wisa">A</button>
            <button class="tog-btn sub-btn" data-sub="wisb">B</button>
            <button class="tog-btn sub-btn" data-sub="wisc">C</button>
            <button class="tog-btn sub-btn" data-sub="wisd">D</button>
          </div>
        </div>
      </div>`
          : ''
      }
      <div class="form-row" style="align-items:flex-end;gap:20px;margin-top:10px">
        <div class="form-group" style="flex:2;margin-bottom:0">
          <label>Jaarlaag</label>
          <div class="btn-toggle-group">
            ${[1, 2, 3, 4, 5, 6]
              .map((n) => `<button class="tog-btn jl-btn" data-jl="${n}">${n}</button>`)
              .join('')}
          </div>
        </div>
        <div class="form-group" style="flex:2;margin-bottom:0">
          <label>Periode</label>
          <div class="btn-toggle-group">
            ${[1, 2, 3, 4, 5]
              .map((n) => `<button class="tog-btn per-btn" data-per="${n}">${n}</button>`)
              .join('')}
          </div>
        </div>
        <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
          <label>Weging</label>
          <div class="num-spinner" id="f-eweging" data-val="1" data-step="0.5" data-min="0" data-max="10">
            <button type="button" class="spin-btn spin-minus">−</button>
            <input class="spin-val" value="1" />
            <button type="button" class="spin-btn spin-plus">+</button>
          </div>
        </div>
        <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
          <label>Weging SE</label>
          <div class="num-spinner" id="f-eweging-se" data-val="1" data-step="0.5" data-min="0" data-max="10">
            <button type="button" class="spin-btn spin-minus">−</button>
            <input class="spin-val" value="1" />
            <button type="button" class="spin-btn spin-plus">+</button>
          </div>
        </div>
      </div>
      <div class="form-row" style="margin-top:10px;gap:20px;align-items:flex-end">
        <div class="form-group" style="flex:1;min-width:160px">
          <label>Opgave- &amp; Vraagstructuur</label>
          <div id="f-struct-host" class="csel-host"></div>
        </div>
        <div class="form-group" style="flex:none;width:108px">
          <label>Aantal vragen</label>
          <div class="num-spinner" id="f-enum" data-val="10" data-step="1" data-min="1" data-max="40">
            <button type="button" class="spin-btn spin-minus">−</button>
            <input class="spin-val" value="10" />
            <button type="button" class="spin-btn spin-plus">+</button>
          </div>
        </div>
        <div class="form-group spinner-wrap-sm">
          <label>N-term</label>
          <div class="num-spinner" id="f-enterm" data-val="1" data-step="0.1" data-min="0" data-max="3">
            <button type="button" class="spin-btn spin-minus">−</button>
            <input class="spin-val" value="1,0" />
            <button type="button" class="spin-btn spin-plus">+</button>
          </div>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-primary" id="f-e-next">Verder →</button>
        <button class="btn-secondary" data-close-modal="1">Annuleren</button>
      </div>
    `,
      (el) => {
        el.querySelector('#f-exam-year-label').textContent = toetsYear;

        const ptaBtn = el.querySelector('#f-epta-btn');
        const wegingSEl = el.querySelector('#f-eweging-se');
        const syncWegingSE = () =>
          wegingSEl.classList.toggle('spinner-disabled', ptaBtn.dataset.checked !== 'true');
        syncWegingSE();
        ptaBtn.addEventListener('click', () => {
          ptaBtn.dataset.checked = String(ptaBtn.dataset.checked !== 'true');
          syncWegingSE();
        });

        // Jaarlaag + subcategory interlock for wiskunde
        const jlBtns = el.querySelectorAll('.jl-btn');
        const subBtns = el.querySelectorAll('.sub-btn');

        jlBtns.forEach((btn) => {
          btn.addEventListener('click', () => {
            jlBtns.forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
            if (isWi) {
              const jl = parseInt(btn.dataset.jl, 10);
              const isOnderbouw = jl <= 3;
              subBtns.forEach((b) => {
                b.classList.toggle('tog-btn-disabled', isOnderbouw);
                b.disabled = isOnderbouw;
                if (isOnderbouw) b.classList.remove('selected');
              });
            }
          });
        });

        subBtns.forEach((btn) => {
          btn.addEventListener('click', () => {
            const already = btn.classList.contains('selected');
            subBtns.forEach((b) => b.classList.remove('selected'));
            if (!already) {
              btn.classList.add('selected');
              // Grey out JL 1-3
              jlBtns.forEach((b) => {
                const jl = parseInt(b.dataset.jl, 10);
                b.classList.toggle('tog-btn-disabled', jl <= 3);
                b.disabled = jl <= 3;
                if (jl <= 3) b.classList.remove('selected');
              });
            } else {
              // Deselected: re-enable all jaarlaag buttons
              jlBtns.forEach((b) => {
                b.classList.remove('tog-btn-disabled');
                b.disabled = false;
              });
            }
          });
        });

        el.querySelectorAll('.per-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const already = btn.classList.contains('selected');
            el.querySelectorAll('.per-btn').forEach((b) => b.classList.remove('selected'));
            if (!already) btn.classList.add('selected');
          });
        });

        wireSpinners(el);

        const structSel = new CustomSelect(el.querySelector('#f-struct-host'), {
          placeholder: '— kies structuur —',
        });
        structSel.setOptions([
          { value: 'roman', label: 'I1 I2 II3 … (Romeins cijfer + Volgnummer)' },
          { value: 'alpha', label: '1a 1b 2a … (Opgave + Letter)' },
          { value: 'alpha2', label: 'A1 A2 B3 … (Sectieletter + Volgnummer)' },
          { value: 'seq', label: '1, 2, 3, … (Volgnummer)' },
        ]);
        structSel.setValue('roman');

        el.querySelector('#f-e-next').addEventListener('click', () => {
          const title = el.querySelector('#f-etitle').value.trim();
          const jlBtn = el.querySelector('.jl-btn.selected');
          const jaarlaag = jlBtn ? jlBtn.dataset.jl : '';
          const subBtn = el.querySelector('.sub-btn.selected');
          const structureMode = structSel.getValue() || 'roman';
          const nterm = spinnerValue(el.querySelector('#f-enterm'));
          const weging = spinnerValue(el.querySelector('#f-eweging'));
          const weging_se = spinnerValue(el.querySelector('#f-eweging-se'));
          const periode = el.querySelector('.per-btn.selected')?.dataset.per || null;
          const isPta = ptaBtn.dataset.checked === 'true';
          const count = Math.round(spinnerValue(el.querySelector('#f-enum')));
          if (!title || isNaN(nterm) || count < 1) {
            toast('Vul alle velden in.', 'error');
            return;
          }

          let subcategory = undefined;
          if (isWi) {
            if (!jaarlaag) {
              toast('Selecteer een jaarlaag.', 'error');
              return;
            }
            subcategory =
              parseInt(jaarlaag, 10) <= 3 ? 'onderbouw' : subBtn ? subBtn.dataset.sub : null;
            if (!subcategory) {
              toast('Selecteer een subcategorie (A, B, C of D) voor jaarlaag 4-6.', 'error');
              return;
            }
          }

          const exam = {
            id: Store.makeExamId(title, toetsYear),
            title,
            jaarlaag,
            subcategory,
            n_term: nterm,
            weging,
            weging_se,
            periode,
            type: isPta ? 'pta' : 'regular',
            structureMode,
            questions: Array.from({ length: count }, (_, i) => ({
              id: `q${i + 1}`,
              section: 'I',
              number: i + 1,
              max_points: 2,
              rtti: 'T1',
            })),
          };
          showExamEditor(exam, false, toetsYear, afterSave);
        });
      }
    );
  } else {
    const all = await Store.getExams(toetsYear);
    const exam = JSON.parse(JSON.stringify(all.find((e) => e.id === existingId)));
    if (!exam.structureMode) {
      const firstSec = exam.questions[0]?.section ?? '';
      exam.structureMode = SEC_ROMAN.includes(firstSec)
        ? 'roman'
        : SEC_ALPHA2.includes(firstSec)
          ? 'alpha2'
          : firstSec === '' || firstSec == null
            ? 'seq'
            : 'alpha';
    }
    const hasScores = await Store.examHasScores(exam.id, toetsYear);
    // Lock top fields (PTA/Periode/Weging/WegingSE) when editing any attempt:
    // - resit exams always have parent_id
    // - original exams that have resits should also lock these fields (edit via summary card instead)
    const lockTopFields = !!exam.parent_id || Store.examHasResits(exam.id, toetsYear);
    showExamEditor(exam, true, toetsYear, afterSave, hasScores, lockTopFields);
  }
}

export function extractBoundaries(questions, mode) {
  const b = new Array(questions.length).fill(null);
  if (!questions.length) return b;
  b[0] = 1;
  let lastSec = secIndexOf(questions[0], mode);
  for (let i = 1; i < questions.length; i++) {
    const sec = secIndexOf(questions[i], mode);
    if (sec !== lastSec) {
      b[i] = sec;
      lastSec = sec;
    }
  }
  return b;
}

export function secIndexOf(q, mode) {
  if (mode === 'seq') return 1;
  if (mode === 'roman') {
    const idx = SEC_ROMAN.indexOf(q.section);
    return idx >= 0 ? idx + 1 : 1;
  }
  if (mode === 'alpha2') {
    const idx = SEC_ALPHA2.indexOf(q.section);
    return idx >= 0 ? idx + 1 : 1;
  }
  const n = parseInt(q.section, 10);
  return isNaN(n) ? 1 : n;
}

export function cascadeStructure(questions, boundaries, mode) {
  let currentSec = 1,
    letterIdx = 0;
  questions.forEach((q, i) => {
    const b = boundaries[i];
    if (b !== null && b !== undefined) {
      if (b !== currentSec) letterIdx = 0;
      currentSec = b;
    }
    if (mode === 'seq') {
      q.section = '';
      q.number = i + 1;
    } else if (mode === 'roman') {
      q.section = SEC_ROMAN[Math.min(currentSec - 1, 14)];
      q.number = i + 1;
    } else if (mode === 'alpha2') {
      q.section = SEC_ALPHA2[Math.min(currentSec - 1, 14)];
      q.number = i + 1;
    } else {
      // alpha: 1a 1b 2a ...
      q.section = String(currentSec);
      q.number = String.fromCharCode(96 + letterIdx + 1);
      letterIdx++;
    }
  });
}

export function showExamEditor(
  exam,
  isEdit,
  toetsYear,
  afterSave = null,
  hasScores = false,
  lockTopFields = false
) {
  const mode = exam.structureMode ?? 'roman';
  const secLabels =
    mode === 'roman'
      ? SEC_ROMAN
      : mode === 'alpha2'
        ? SEC_ALPHA2
        : mode === 'seq'
          ? Array.from({ length: 10 }, () => '')
          : Array.from({ length: 10 }, (_, i) => String(i + 1));
  const boundaries = extractBoundaries(exam.questions, mode);
  cascadeStructure(exam.questions, boundaries, mode);

  const availableObs = Store.getObservatiesSync().filter((o) =>
    (o.jaarlagen ?? []).map(String).includes(String(exam.jaarlaag))
  );

  showModal(
    `
    <h3>${
      isEdit
        ? `Toets bewerken: <em>${escHtml(exam.title)}</em> <span style="font-weight:normal;font-size:14px;font-style:normal">(Jaarlaag ${escHtml(String(exam.jaarlaag))}, ${escHtml(toetsYear)})</span>`
        : `Nieuwe toets — stap 2 van 2: <em>${escHtml(exam.title)}</em>`
    }</h3>
    <div class="form-row" style="align-items:flex-end;gap:20px;margin-bottom:10px;flex-wrap:wrap">
      <div class="form-group" style="flex:2;min-width:0;margin-bottom:0">
        <label>Naam</label>
        <input id="f-etitle2" type="text" value="${escHtml(exam.title)}" />
      </div>
      <div class="form-group" style="flex:none;margin-bottom:0">
        <label>PTA</label>
        ${
          lockTopFields
            ? `<div style="cursor:not-allowed;display:inline-block" title="Deze toetseigenschap kan alleen worden aangepast bij de verzamelkaart, voor alle toetsen tegelijkertijd."><button type="button" class="pta-btn" id="f-epta-btn" data-checked="${exam.type === 'pta' ? 'true' : 'false'}" disabled style="pointer-events:none">✓</button></div>`
            : `<button type="button" class="pta-btn" id="f-epta-btn" data-checked="${exam.type === 'pta' ? 'true' : 'false'}">✓</button>`
        }
      </div>
      ${
        !isEdit
          ? `
      <div class="form-group" style="flex:none;width:90px;margin-bottom:0">
        <label>Schooljaar</label>
        <input type="text" value="${escHtml(toetsYear)}" readonly
          style="background:var(--bg);color:var(--muted);font-size:12px;padding:0 6px" />
      </div>
      <div class="form-group" style="flex:none;margin-bottom:0">
        <label>Jaar</label>
        <button class="tog-btn jl-btn jl-locked selected" disabled>${escHtml(String(exam.jaarlaag))}</button>
      </div>`
          : ''
      }
      <div class="form-group" style="flex:1.5;margin-bottom:0">
        <label>Periode</label>
        ${
          lockTopFields
            ? `<div style="cursor:not-allowed" title="Deze toetseigenschap kan alleen worden aangepast bij de verzamelkaart, voor alle toetsen tegelijkertijd."><div class="btn-toggle-group" style="pointer-events:none">${[1, 2, 3, 4, 5].map((n) => `<button class="tog-btn per-btn tog-btn-disabled${String(exam.periode) === String(n) ? ' selected' : ''}" data-per="${n}" disabled>${n}</button>`).join('')}</div></div>`
            : `<div class="btn-toggle-group">${[1, 2, 3, 4, 5].map((n) => `<button class="tog-btn per-btn${String(exam.periode) === String(n) ? ' selected' : ''}" data-per="${n}">${n}</button>`).join('')}</div>`
        }
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging</label>
        ${
          lockTopFields
            ? `<div style="cursor:not-allowed" title="Deze toetseigenschap kan alleen worden aangepast bij de verzamelkaart, voor alle toetsen tegelijkertijd."><div class="num-spinner spinner-disabled" id="f-eweging2" data-val="${exam.weging ?? 1}" data-step="0.5" data-min="0" data-max="10"><button type="button" class="spin-btn spin-minus" disabled>−</button><input class="spin-val" value="${String(exam.weging ?? 1).replace('.', ',')}" readonly /><button type="button" class="spin-btn spin-plus" disabled>+</button></div></div>`
            : `<div class="num-spinner" id="f-eweging2" data-val="${exam.weging ?? 1}" data-step="0.5" data-min="0" data-max="10"><button type="button" class="spin-btn spin-minus">−</button><input class="spin-val" value="${String(exam.weging ?? 1).replace('.', ',')}" /><button type="button" class="spin-btn spin-plus">+</button></div>`
        }
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging SE</label>
        ${
          lockTopFields
            ? `<div style="cursor:not-allowed" title="Deze toetseigenschap kan alleen worden aangepast bij de verzamelkaart, voor alle toetsen tegelijkertijd."><div class="num-spinner spinner-disabled" id="f-eweging-se2" data-val="${exam.weging_se ?? exam.weging ?? 1}" data-step="0.5" data-min="0" data-max="10"><button type="button" class="spin-btn spin-minus" disabled>−</button><input class="spin-val" value="${String(exam.weging_se ?? exam.weging ?? 1).replace('.', ',')}" readonly /><button type="button" class="spin-btn spin-plus" disabled>+</button></div></div>`
            : `<div class="num-spinner" id="f-eweging-se2" data-val="${exam.weging_se ?? exam.weging ?? 1}" data-step="0.5" data-min="0" data-max="10"><button type="button" class="spin-btn spin-minus">−</button><input class="spin-val" value="${String(exam.weging_se ?? exam.weging ?? 1).replace('.', ',')}" /><button type="button" class="spin-btn spin-plus">+</button></div>`
        }
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>N-term</label>
        <div class="num-spinner" id="f-enterm2" data-val="${exam.n_term}" data-step="0.1" data-min="0" data-max="3">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(exam.n_term).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
    </div>
    <div class="questions-scroll">
      <table class="questions-table">
        <thead><tr>
          <th style="width:270px">Opgave</th>
          <th style="width:50px">Vr.</th>
          <th style="width:270px">Max punten</th>
          <th style="width:90px">B / D</th>
          <th>RTTI</th>
          <th style="width:36px"></th>
        </tr></thead>
        <tbody id="f-qbody"></tbody>
      </table>
    </div>
    <button class="btn-secondary" id="f-addq" style="margin-top:8px">+ Vraag toevoegen</button>
    ${
      availableObs.length > 0
        ? `
    <div class="form-group" style="margin-top:14px;margin-bottom:0">
      <label>Observaties</label>
      <div id="f-obs-group" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
        ${availableObs
          .map(
            (o) =>
              `<button type="button" class="tog-btn obs-sel-btn${(exam.obs_ids ?? []).includes(o.id) ? ' selected' : ''}"
            data-obs-id="${escHtml(o.id)}" title="${escHtml(o.naam)}"
            style="font-size:16px;width:36px;height:36px;padding:0">${escHtml(o.icon)}</button>`
          )
          .join('')}
      </div>
    </div>`
        : ''
    }
    <div class="form-actions" style="margin-top:14px">
      <button class="btn-primary" id="f-esave">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      const tbody = el.querySelector('#f-qbody');

      // PTA toggle button (skip wiring when top fields are locked)
      const ptaBtn2 = el.querySelector('#f-epta-btn');
      const wegingSE2El = el.querySelector('#f-eweging-se2');
      if (!lockTopFields) {
        const syncWegingSE2 = () =>
          wegingSE2El.classList.toggle('spinner-disabled', ptaBtn2.dataset.checked !== 'true');
        syncWegingSE2();
        ptaBtn2.addEventListener('click', () => {
          ptaBtn2.dataset.checked = String(ptaBtn2.dataset.checked !== 'true');
          syncWegingSE2();
        });
      }

      // Periode toggle buttons (skip when locked)
      if (!lockTopFields) {
        el.querySelectorAll('.per-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const already = btn.classList.contains('selected');
            el.querySelectorAll('.per-btn').forEach((b) => b.classList.remove('selected'));
            if (!already) btn.classList.add('selected');
          });
        });
      }

      wireSpinners(el);

      function renderQRows() {
        cascadeStructure(exam.questions, boundaries, mode);
        tbody.innerHTML = exam.questions
          .map((q, i) => {
            const effectiveSec = secIndexOf(q, mode);
            const secBtns = secLabels
              .map((label, si) => {
                const secNum = si + 1;
                const isSelected = effectiveSec === secNum;
                const isLocked = i === 0;
                const isSeq = mode === 'seq';
                return `<button class="sec-btn${isSelected && !isSeq ? ' selected' : ''}${isLocked || isSeq ? ' locked' : ''} ${isSeq ? 'sec-btn-inactive' : ''}" data-qi="${i}" data-sec="${secNum}" ${isSeq ? 'disabled' : ''}>${isSeq ? '' : escHtml(label)}</button>`;
              })
              .join('');
            const nrLabel =
              mode === 'seq'
                ? escHtml(String(q.number))
                : `${escHtml(String(q.section))}${escHtml(String(q.number))}`;
            return `
          <tr data-qi="${i}">
            <td><div class="sec-btn-group">${secBtns}</div></td>
            <td><span class="qi-nr-display">${nrLabel}</span></td>
            <td>
              <div class="btn-toggle-group">
                ${Array.from(
                  { length: 11 },
                  (_, n) =>
                    `<button class="tog-btn pts-btn${q.max_points === n ? ' selected' : ''}" data-qi="${i}" data-pts="${n}">${n}</button>`
                ).join('')}
              </div>
            </td>
            <td>
              <select class="kind-sel" data-qi="${i}" style="font-size:12px;padding:2px 4px;width:80px">
                <option value="normal"${(q.kind ?? 'normal') === 'normal' ? ' selected' : ''}>Normaal</option>
                <option value="bonus"${q.kind === 'bonus' ? ' selected' : ''}>Bonus</option>
                <option value="diag"${q.kind === 'diag' ? ' selected' : ''}>Diag.</option>
              </select>
            </td>
            <td>
              <div class="btn-toggle-group">
                ${['R', 'T1', 'T2', 'I']
                  .map(
                    (cat) =>
                      `<button class="tog-btn rtti-btn${q.rtti === cat ? ' selected' : ''}" data-qi="${i}" data-rtti="${cat}">${cat}</button>`
                  )
                  .join('')}
              </div>
            </td>
            <td><button class="btn-sm btn-danger qi-del" data-qi="${i}"${hasScores ? ' disabled title="Er zijn scores ingevoerd voor deze toets, bestaande vragen kunnen dus niet worden verwijderd."' : ''}>\u2715</button></td>
          </tr>`;
          })
          .join('');
      }

      tbody.addEventListener('click', (e) => {
        if (e.target.matches('.sec-btn')) {
          const i = Number(e.target.dataset.qi);
          if (i === 0) return;
          boundaries[i] = Number(e.target.dataset.sec);
          renderQRows();
          return;
        }
        if (e.target.matches('.pts-btn')) {
          const i = Number(e.target.dataset.qi);
          exam.questions[i].max_points = Number(e.target.dataset.pts);
          e.target
            .closest('.btn-toggle-group')
            .querySelectorAll('.pts-btn')
            .forEach((b) => b.classList.toggle('selected', b === e.target));
          return;
        }
        if (e.target.matches('.rtti-btn')) {
          const i = Number(e.target.dataset.qi);
          exam.questions[i].rtti = e.target.dataset.rtti;
          e.target
            .closest('.btn-toggle-group')
            .querySelectorAll('.rtti-btn')
            .forEach((b) => b.classList.toggle('selected', b === e.target));
          return;
        }
        if (e.target.matches('.qi-del')) {
          const i = Number(e.target.dataset.qi);
          exam.questions.splice(i, 1);
          boundaries.splice(i, 1);
          if (boundaries.length > 0) boundaries[0] = 1;
          renderQRows();
        }
      });

      tbody.addEventListener('change', (e) => {
        if (e.target.matches('.kind-sel')) {
          const i = Number(e.target.dataset.qi);
          exam.questions[i].kind = e.target.value;
        }
      });

      const deselectedObs = new Set();
      el.querySelectorAll('.obs-sel-btn').forEach((btn) =>
        btn.addEventListener('click', () => {
          if (hasScores) {
            const wasSelected = btn.classList.contains('selected');
            if (wasSelected) {
              if (
                !confirm(
                  'Weet je zeker dat je deze observatie wilt verwijderen uit de toets? Alle geregistreerde indicaties van deze observatie voor deze toets worden verwijderd.'
                )
              )
                return;
              deselectedObs.add(btn.dataset.obsId);
            } else {
              if (
                !confirm(
                  'Er zijn al scores ingevoerd voor deze toets. Een toegevoegde observatie kan achteraf niet meer worden verwijderd. Wil je doorgaan?'
                )
              )
                return;
              deselectedObs.delete(btn.dataset.obsId);
            }
          }
          btn.classList.toggle('selected');
        })
      );

      el.querySelector('#f-addq').addEventListener('click', async () => {
        if (
          hasScores &&
          !confirm(
            'Er zijn al scores ingevoerd voor deze toets. Een toegevoegde vraag kan achteraf niet meer worden verwijderd. Wil je doorgaan?'
          )
        )
          return;
        const last = exam.questions[exam.questions.length - 1];
        exam.questions.push({
          id: `q${exam.questions.length + 1}`,
          section: last?.section ?? 'I',
          number: (last?.number ?? 0) + 1,
          max_points: last?.max_points ?? 2,
          rtti: 'T1',
        });
        boundaries.push(null);
        renderQRows();
      });

      el.querySelector('#f-esave').addEventListener('click', async () => {
        cascadeStructure(exam.questions, boundaries, mode);
        const title = el.querySelector('#f-etitle2').value.trim();
        const jaarlaag = exam.jaarlaag; // locked field — read from exam object, not DOM
        const nterm = spinnerValue(el.querySelector('#f-enterm2'));
        // When top fields are locked, read PTA/Periode/Weging from the exam object directly
        const weging = lockTopFields
          ? (exam.weging ?? 1)
          : spinnerValue(el.querySelector('#f-eweging2'));
        const weging_se = lockTopFields
          ? (exam.weging_se ?? exam.weging ?? 1)
          : spinnerValue(el.querySelector('#f-eweging-se2'));
        const periode = lockTopFields
          ? (exam.periode ?? null)
          : el.querySelector('.per-btn.selected')?.dataset.per || null;
        const isPta = lockTopFields
          ? exam.type === 'pta'
          : el.querySelector('#f-epta-btn').dataset.checked === 'true';
        if (!title || isNaN(nterm) || exam.questions.length === 0) {
          toast('Vul alle velden in en zorg voor minstens \u00e9\u00e9n vraag.', 'error');
          return;
        }
        const obs_ids = [...el.querySelectorAll('.obs-sel-btn.selected')].map(
          (b) => b.dataset.obsId
        );
        for (const obsId of deselectedObs) {
          await Store.removeObsFromExamScores(obsId, exam.id, toetsYear);
        }
        await Store.upsertExam(
          {
            ...exam,
            title,
            jaarlaag,
            n_term: nterm,
            weging,
            weging_se,
            periode,
            structureMode: mode,
            type: isPta ? 'pta' : 'regular',
            obs_ids,
          },
          toetsYear
        );
        closeModal();
        toast('Toets opgeslagen.', 'success');
        if (afterSave) afterSave();
        else renderToetsen();
      });
      renderQRows();
    },
    true
  );
}

export async function openResitModal(parentId, year) {
  const all = await Store.getExams(year);
  const parent = all.find((e) => e.id === parentId);
  if (!parent) return;
  const resits = Store.getResitsSync(parentId, year);
  const nextAttempt = resits.length + 2; // attempt 1 is the original

  showModal(
    `
    <h3 id="f-resit-title">${escHtml(parent.title)} — …</h3>
    <div class="form-row" style="align-items:flex-end;gap:20px">
      <div class="form-group" style="flex:999;min-width:0;margin-bottom:0">
        <label>Beschrijving (bijv. INHAAL)</label>
        <input id="f-resit-desc" type="text" placeholder="INHAAL" autocomplete="off" />
      </div>
    </div>
    <div class="form-row" style="align-items:flex-end;gap:20px;margin-top:10px;opacity:.55;pointer-events:none">
      <div class="form-group" style="flex:2;margin-bottom:0">
        <label>Jaarlaag</label>
        <div class="btn-toggle-group">
          <button class="tog-btn selected" disabled>${escHtml(String(parent.jaarlaag))}</button>
        </div>
      </div>
      <div class="form-group" style="flex:2;margin-bottom:0">
        <label>Periode</label>
        <div class="btn-toggle-group">
          <button class="tog-btn selected" disabled>${escHtml(String(parent.periode ?? '—'))}</button>
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging</label>
        <div class="num-spinner spinner-disabled" style="width:90px">
          <button type="button" class="spin-btn spin-minus" disabled>−</button>
          <input class="spin-val" value="${String(parent.weging ?? 1).replace('.', ',')}" readonly />
          <button type="button" class="spin-btn spin-plus" disabled>+</button>
        </div>
      </div>
      ${
        parent.type === 'pta'
          ? `
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging SE</label>
        <div class="num-spinner spinner-disabled" style="width:90px">
          <button type="button" class="spin-btn spin-minus" disabled>−</button>
          <input class="spin-val" value="${String(parent.weging_se ?? parent.weging ?? 1).replace('.', ',')}" readonly />
          <button type="button" class="spin-btn spin-plus" disabled>+</button>
        </div>
      </div>`
          : ''
      }
    </div>
    <div class="form-row" style="margin-top:10px;gap:20px;align-items:flex-end">
      <div class="form-group" style="flex:1;min-width:160px">
        <label>Opgave- &amp; Vraagstructuur</label>
        <div id="f-resit-struct-host" class="csel-host"></div>
      </div>
      <div class="form-group" style="flex:none;width:108px">
        <label>Aantal vragen</label>
        <div class="num-spinner" id="f-resit-num" data-val="${parent.questions.length}" data-step="1" data-min="1" data-max="40">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${parent.questions.length}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
      <div class="form-group spinner-wrap-sm">
        <label>N-term</label>
        <div class="num-spinner" id="f-resit-nterm" data-val="${parent.n_term}" data-step="0.1" data-min="0" data-max="3">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(parent.n_term).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-resit-next">Verder →</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      const titleEl = el.querySelector('#f-resit-title');
      const descInput = el.querySelector('#f-resit-desc');
      descInput.addEventListener('input', () => {
        const desc = descInput.value.trim();
        titleEl.textContent = `${parent.title} — ${desc || '…'}`;
      });

      wireSpinners(el);

      const structSel = new CustomSelect(el.querySelector('#f-resit-struct-host'), {
        placeholder: '— kies structuur —',
      });
      structSel.setOptions([
        { value: 'roman', label: 'I1 I2 II3 … (Romeins cijfer + Volgnummer)' },
        { value: 'alpha', label: '1a 1b 2a … (Opgave + Letter)' },
        { value: 'alpha2', label: 'A1 A2 B3 … (Sectieletter + Volgnummer)' },
        { value: 'seq', label: '1, 2, 3, … (Volgnummer)' },
      ]);
      structSel.setValue(parent.structureMode ?? 'roman');

      el.querySelector('#f-resit-next').addEventListener('click', () => {
        const description = descInput.value.trim();
        if (!description) {
          toast('Vul een beschrijving in (bijv. INHAAL).', 'error');
          return;
        }
        const nterm = spinnerValue(el.querySelector('#f-resit-nterm'));
        const count = Math.round(spinnerValue(el.querySelector('#f-resit-num')));
        const structureMode = structSel.getValue() ?? parent.structureMode ?? 'roman';
        if (isNaN(nterm) || count < 1) {
          toast('Vul alle velden in.', 'error');
          return;
        }
        const fullTitle = `${parent.title} — ${description}`;
        const resitExam = {
          ...parent,
          id: Store.makeExamId(fullTitle, year),
          title: fullTitle,
          description,
          attempt: nextAttempt,
          parent_id: parent.id,
          n_term: nterm,
          structureMode,
          obs_ids: [],
          questions: Array.from({ length: count }, (_, i) => ({
            id: `q${i + 1}`,
            section: 'I',
            number: i + 1,
            max_points: 2,
            rtti: 'T1',
          })),
        };
        showExamEditor(resitExam, false, year, () => renderToetsen(), false, true);
      });
    }
  );
}

export async function openBestGradesOverviewModal(parentId, year) {
  const bestMap = await Store.computeBestGradeMap(parentId, year);
  // scoreOverride maps studentId → { questionScores, exam, grade }
  // The full entry is passed so openExamOverviewModal can use the pre-computed grade
  // (which was calculated against the correct attempt's exam structure) rather than
  // recalculating against the parent exam structure (which may have different max_points).
  openExamOverviewModal(parentId, year, bestMap, true);
}

export async function openSummaryEditModal(parentId, year) {
  const all = await Store.getExams(year);
  const parent = all.find((e) => e.id === parentId);
  if (!parent) return;
  const resits = Store.getResitsSync(parentId, year);
  const isPta = parent.type === 'pta';

  showModal(
    `
    <h3>Verzamelkaart bewerken: <em>${escHtml(parent.title)}</em></h3>
    <div class="form-row" style="align-items:flex-end;gap:20px;flex-wrap:wrap">
      <div class="form-group" style="flex:999;min-width:0;margin-bottom:0">
        <label>Naam</label>
        <input id="f-sum-naam" type="text" value="${escHtml(parent.title)}" />
      </div>
      <div class="form-group" style="flex:none;margin-bottom:0">
        <label>PTA</label>
        <button type="button" class="pta-btn" id="f-sum-pta" data-checked="${isPta ? 'true' : 'false'}">✓</button>
      </div>
      <div class="form-group" style="flex:1.5;margin-bottom:0">
        <label>Periode</label>
        <div class="btn-toggle-group">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button class="tog-btn per-btn${String(parent.periode) === String(n) ? ' selected' : ''}" data-per="${n}">${n}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging</label>
        <div class="num-spinner" id="f-sum-weging" data-val="${parent.weging ?? 1}" data-step="0.5" data-min="0" data-max="10">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(parent.weging ?? 1).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging SE</label>
        <div class="num-spinner${isPta ? '' : ' spinner-disabled'}" id="f-sum-weging-se" data-val="${parent.weging_se ?? parent.weging ?? 1}" data-step="0.5" data-min="0" data-max="10">
          <button type="button" class="spin-btn spin-minus"${isPta ? '' : ' disabled'}>−</button>
          <input class="spin-val" value="${String(parent.weging_se ?? parent.weging ?? 1).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus"${isPta ? '' : ' disabled'}>+</button>
        </div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-sum-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      const ptaBtn = el.querySelector('#f-sum-pta');
      const wegingSEEl = el.querySelector('#f-sum-weging-se');
      const syncWegingSE = () => {
        const active = ptaBtn.dataset.checked === 'true';
        wegingSEEl.classList.toggle('spinner-disabled', !active);
        wegingSEEl.querySelectorAll('.spin-btn').forEach((b) => {
          b.disabled = !active;
        });
      };
      ptaBtn.addEventListener('click', () => {
        ptaBtn.dataset.checked = String(ptaBtn.dataset.checked !== 'true');
        syncWegingSE();
      });
      el.querySelectorAll('.per-btn').forEach((btn) =>
        btn.addEventListener('click', () => {
          const already = btn.classList.contains('selected');
          el.querySelectorAll('.per-btn').forEach((b) => b.classList.remove('selected'));
          if (!already) btn.classList.add('selected');
        })
      );
      wireSpinners(el);

      el.querySelector('#f-sum-save').addEventListener('click', async () => {
        const naam = el.querySelector('#f-sum-naam').value.trim();
        if (!naam) {
          toast('Vul een naam in.', 'error');
          return;
        }
        const newIsPta = ptaBtn.dataset.checked === 'true';
        const newPeriode = el.querySelector('.per-btn.selected')?.dataset.per ?? null;
        const newWeging = spinnerValue(el.querySelector('#f-sum-weging'));
        const newWegingSE = spinnerValue(el.querySelector('#f-sum-weging-se'));
        const newType = newIsPta ? 'pta' : 'regular';

        // Update parent exam
        await Store.upsertExam(
          {
            ...parent,
            title: naam,
            type: newType,
            periode: newPeriode,
            weging: newWeging,
            weging_se: newWegingSE,
          },
          year
        );

        // Update each resit — derive its title from new parent naam + its own description
        for (const resit of resits) {
          await Store.upsertExam(
            {
              ...resit,
              title: `${naam} — ${resit.description ?? ''}`,
              type: newType,
              periode: newPeriode,
              weging: newWeging,
              weging_se: newWegingSE,
            },
            year
          );
        }

        closeModal();
        toast('Verzamelkaart opgeslagen.', 'success');
        renderToetsen();
      });
    }
  );
}

export async function deleteExam(id) {
  const toetsYear = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
  if (Store.examHasResits(id, toetsYear)) {
    toast('Er zijn herkansingen gekoppeld aan deze toets. Verwijder die eerst.', 'error');
    return;
  }
  if (await Store.examHasScores(id, toetsYear)) {
    toast(
      'Er zijn scores ingevoerd voor deze toets, de toets kan dus niet worden verwijderd.',
      'error'
    );
    return;
  }
  if (!confirm('Toets verwijderen?')) return;
  await Store.deleteExam(id, toetsYear);
  toast('Toets verwijderd.', 'info');
  renderToetsen();
}
