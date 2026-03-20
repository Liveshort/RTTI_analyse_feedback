import {
  lerpColor,
  gradeColor,
  stdDevGradeColor,
  rttiPctColor,
  examTypeColor,
} from '../utils/colors.js';
import { wireSpinners, spinnerValue } from '../utils/spinners.js';
import { showModal, closeModal, toast, persistentError, escHtml, formatGrade } from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Scores invoeren
// Col layout: [id, naam, ...N scores, spacer, totaal, cijfer, spacer, R%, T1%, T2%, I%]
// ═══════════════════════════════════════════════════════════════════════════════

let activeExam = null;
let activeObs = []; // observaties applicable to current exam jaarlaag
let activeGridData = [];
let hotInstances = [];

export function destroyHotInstances() {
  hotInstances.forEach((h) => {
    try {
      h.destroy();
    } catch (_) {}
  });
  hotInstances = [];
  activeGridData = [];
  activeExam = null;
  activeObs = [];
}

export async function openScoreModal(examId, year, deps) {
  destroyHotInstances();
  const exam = Store.getExamsSync(year).find((e) => e.id === examId);
  if (!exam) return;

  showModal(
    `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;padding-right:30px">
      <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;font-size:17px;font-weight:600">
        <span style="white-space:nowrap">Scores invoeren voor</span>
        ${
          exam.volgnummer
            ? `<span class="volgnummer" style="background:${examTypeColor(exam)};margin-right:0;flex-shrink:0">${escHtml(String(exam.volgnummer))}</span>`
            : ''
        }
        <em style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(exam.title)}</em>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <button class="btn-secondary" id="sc-edit-exam">Toets bewerken</button>
        <span class="toolbar-label">N-term:</span>
        <div class="num-spinner spinner-wrap-sm" id="sc-nterm"
          data-val="${exam.n_term ?? 1}" data-step="0.1" data-min="0" data-max="3">
          <button type="button" class="spin-btn spin-minus">&minus;</button>
          <input class="spin-val" value="${String(exam.n_term ?? 1).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
    </div>
    <div id="sc-grid-container" style="overflow-x:auto"></div>
  `,
    async (el) => {
      wireSpinners(el);

      const ntermSp = el.querySelector('#sc-nterm');
      const handleNtermChange = async () => {
        const val = spinnerValue(ntermSp);
        if (isNaN(val) || !activeExam) return;
        activeExam.n_term = val;
        await Store.upsertExam({ ...activeExam }, year);
        activeGridData.forEach((gd) => {
          const ai = gd.findIndex((r) => r[0] === '__avg__');
          const si2 = gd.findIndex((r) => r[0] === '__std__');
          const _O = activeObs ? activeObs.length : 0;
          gd.forEach((_, ri) => {
            if (ri < ai) recomputeRow(gd, activeExam, ri, _O);
          });
          recomputeSummaryRow(gd, ai, si2, activeExam, _O);
        });
        hotInstances.forEach((h) => h.render());
      };
      ntermSp
        .querySelectorAll('.spin-btn')
        .forEach((b) => b.addEventListener('click', () => setTimeout(handleNtermChange, 0)));
      ntermSp.querySelector('.spin-val').addEventListener('change', handleNtermChange);

      el.querySelector('#sc-edit-exam').addEventListener('click', () => {
        closeModal();
        deps.openExamModal(examId, async () => {
          deps.renderToetsenList();
          openScoreModal(examId, year, deps);
        });
      });

      await loadScoreGrid(
        String(exam.jaarlaag),
        examId,
        el.querySelector('#sc-grid-container'),
        year
      );
    },
    'modal-scores'
  );
}

export async function loadScoreGrid(jaarlaag, examId, container, year) {
  destroyHotInstances();
  if (!container) container = document.getElementById('score-grid-container');
  if (!examId) {
    container.innerHTML = '<p class="hint">Selecteer een toets.</p>';
    return;
  }

  if (!year) year = Store.getConfigSync().activeYear;
  const exam = Store.getExamsSync(year).find((e) => e.id === examId);
  if (!exam) return;
  activeExam = { ...exam };

  const groups = Store.getGroupsSync(year)
    .filter((g) => String(g.jaarlaag) === String(jaarlaag))
    .sort((a, b) => a.name.localeCompare(b.name));
  const allStudents = Store.getStudentsSync(year);

  if (groups.length === 0) {
    container.innerHTML = '<p class="hint">Geen groepen gevonden. Voeg eerst groepen toe.</p>';
    return;
  }

  container.innerHTML = '';

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const groupStudents = allStudents
      .filter((s) => group.student_ids.includes(s.id))
      .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));
    if (groupStudents.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'score-group-section';
    section.innerHTML = `<h3 class="group-heading">${escHtml(group.name)}</h3><div id="hot-g${gi}"></div>`;
    container.appendChild(section);

    // Row: [id, naam, ...N scores, spacer, totaal, cijfer, spacer2, ...O obs, spacer3?, R%, T1%, T2%, I%]
    const N = exam.questions.length;
    const gridData = [];
    // Determine applicable obs from the exam's explicit selection (write to module-level)
    const allObs = Store.getObservatiesSync();
    activeObs = (exam.obs_ids ?? []).map((id) => allObs.find((o) => o.id === id)).filter(Boolean);

    const scoreRecs = await Promise.all(
      groupStudents.map((s) => Store.getStudentScores(s.id, year))
    );

    for (let si = 0; si < groupStudents.length; si++) {
      const s = groupStudents[si];
      const rec = scoreRecs[si];
      const examScores = rec.scores[examId] ?? {};
      const examObsIds = rec.observations?.[examId] ?? [];
      const row = [String(s.id), Store.fullName(s)];
      exam.questions.forEach((q) => {
        const v = examScores[q.id];
        row.push(v === undefined ? '' : v === null ? 'N' : String(v));
      });
      // spacer, totaal, cijfer, spacer2
      row.push('', '', '', '');
      // obs cols (if any)
      if (activeObs.length > 0) {
        activeObs.forEach((o) => row.push(examObsIds.includes(o.id)));
        row.push(''); // spacer3
      }
      // R%, T1%, T2%, I%
      row.push('', '', '', '');
      gridData.push(row);
    }

    // Summary rows: avg (sentinel __avg__) then std dev (sentinel __std__)
    const O = activeObs.length;
    const ROFF = O > 0 ? O + 1 : 0;
    const obsTrail = O > 0 ? [...Array(O).fill(''), ''] : [];
    const trailCells = ['', '', '', '', ...obsTrail, '', '', '', ''];
    gridData.push(['__avg__', 'Gemiddelde', ...Array(N).fill(''), ...trailCells]);
    gridData.push(['__std__', 'Standaarddeviatie', ...Array(N).fill(''), ...trailCells]);

    const avgIdx = gridData.length - 2;
    const stdIdx = gridData.length - 1;
    gridData.forEach((_, ri) => {
      if (ri < avgIdx) recomputeRow(gridData, activeExam, ri, O);
    });
    recomputeSummaryRow(gridData, avgIdx, stdIdx, activeExam, O);
    activeGridData.push(gridData);

    const hot = createGroupHOT(
      document.getElementById(`hot-g${gi}`),
      activeExam,
      groupStudents,
      gridData,
      year,
      activeObs
    );
    hotInstances.push(hot);
  }
}

/**
 * Col layout (N = questions, O = applicable obs):
 *   0..1    = id, naam
 *   2..N+1  = question scores
 *   N+2     = spacer
 *   N+3     = totaal
 *   N+4     = cijfer
 *   N+5     = spacer2 (obs separator)
 *   N+6..N+5+O = obs checkboxes (if O > 0)
 *   N+6+O   = spacer3 (rtti separator, only if O > 0)
 *   N+6+ROFF = R%    where ROFF = O>0 ? O+1 : 0
 *   N+7+ROFF = T1%
 *   N+8+ROFF = T2%
 *   N+9+ROFF = I%
 */
export function recomputeRow(gridData, exam, rowIdx, O = 0) {
  const N = exam.questions.length;
  const ROFF = O > 0 ? O + 1 : 0;
  const row = gridData[rowIdx];
  const examMaxTotal = exam.questions.reduce((s, q) => s + q.max_points, 0);

  const questionScores = {};
  exam.questions.forEach((q, qi) => {
    const raw = row[2 + qi];
    if (raw === '' || raw === undefined || raw === null) return;
    const s = String(raw).toUpperCase().trim();
    if (s === 'N') {
      questionScores[q.id] = null;
      return;
    }
    const n = Number(raw);
    questionScores[q.id] = isNaN(n) ? raw : n;
  });

  if (Object.keys(questionScores).length === 0) {
    row[N + 2] = '';
    row[N + 3] = '';
    row[N + 4] = '';
    row[N + 5] = '';
    if (O > 0) {
      for (let i = 0; i < O; i++) row[N + 6 + i] = false;
      row[N + 6 + O] = '';
    }
    row[N + 6 + ROFF] = '';
    row[N + 7 + ROFF] = '';
    row[N + 8 + ROFF] = '';
    row[N + 9 + ROFF] = '';
    return;
  }

  const res = Store.calcResults(exam, questionScores);
  row[N + 2] = '';
  row[N + 3] = `${res.scored} / ${examMaxTotal}`;
  row[N + 4] = res.grade !== null ? formatGrade(res.grade) : '';
  row[N + 5] = '';
  if (O > 0) row[N + 6 + O] = ''; // spacer3 — obs cols untouched
  row[N + 6 + ROFF] = res.R === 'NVT' ? 'NVT' : res.R + '%';
  row[N + 7 + ROFF] = res.T1 === 'NVT' ? 'NVT' : res.T1 + '%';
  row[N + 8 + ROFF] = res.T2 === 'NVT' ? 'NVT' : res.T2 + '%';
  row[N + 9 + ROFF] = res.I === 'NVT' ? 'NVT' : res.I + '%';
}

export function recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, O = 0) {
  const N = exam.questions.length;
  const ROFF = O > 0 ? O + 1 : 0;
  const examMaxTotal = exam.questions.reduce((s, q) => s + q.max_points, 0);
  const totaals = [],
    grades = [];

  for (let r = 0; r < summaryIdx; r++) {
    const totaalStr = gridData[r][N + 3];
    const gradeStr = gridData[r][N + 4];
    if (totaalStr) {
      const scored = parseInt(totaalStr, 10);
      if (!isNaN(scored)) totaals.push(scored);
    }
    if (gradeStr && gradeStr !== '—') {
      const g = parseFloat(gradeStr.replace(',', '.'));
      if (!isNaN(g)) grades.push(g);
    }
  }

  function clearSpecialRow(row) {
    row[N + 2] = '';
    row[N + 3] = '';
    row[N + 4] = '';
    row[N + 5] = '';
    if (O > 0) {
      for (let i = 0; i < O; i++) row[N + 6 + i] = '';
      row[N + 6 + O] = '';
    }
    row[N + 6 + ROFF] = '';
    row[N + 7 + ROFF] = '';
    row[N + 8 + ROFF] = '';
    row[N + 9 + ROFF] = '';
  }

  // Avg row
  const avgRow = gridData[summaryIdx];
  const meanTotaal =
    totaals.length > 0 ? totaals.reduce((a, b) => a + b, 0) / totaals.length : null;
  const meanGrade = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
  clearSpecialRow(avgRow);
  avgRow[N + 3] =
    meanTotaal !== null ? meanTotaal.toFixed(1).replace('.', ',') + ' / ' + examMaxTotal : '';
  avgRow[N + 4] = meanGrade !== null ? meanGrade.toFixed(1).replace('.', ',') : '';

  // Std dev row
  if (stdIdx == null) return;
  const sdRow = gridData[stdIdx];
  function sdFn(arr, mean) {
    if (arr.length < 2) return null;
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  }
  const sdTotaal = meanTotaal !== null ? sdFn(totaals, meanTotaal) : null;
  const sdGrade = meanGrade !== null ? sdFn(grades, meanGrade) : null;
  clearSpecialRow(sdRow);
  sdRow[N + 3] = sdTotaal !== null ? sdTotaal.toFixed(1).replace('.', ',') : '';
  sdRow[N + 4] = sdGrade !== null ? sdGrade.toFixed(1).replace('.', ',') : '';
}

export function createGroupHOT(container, exam, students, gridData, year, obsArr = []) {
  const N = exam.questions.length;
  const summaryIdx = gridData.findIndex((r) => r[0] === '__avg__');
  const stdIdx = gridData.findIndex((r) => r[0] === '__std__');
  const O = obsArr.length;
  const ROFF = O > 0 ? O + 1 : 0;

  // Question headers: RTTI (top) → pts (+ gap below) → section → number (bottom)
  const qHeaders = exam.questions.map(
    (q) =>
      `<span class="hdr-rtti">${escHtml(q.rtti)}</span>` +
      `<span class="hdr-pts">${q.max_points}p</span>` +
      `<span class="hdr-opgave">${escHtml(q.section)}</span>` +
      `<span class="hdr-vraag">${q.number}</span>`
  );

  const obsHeaders =
    O > 0
      ? [
          ...obsArr.map(
            (o) => `<span class="hdr-obs" title="${escHtml(o.naam)}">${escHtml(o.icon)}</span>`
          ),
          '',
        ]
      : [];
  const colHeaders = [
    '#',
    'Naam',
    ...qHeaders,
    '',
    'Totaal',
    'Cijfer',
    '',
    ...obsHeaders,
    'R%',
    'T1%',
    'T2%',
    'I%',
  ];

  // ── Custom renderers ──────────────────────────────────────────────────────

  function idRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    const isSpecial = row === summaryIdx || row === stdIdx;
    TD.style.background = isSpecial ? '#e8ecf2' : '#f8f9fb';
    TD.style.textAlign = 'center';
    if (isSpecial) TD.style.color = 'transparent';
  }

  function naamRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    const isSpecial = row === summaryIdx || row === stdIdx;
    TD.style.background = isSpecial ? '#e8ecf2' : '#f8f9fb';
    TD.style.color = isSpecial ? 'var(--muted, #7f8c8d)' : '#000';
    TD.style.fontWeight = isSpecial ? '700' : '400';
    TD.style.fontStyle = isSpecial ? 'italic' : 'normal';
  }

  function calcCentered(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign = 'center';
    TD.style.background = row === summaryIdx || row === stdIdx ? '#dde4f0' : '#eef2f7';
    TD.style.fontWeight = '600';
  }

  function gradeRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign = 'center';
    TD.style.fontWeight = 'bold';
    TD.style.color = '#000';
    if (row === stdIdx) {
      TD.style.background = stdDevGradeColor(value) || '#dde4f0';
    } else if (row === summaryIdx) {
      TD.style.background = gradeColor(value) || '#dde4f0';
    } else {
      TD.style.background = gradeColor(value) || '#eef2f7';
    }
  }

  function rttiRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign = 'center';
    TD.style.fontWeight = '500';
    TD.style.background = row === summaryIdx ? '#e8ecf2' : rttiPctColor(value) || '#eef2f7';
  }

  function scoreRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign = 'center';
    if (row === summaryIdx || row === stdIdx) {
      TD.style.background = '#e8ecf2';
      return;
    }
    if (!value) return;
    const q = exam.questions[col - 2];
    if (!q) return;
    const upper = String(value).toUpperCase().trim();
    if (upper === 'N') {
      TD.style.background = '#cce5ff';
      TD.style.color = '#004085';
      TD.style.fontWeight = '600';
      return;
    }
    if (value === '0') {
      TD.style.background = '#f8d7da';
      return;
    }
    const num = Number(value);
    if (isNaN(num) || num < 0 || num > q.max_points) {
      TD.style.background = '#ff0033';
      TD.style.color = '#fff';
      TD.style.fontWeight = '700';
      return;
    }
    if (num === q.max_points) {
      TD.style.background = '#d4edda';
      return;
    }
    TD.style.background = '#fff3cd';
  }

  function obsRenderer(hot, TD, row, col, prop, value) {
    TD.innerHTML = '';
    TD.style.textAlign = 'center';
    TD.style.verticalAlign = 'middle';
    TD.style.background = row === summaryIdx || row === stdIdx ? '#e8ecf2' : '';
    if (row === summaryIdx || row === stdIdx) return;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = value === true;
    cb.style.cssText = 'cursor:pointer;width:14px;height:14px;margin:0';
    cb.addEventListener('change', async () => {
      const obsColStart = 2 + N + 4; // after spacer,totaal,cijfer,spacer2
      const obsIdx = col - obsColStart;
      const obs = obsArr[obsIdx];
      if (!obs) return;
      const student = students[row];
      if (!student) return;
      gridData[row][col] = cb.checked;
      await Store.setObservation(student.id, exam.id, obs.id, cb.checked, year);
    });
    TD.appendChild(cb);
  }

  const guard = { processing: false };

  const hot = new Handsontable(container, {
    data: gridData,
    colHeaders,
    rowHeaders: false,
    height: 'auto',
    licenseKey: 'non-commercial-and-evaluation',
    columns: [
      { type: 'text', readOnly: true, renderer: idRenderer, width: 72 }, // 0: #
      { type: 'text', readOnly: true, renderer: naamRenderer, width: 150 }, // 1: naam
      ...exam.questions.map(() => ({ type: 'text', renderer: scoreRenderer, width: 32 })),
      { type: 'text', readOnly: true, width: 20 }, // spacer
      { type: 'text', readOnly: true, renderer: calcCentered, width: 72 }, // totaal
      { type: 'text', readOnly: true, renderer: gradeRenderer, width: 52 }, // cijfer
      { type: 'text', readOnly: true, width: 20 }, // spacer2 (obs separator)
      ...(O > 0
        ? [
            ...obsArr.map(() => ({ readOnly: false, renderer: obsRenderer, width: 28 })),
            { type: 'text', readOnly: true, width: 14 }, // spacer3
          ]
        : []),
      ...Array.from({ length: 4 }, () => ({
        type: 'text',
        readOnly: true,
        renderer: rttiRenderer,
        width: 44,
      })),
    ],
    cells(row, col) {
      if (row === summaryIdx || row === stdIdx) return { readOnly: true };
      // Score input cols
      if (col >= 2 && col < 2 + N) return {};
      // Obs cols
      if (O > 0) {
        const obsStart = 2 + N + 4; // after spacer,totaal,cijfer,spacer2
        if (col >= obsStart && col < obsStart + O) return { readOnly: false };
      }
      return { readOnly: true };
    },
    afterGetColHeader(col, TH) {
      // Bottom-align all headers
      TH.style.verticalAlign = 'bottom';
      // Left-align Naam header; all others centered (HOT default)
      if (col === 1) TH.style.textAlign = 'left';
    },
    afterBeginEditing() {
      // Handsontable bug: it sets aria-hidden on its own focused textarea.
      // Remove it so screen readers and Chromium don't log a warning.
      const ta = container.querySelector('textarea.handsontableInput');
      if (ta) ta.removeAttribute('aria-hidden');
    },
    afterChange: async (changes) => {
      if (!changes || guard.processing) return;
      guard.processing = true;
      try {
        for (const [row, col, , newVal] of changes) {
          if (row === summaryIdx || row === stdIdx) continue;
          if (col < 2 || col >= 2 + N) continue;
          const student = students[row];
          const q = exam.questions[col - 2];
          if (!student || !q) continue;

          const raw = String(newVal ?? '').trim();
          const upper = raw.toUpperCase();

          if (raw === '') {
            gridData[row][col] = '';
            await Store.setScore(student.id, exam.id, q.id, undefined, year);
          } else if (upper === 'N') {
            gridData[row][col] = 'N';
            await Store.setScore(student.id, exam.id, q.id, null, year);
          } else {
            const num = Number(raw);
            if (isNaN(num) || num < 0 || num > q.max_points) {
              gridData[row][col] = raw;
              await Store.setScore(student.id, exam.id, q.id, raw, year);
              persistentError(
                `Ongeldige score "${raw}" voor vraag ${q.section}${q.number} (max ${q.max_points}). Controleer en herstel.`
              );
            } else {
              gridData[row][col] = String(num);
              await Store.setScore(student.id, exam.id, q.id, num, year);
            }
          }
          recomputeRow(gridData, exam, row, activeObs.length);
          recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, activeObs.length);
        }
      } finally {
        guard.processing = false;
        hot.render();
      }
    },
  });

  return hot;
}
