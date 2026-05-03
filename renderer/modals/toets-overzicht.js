import { lerpColor } from '../utils/colors.js';
import {
  gradeGroupIdx,
  gradeChartColor,
  GRADE_GROUP_LABELS,
  GRADE_GROUP_MIDPOINTS,
} from '../utils/grades.js';
import { showModal, closeModal, escHtml, formatGrade, pushModalChart } from '../app.js';
import { openExamModal } from './toets-edit.js';

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
      const ggi = gradeGroupIdx(grade);
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
      if (grade !== null) obsAccum[obsId].byGradeGroup[gradeGroupIdx(grade)]++;
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
        const barColors = bins.map((_, i) => gradeChartColor(start + (i + 0.5) * step));
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
                  backgroundColor:
                    gi === 0 ? '#c62828' : gradeChartColor(GRADE_GROUP_MIDPOINTS[gi]),
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
                  backgroundColor:
                    gi === 0 ? '#c62828' : gradeChartColor(GRADE_GROUP_MIDPOINTS[gi]),
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
