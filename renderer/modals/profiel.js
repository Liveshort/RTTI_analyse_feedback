// ── Student profile modal ─────────────────────────────────────────────────
import {
  showModal,
  closeModal,
  escHtml,
  formatGrade,
  pushModalChart,
  onModalSync,
  showReloadNotice,
  modalRefresher,
} from '../app.js';
import { examTypeColor } from '../utils/colors.js';
import { computeExamStats } from '../screens/toetsen.js';
import { leerlingenState } from '../screens/leerlingen.js';

/**
 * Keep an open profile up to date: new scores and exam edits refresh it
 * silently (on the same tab); a change to the student's own record needs a notice.
 */
function watchProfile(el, { studentId, year, backFn, peers, activeTab }) {
  const currentTab = () => el.querySelector('.overview-tab.selected')?.dataset.tab ?? activeTab;
  const reopen = () => openProfielModal(studentId, backFn, peers, currentTab());
  const refresh = modalRefresher(reopen);
  onModalSync('scores', (ev) => {
    if (ev.id === String(studentId) && ev.subject === Store.getActiveSubject()) refresh();
  });
  onModalSync('exam', (ev) => {
    if (ev.subject === Store.getActiveSubject()) refresh();
  });
  onModalSync('students', (ev) => {
    if (ev.year !== year) return;
    const find = (list) => JSON.stringify((list ?? []).find((s) => s.id === studentId) ?? null);
    const after = find(ev.after);
    if (find(ev.before) === after) return;
    if (after === 'null') {
      showReloadNotice('Deze leerling is verwijderd door een collega.', closeModal);
    } else {
      showReloadNotice(
        'De gegevens van deze leerling zijn gewijzigd door een collega. Het venster wordt opnieuw geladen.',
        reopen
      );
    }
  });
}

export async function openProfielModal(
  studentId,
  backFn = null,
  peers = null,
  activeTab = 'cijferverloop'
) {
  const year = leerlingenState.year || Store.getConfigSync().activeYear;
  const students = await Store.getStudents(year);
  const student = students.find((s) => s.id === studentId);
  if (!student) return;

  const rawHistory = await Store.getStudentHistory(studentId);
  const history = Store.resolveBestAttempts(rawHistory);
  // ─── NEW PROFILE MODAL ───────────────────────────────────────────────────

  if (history.length === 0) {
    showModal(
      `<h3>${escHtml(Store.fullName(student))}</h3><p class="hint">Nog geen scores voor deze leerling.</p>`,
      (el) => {
        watchProfile(el, { studentId, year, backFn, peers, activeTab });
        if (backFn)
          document.getElementById('modal-close').addEventListener('click', backFn, { once: true });
      }
    );
    return;
  }

  const results = history.map(({ exam, questionScores }) => ({
    exam,
    res: Store.calcResults(exam, questionScores),
    questionScores,
  }));
  // All attempts (including resits) where the student actually has a grade — used for per-attempt graphs
  const allResults = rawHistory
    .map(({ exam, questionScores }) => ({
      exam,
      res: Store.calcResults(exam, questionScores),
      questionScores,
    }))
    .filter((r) => r.res.grade !== null);
  // Label for a single attempt: adds "-I"/"-H" suffix for resit exams
  const examLabel = (exam) => {
    const base = exam.volgnummer ? `${exam.volgnummer}` : exam.title;
    if (!exam.parent_id) return base;
    const letter = (exam.description ?? '').trim().charAt(0).toUpperCase() || '?';
    return `${base}-${letter}`;
  };

  // Determine jaarlaag per academic year from exam data
  const jaarlaagByYear = {};
  for (const { exam } of results) {
    if (!jaarlaagByYear[exam.academic_year]) jaarlaagByYear[exam.academic_year] = exam.jaarlaag;
  }
  const allYears = [...new Set(results.map((r) => r.exam.academic_year))].sort();
  const yearLabel = (yr) => {
    const jl = jaarlaagByYear[yr];
    return jl ? `${yr} (klas ${jl})` : yr;
  };

  // Default bouw based on student's current jaarlaag
  const currentJl = parseInt(Store.jaarlaagFromStamklas(student.stamklas ?? '') || '0');
  const defaultBouw = currentJl >= 4 ? 'bovenbouw' : 'onderbouw';

  // Load observations per year for this student
  const allObs = Store.getObservatiesSync();
  const obsPerYear = {};
  for (const yr of allYears) {
    const examsInYear = Store.getExamsSync(yr);
    const rec = await Store.getStudentScores(studentId, yr);
    const studentObsByExam = rec?.observations ?? {};
    const counts = {};
    for (const exam of examsInYear) {
      const obsIds = exam.obs_ids ?? [];
      if (!obsIds.length) continue;
      const checked = studentObsByExam[exam.id] ?? [];
      for (const obsId of checked) {
        if (obsIds.includes(obsId)) counts[obsId] = (counts[obsId] ?? 0) + 1;
      }
    }
    obsPerYear[yr] = counts;
  }
  const hasObsData = Object.values(obsPerYear).some((c) => Object.keys(c).length > 0);

  const btnW = allYears.length > 3 ? 'min-width:120px' : 'min-width:150px';

  showModal(
    `
    <div style="padding:0 2px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <h3 style="margin:0;flex:none">${escHtml(Store.fullName(student))}</h3>
        <div id="mc-prof-nav" style="flex:1;display:flex;justify-content:center;gap:6px;flex-wrap:wrap"></div>
      </div>
      <div class="overview-tab-bar">
        <button class="overview-tab${activeTab === 'cijferverloop' ? ' selected' : ''}" data-tab="cijferverloop">Cijferverloop</button>
        <button class="overview-tab${activeTab === 'analyse' ? ' selected' : ''}" data-tab="analyse">Analyse</button>
      </div>
      <div style="margin:0 -28px -28px;padding:16px 28px 28px;background:var(--bg)">

      <div class="tab-pane${activeTab === 'cijferverloop' ? '' : ' hidden'}" id="tab-cijferverloop">
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px 14px;margin-bottom:16px;background:var(--surface)">
          <div style="height:280px;position:relative"><canvas id="mc-bouw-chart"></canvas></div>
          <div style="display:flex;justify-content:flex-end;margin-top:10px">
            <div class="btn-toggle-group">
              <button class="tog-btn mc-bouw-btn${defaultBouw === 'onderbouw' ? ' selected' : ''}" data-bouw="onderbouw" style="min-width:110px">Onderbouw</button>
              <button class="tog-btn mc-bouw-btn${defaultBouw === 'bovenbouw' ? ' selected' : ''}" data-bouw="bovenbouw" style="min-width:110px">Bovenbouw</button>
            </div>
          </div>
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px 14px;margin-bottom:16px;background:var(--surface)">
          <div style="height:260px;position:relative" id="mc-jaar-wrap">
            <p class="hint" style="margin:8px 0;font-style:italic">Laden\u2026</p>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            <div class="btn-toggle-group" id="mc-jaar-btns">
              ${allYears
                .map(
                  (yr, i) =>
                    `<button class="tog-btn mc-jaar-btn${i === allYears.length - 1 ? ' selected' : ''}" data-year="${escHtml(yr)}" style="${btnW}">${escHtml(yearLabel(yr))}</button>`
                )
                .join('')}
            </div>
          </div>
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px 14px;margin-bottom:16px;background:var(--surface)">
          <div id="mc-gem-wrap" style="height:260px;position:relative">
            <p class="hint" style="margin:8px 0;font-style:italic">Laden\u2026</p>
          </div>
        </div>
      </div>

      <div class="tab-pane${activeTab === 'analyse' ? '' : ' hidden'}" id="tab-analyse">
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px 14px;margin-bottom:16px;background:var(--surface)">
          <div style="height:260px;position:relative"><canvas id="mc-rtti-chart"></canvas></div>
          <div style="display:flex;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            <div class="btn-toggle-group" id="mc-rtti-btns">
              ${allYears
                .map(
                  (yr, i) =>
                    `<button class="tog-btn mc-rtti-btn${i === allYears.length - 1 ? ' selected' : ''}" data-year="${escHtml(yr)}" style="${btnW}">${escHtml(yearLabel(yr))}</button>`
                )
                .join('')}
              <button class="tog-btn mc-rtti-btn" data-year="se" style="${btnW}">Examendossier</button>
            </div>
          </div>
        </div>
        ${
          hasObsData
            ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px 14px;margin-bottom:16px;background:var(--surface)">
          <div style="height:260px;position:relative"><canvas id="mc-obs-chart"></canvas></div>
        </div>
        `
            : ''
        }
      </div>

      </div>
    </div>
    `,
    (el) => {
      watchProfile(el, { studentId, year, backFn, peers, activeTab });
      if (backFn)
        document.getElementById('modal-close').addEventListener('click', backFn, { once: true });

      if (peers && peers.length > 1) {
        const navEl = el.querySelector('#mc-prof-nav');
        const idx = peers.findIndex((p) => p.id === studentId);
        const prev = idx > 0 ? peers[idx - 1] : null;
        const next = idx < peers.length - 1 ? peers[idx + 1] : null;
        if (prev) {
          const pb = document.createElement('button');
          pb.className = 'btn-secondary btn-sm';
          pb.textContent = `← Vorige (${Store.fullName(prev)})`;
          pb.addEventListener('click', () => {
            const tab = el.querySelector('.overview-tab.selected')?.dataset.tab ?? 'cijferverloop';
            openProfielModal(prev.id, backFn, peers, tab);
          });
          navEl.appendChild(pb);
        }
        if (next) {
          const nb = document.createElement('button');
          nb.className = 'btn-secondary btn-sm';
          nb.textContent = `Volgende (${Store.fullName(next)}) →`;
          nb.addEventListener('click', () => {
            const tab = el.querySelector('.overview-tab.selected')?.dataset.tab ?? 'cijferverloop';
            openProfielModal(next.id, backFn, peers, tab);
          });
          navEl.appendChild(nb);
        }
      }

      requestAnimationFrame(
        () =>
          requestAnimationFrame(() => {
            // ── Shared plugins ───────────────────────────────────────────────────

            // Diagonal split icon: blue top-right triangle / red bottom-left triangle
            const splitIconCanvas = (() => {
              const cv = document.createElement('canvas');
              cv.width = 12;
              cv.height = 12;
              const c = cv.getContext('2d');
              c.fillStyle = '#4A90D9';
              c.beginPath();
              c.moveTo(0, 0);
              c.lineTo(12, 0);
              c.lineTo(12, 12);
              c.closePath();
              c.fill();
              c.fillStyle = '#d9534f';
              c.beginPath();
              c.moveTo(0, 0);
              c.lineTo(0, 12);
              c.lineTo(12, 12);
              c.closePath();
              c.fill();
              return cv;
            })();

            const lgUp = {
              id: '_lgUp',
              afterLayout(chart) {
                const lg = chart.legend;
                if (!lg) return;
                lg.top -= 10;
                lg.bottom -= 10;
              },
            };

            function makeYearGroupPlugin(yGroups, labelCount) {
              return {
                id: '_yg',
                afterDraw(chart) {
                  const {
                    ctx,
                    scales: { x, y },
                  } = chart;
                  const bandY = x.bottom + 4;
                  const bandH = 18;
                  ctx.save();
                  ctx.font = 'bold 11px sans-serif';
                  ctx.textBaseline = 'middle';
                  yGroups.forEach((g, gi) => {
                    const half = x.width / (2 * labelCount);
                    const x0 = x.getPixelForValue(g.startIdx) - half;
                    const x1 = x.getPixelForValue(g.endIdx) + half;
                    ctx.fillStyle = gi % 2 === 0 ? 'rgba(74,144,217,.08)' : 'rgba(0,0,0,.03)';
                    ctx.fillRect(x0, bandY, x1 - x0, bandH);
                    if (gi > 0) {
                      ctx.strokeStyle = '#c8d4e8';
                      ctx.lineWidth = 1;
                      ctx.beginPath();
                      ctx.moveTo(x0, y.bottom);
                      ctx.lineTo(x0, bandY + bandH);
                      ctx.stroke();
                    }
                    ctx.fillStyle = '#4A90D9';
                    ctx.textAlign = 'center';
                    ctx.fillText(g.label, (x0 + x1) / 2, bandY + bandH / 2);
                  });
                  ctx.restore();
                },
              };
            }

            function makeBarLabelPlugin(opts = {}) {
              return {
                id: '_bl',
                afterDatasetsDraw(chart) {
                  const { ctx } = chart;
                  chart.data.datasets.forEach((ds, di) => {
                    const meta = chart.getDatasetMeta(di);
                    if (meta.hidden) return;
                    meta.data.forEach((bar, pi) => {
                      const raw = ds.data[pi];
                      if (raw === null || raw === undefined) return;
                      const nvtArr = opts.nvt?.[di];
                      const isNvt = nvtArr?.[pi] === true;
                      const text = isNvt
                        ? 'NVT'
                        : opts.format
                          ? opts.format(raw, di, pi)
                          : String(Math.round(raw));
                      ctx.save();
                      ctx.fillStyle = isNvt ? '#8895a4' : '#333';
                      ctx.font = opts.font || 'bold 9px sans-serif';
                      ctx.textAlign = 'center';
                      ctx.textBaseline = 'bottom';
                      ctx.fillText(text, bar.x, bar.y - 2);
                      ctx.restore();
                    });
                  });
                },
              };
            }

            const errorBarPlugin = {
              id: '_eb',
              afterDatasetsDraw(chart) {
                const { ctx } = chart;
                chart.data.datasets.forEach((ds, di) => {
                  if (!ds._errorValues) return;
                  const meta = chart.getDatasetMeta(di);
                  if (meta.hidden) return;
                  meta.data.forEach((bar, pi) => {
                    const err = ds._errorValues[pi];
                    if (err == null || err === 0) return;
                    const yScale = chart.scales.y;
                    const avg = ds.data[pi] ?? 0;
                    const yTop = yScale.getPixelForValue(Math.min(avg + err, 10));
                    const yBot = yScale.getPixelForValue(Math.max(avg - err, 1));
                    const x0 = bar.x - bar.width / 2;
                    ctx.save();
                    ctx.fillStyle = 'rgba(80,80,80,0.18)';
                    ctx.fillRect(x0, yTop, bar.width, yBot - yTop);
                    ctx.restore();
                  });
                });
              },
            };

            const passLineAnnotation = {
              passLine: {
                type: 'line',
                yMin: 5.5,
                yMax: 5.5,
                borderColor: 'rgba(120,120,120,.55)',
                borderWidth: 1.5,
                borderDash: [5, 4],
              },
            };

            // ── GRAPH 1: Cijferverloop onder- & bovenbouw ────────────────────────
            const bouwState = { chart: null };
            function buildBouwChart(bouw) {
              if (bouwState.chart) {
                bouwState.chart.destroy();
                bouwState.chart = null;
              }
              const filtered = results.filter((r) => {
                const jl = parseInt(r.exam.jaarlaag ?? '0');
                return bouw === 'onderbouw' ? jl >= 1 && jl <= 3 : jl >= 4 && jl <= 6;
              });
              const canvas = el.querySelector('#mc-bouw-chart');
              if (!filtered.length) {
                if (canvas) {
                  const c = new Chart(canvas, {
                    type: 'bar',
                    data: { labels: [], datasets: [] },
                    options: { maintainAspectRatio: false },
                  });
                  bouwState.chart = c;
                  pushModalChart(c);
                }
                return;
              }
              const labels = filtered.map((r) => examLabel(r.exam));
              const gradeData = filtered.map((r) =>
                r.res.grade !== null ? Math.round(r.res.grade * 10) / 10 : null
              );
              const barColors = filtered.map((r) => examTypeColor(r.exam));
              const yGroups = [];
              filtered.forEach((r, i) => {
                const yr = r.exam.academic_year ?? '—';
                const lbl = yearLabel(yr);
                if (!yGroups.length || yGroups[yGroups.length - 1].year !== yr)
                  yGroups.push({ year: yr, label: lbl, startIdx: i, endIdx: i });
                else yGroups[yGroups.length - 1].endIdx = i;
              });
              bouwState.chart = new Chart(canvas, {
                type: 'bar',
                plugins: [
                  makeYearGroupPlugin(yGroups, labels.length),
                  makeBarLabelPlugin({
                    font: 'bold 10px sans-serif',
                    format: (v) => formatGrade(v),
                  }),
                ],
                data: {
                  labels,
                  datasets: [
                    {
                      label: 'Cijfer',
                      data: gradeData,
                      backgroundColor: barColors,
                      borderRadius: 3,
                    },
                  ],
                },
                options: {
                  maintainAspectRatio: false,
                  transitions: { resize: { animation: { duration: 0 } } },
                  layout: { padding: { bottom: 32 } },
                  scales: {
                    y: {
                      min: 1,
                      max: 10,
                      ticks: { stepSize: 0.5, callback: (v) => (Number.isInteger(v) ? v : '') },
                      grid: {
                        color: (ctx) =>
                          Number.isInteger(ctx.tick.value) ? 'rgba(0,0,0,.08)' : 'rgba(0,0,0,.03)',
                      },
                    },
                    x: { grid: { display: false } },
                  },
                  plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Cijferverloop', font: { size: 13 } },
                    annotation: { annotations: passLineAnnotation },
                    tooltip: {
                      callbacks: {
                        title: (items) => {
                          const r = filtered[items[0].dataIndex];
                          return (
                            (r.exam.volgnummer ? `Toets ${r.exam.volgnummer}: ` : '') + r.exam.title
                          );
                        },
                        label: (item) => ` Cijfer: ${formatGrade(item.raw)}`,
                      },
                    },
                  },
                },
              });
              pushModalChart(bouwState.chart);
            }
            // ══ TAB: CIJFERVERLOOP (lazy) ════════════════════════════════════════
            const cijferverloopInited = { done: false };
            function initCijferverloop() {
              if (cijferverloopInited.done) return;
              cijferverloopInited.done = true;

              buildBouwChart(defaultBouw);
              el.querySelectorAll('.mc-bouw-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                  el.querySelectorAll('.mc-bouw-btn').forEach((b) =>
                    b.classList.remove('selected')
                  );
                  btn.classList.add('selected');
                  buildBouwChart(btn.dataset.bouw);
                });
              });

              // ── GRAPH 2: Cijferverloop per schooljaar ────────────────────────────
              const jaarState = { chart: null };
              async function buildJaarChart(selectedYear) {
                if (jaarState.chart) {
                  jaarState.chart.destroy();
                  jaarState.chart = null;
                }
                const wrap = el.querySelector('#mc-jaar-wrap');
                const filtered = allResults.filter((r) => r.exam.academic_year === selectedYear);
                if (!filtered.length) return;
                // Create canvas lazily
                if (!wrap.querySelector('canvas')) {
                  wrap.innerHTML = '';
                  const cv = document.createElement('canvas');
                  cv.style.cssText = 'position:absolute;inset:0';
                  wrap.appendChild(cv);
                }
                const canvas = wrap.querySelector('canvas');
                const labels = filtered.map((r) => examLabel(r.exam));
                const studentGrades = filtered.map((r) =>
                  r.res.grade !== null ? Math.round(r.res.grade * 10) / 10 : null
                );
                const studentBarColors = filtered.map((r) => examTypeColor(r.exam));
                const examAvgs = [],
                  examSds = [];
                for (const { exam } of filtered) {
                  const stats = await computeExamStats(selectedYear, exam);
                  examAvgs.push(stats ? parseFloat(stats.avgG.replace(',', '.')) : null);
                  examSds.push(stats ? parseFloat(stats.sd.replace(',', '.')) : null);
                }
                if (!el.isConnected) return;
                jaarState.chart = new Chart(canvas, {
                  type: 'bar',
                  plugins: [
                    errorBarPlugin,
                    makeBarLabelPlugin({
                      font: 'bold 9px sans-serif',
                      format: (v) => formatGrade(v),
                    }),
                    lgUp,
                  ],
                  data: {
                    labels,
                    datasets: [
                      {
                        label: 'Leerling',
                        data: studentGrades,
                        backgroundColor: studentBarColors,
                        borderRadius: 3,
                      },
                      {
                        label: 'Toetsgemiddelde',
                        data: examAvgs,
                        backgroundColor: '#9e9e9e',
                        borderRadius: 3,
                        _errorValues: examSds,
                      },
                    ],
                  },
                  options: {
                    maintainAspectRatio: false,
                    transitions: { resize: { animation: { duration: 0 } } },
                    scales: {
                      y: {
                        min: 1,
                        max: 10,
                        ticks: { stepSize: 0.5, callback: (v) => (Number.isInteger(v) ? v : '') },
                        grid: {
                          color: (ctx) =>
                            Number.isInteger(ctx.tick.value)
                              ? 'rgba(0,0,0,.08)'
                              : 'rgba(0,0,0,.03)',
                        },
                      },
                      x: { grid: { display: false } },
                    },
                    plugins: {
                      legend: {
                        display: true,
                        position: 'top',
                        labels: {
                          font: { size: 11 },
                          boxWidth: 12,
                          padding: 10,
                          usePointStyle: true,
                          generateLabels(chart) {
                            const c = '#888';
                            return [
                              {
                                text: 'Leerling',
                                pointStyle: splitIconCanvas,
                                strokeStyle: 'transparent',
                                lineWidth: 0,
                                fontColor: c,
                                color: c,
                                datasetIndex: 0,
                                hidden: !chart.isDatasetVisible(0),
                              },
                              {
                                text: 'Toetsgemiddelde',
                                pointStyle: 'rect',
                                fillStyle: '#9e9e9e',
                                strokeStyle: 'transparent',
                                lineWidth: 0,
                                fontColor: c,
                                color: c,
                                datasetIndex: 1,
                                hidden: !chart.isDatasetVisible(1),
                              },
                            ];
                          },
                        },
                      },
                      title: {
                        display: true,
                        text: 'Prestaties ten opzichte van toetsgemiddelden',
                        font: { size: 13 },
                      },
                      annotation: { annotations: passLineAnnotation },
                      tooltip: {
                        callbacks: {
                          title: (items) => {
                            const r = filtered[items[0].dataIndex];
                            return `Toets ${examLabel(r.exam)}: ${r.exam.title}`;
                          },
                        },
                      },
                    },
                  },
                });
                pushModalChart(jaarState.chart);
              }
              buildJaarChart(allYears[allYears.length - 1]);
              el.querySelectorAll('.mc-jaar-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                  el.querySelectorAll('.mc-jaar-btn').forEach((b) =>
                    b.classList.remove('selected')
                  );
                  btn.classList.add('selected');
                  buildJaarChart(btn.dataset.year);
                });
              });

              // ── GRAPH 3: Verloop gemiddelde cijfer (async) ───────────────────────
              (async () => {
                const gemWrap = el.querySelector('#mc-gem-wrap');
                if (!gemWrap) return;

                // Helper: weighted average for a student's results in one year.
                // Groups original exams with their resits; only the best grade per group counts once.
                function yearAvg(examList, scoreMap) {
                  const resitsByParent = {};
                  examList
                    .filter((e) => e.parent_id)
                    .forEach((e) => {
                      (resitsByParent[e.parent_id] ??= []).push(e);
                    });
                  let sumW = 0,
                    sumWG = 0;
                  for (const e of examList) {
                    if (e.parent_id) continue; // resits are handled together with their original
                    const group = [e, ...(resitsByParent[e.id] ?? [])];
                    let bestGrade = null;
                    for (const attempt of group) {
                      const examScores = scoreMap[attempt.id];
                      if (!examScores || Object.keys(examScores).length === 0) continue;
                      const qs = {};
                      attempt.questions.forEach((q) => {
                        const v = examScores[q.id];
                        if (v !== undefined) qs[q.id] = v;
                      });
                      const res = Store.calcResults(attempt, qs);
                      if (res.grade !== null && (bestGrade === null || res.grade > bestGrade))
                        bestGrade = res.grade;
                    }
                    if (bestGrade === null) continue;
                    const w = Number(e.weging ?? 1);
                    sumW += w;
                    sumWG += w * bestGrade;
                  }
                  return sumW > 0 ? sumWG / sumW : null;
                }

                // Helper: PTA weighted average across full history for one student
                function ptaAvg(hist) {
                  let sumW = 0,
                    sumWG = 0;
                  for (const { exam, questionScores } of hist) {
                    if (exam.type !== 'pta') continue;
                    const res = Store.calcResults(exam, questionScores);
                    if (res.grade === null) continue;
                    const w = Number(exam.weging_se ?? exam.weging ?? 1);
                    sumW += w;
                    sumWG += w * res.grade;
                  }
                  return sumW > 0 ? sumWG / sumW : null;
                }

                // Student's own weighted averages per year
                const studentYearAvgs = {};
                for (const yr of allYears) {
                  const examsInYear = Store.getExamsSync(yr);
                  const rec = await Store.getStudentScores(studentId, yr);
                  studentYearAvgs[yr] = yearAvg(examsInYear, rec?.scores ?? {});
                }
                const studentPtaAvg = ptaAvg(history);

                // Jaarlaag averages per year
                const jlYearAvgs = {};
                for (const yr of allYears) {
                  const jl = String(jaarlaagByYear[yr] ?? '');
                  if (!jl) {
                    jlYearAvgs[yr] = null;
                    continue;
                  }
                  const studentsInYear = Store.getStudentsSync(yr);
                  const peers = studentsInYear.filter(
                    (s) => Store.jaarlaagFromStamklas(s.stamklas ?? '') === jl
                  );
                  const examsInYear = Store.getExamsSync(yr);
                  const peerAvgs = [];
                  for (const s of peers) {
                    // Use already-computed avg for the current student to avoid double loading
                    if (s.id === studentId) {
                      if (studentYearAvgs[yr] !== null && studentYearAvgs[yr] !== undefined)
                        peerAvgs.push(studentYearAvgs[yr]);
                      continue;
                    }
                    const rec = await Store.getStudentScores(s.id, yr);
                    const avg = yearAvg(examsInYear, rec?.scores ?? {});
                    if (avg !== null) peerAvgs.push(avg);
                  }
                  jlYearAvgs[yr] =
                    peerAvgs.length > 0
                      ? peerAvgs.reduce((a, b) => a + b, 0) / peerAvgs.length
                      : null;
                }

                // Jaarlaag SE average (current jaarlaag, PTA weighted avg per student)
                const seJl = String(jaarlaagByYear[allYears[allYears.length - 1]] ?? currentJl);
                const studentsForSe = Store.getStudentsSync(year).filter(
                  (s) => Store.jaarlaagFromStamklas(s.stamklas ?? '') === seJl
                );
                const peerPtaAvgs = [];
                if (studentPtaAvg !== null) peerPtaAvgs.push(studentPtaAvg); // include current student
                for (const s of studentsForSe) {
                  if (s.id === studentId) continue; // already added above
                  const hist = Store.resolveBestAttempts(await Store.getStudentHistory(s.id));
                  const avg = ptaAvg(hist);
                  if (avg !== null) peerPtaAvgs.push(avg);
                }
                const jlPtaAvg =
                  peerPtaAvgs.length > 0
                    ? peerPtaAvgs.reduce((a, b) => a + b, 0) / peerPtaAvgs.length
                    : null;

                if (!el.isConnected) return;

                // Build chart data
                const xLabels = [...allYears.map(yearLabel), 'SE'];
                const leerlingData = [...allYears.map((yr) => studentYearAvgs[yr]), studentPtaAvg];
                const leerlingColors = [...allYears.map(() => '#4A90D9'), '#d9534f'];
                const jlData = [...allYears.map((yr) => jlYearAvgs[yr]), jlPtaAvg];

                gemWrap.innerHTML = '';
                const cv = document.createElement('canvas');
                cv.style.cssText = 'position:absolute;inset:0';
                gemWrap.appendChild(cv);

                pushModalChart(
                  new Chart(cv, {
                    type: 'bar',
                    plugins: [
                      makeBarLabelPlugin({
                        font: 'bold 9px sans-serif',
                        format: (v) => formatGrade(v),
                      }),
                      lgUp,
                    ],
                    data: {
                      labels: xLabels,
                      datasets: [
                        {
                          label: 'Leerling',
                          data: leerlingData,
                          backgroundColor: leerlingColors,
                          borderRadius: 3,
                        },
                        {
                          label: 'Jaarlaaggemiddelde',
                          data: jlData,
                          backgroundColor: '#9e9e9e',
                          borderRadius: 3,
                        },
                      ],
                    },
                    options: {
                      maintainAspectRatio: false,
                      transitions: { resize: { animation: { duration: 0 } } },
                      scales: {
                        y: {
                          min: 1,
                          max: 10,
                          ticks: { stepSize: 1, callback: (v) => (Number.isInteger(v) ? v : '') },
                          grid: { color: 'rgba(0,0,0,.06)' },
                        },
                        x: { grid: { display: false } },
                      },
                      plugins: {
                        legend: {
                          display: true,
                          position: 'top',
                          labels: {
                            font: { size: 11 },
                            boxWidth: 12,
                            padding: 10,
                            usePointStyle: true,
                            generateLabels(chart) {
                              const c = '#888';
                              return [
                                {
                                  text: 'Leerling',
                                  pointStyle: splitIconCanvas,
                                  strokeStyle: 'transparent',
                                  lineWidth: 0,
                                  fontColor: c,
                                  color: c,
                                  datasetIndex: 0,
                                  hidden: !chart.isDatasetVisible(0),
                                },
                                {
                                  text: 'Jaarlaaggemiddelde',
                                  pointStyle: 'rect',
                                  fillStyle: '#9e9e9e',
                                  strokeStyle: 'transparent',
                                  lineWidth: 0,
                                  fontColor: c,
                                  color: c,
                                  datasetIndex: 1,
                                  hidden: !chart.isDatasetVisible(1),
                                },
                              ];
                            },
                          },
                        },
                        annotation: { annotations: passLineAnnotation },
                        title: {
                          display: true,
                          text: 'Verloop gemiddelde cijfer',
                          font: { size: 13 },
                        },
                        tooltip: {
                          callbacks: {
                            label: (item) => ` ${item.dataset.label}: ${formatGrade(item.raw)}`,
                          },
                        },
                      },
                    },
                  })
                );
              })(); // end graph 3 async
            } // end initCijferverloop

            // ══ TAB: ANALYSE (lazy) ═══════════════════════════════════════════════
            const analyseInited = { done: false };
            function initAnalyse() {
              if (analyseInited.done) return;
              analyseInited.done = true;

              // ── GRAPH: RTTI per schooljaar ─────────────────────────────────────
              const NVT_CLR = '#c0c8d4';
              const rttiState = { chart: null };

              const dlAbovePctNvt = {
                id: '_dapn',
                afterDatasetsDraw(chart) {
                  const { ctx } = chart;
                  chart.data.datasets.forEach((ds, i) => {
                    const meta = chart.getDatasetMeta(i);
                    if (meta.hidden) return;
                    meta.data.forEach((bar, j) => {
                      const v = ds.data[j];
                      if (v == null) return;
                      const isNvt = ds.nvtArr?.[j] === true;
                      const isZero = !isNvt && v === 0;

                      // Draw a thin visible stub for 0% bars
                      if (isZero) {
                        const bgColor = Array.isArray(ds.backgroundColor)
                          ? ds.backgroundColor[j]
                          : ds.backgroundColor;
                        ctx.save();
                        ctx.fillStyle = bgColor;
                        ctx.fillRect(bar.x - bar.width / 2, bar.base - 3, bar.width, 3);
                        ctx.restore();
                      }

                      // Skip label when bar is tall enough to be self-evident but too short for text (non-zero, non-NVT)
                      if (!isNvt && !isZero && bar.y >= bar.base - 12) return;

                      ctx.save();
                      ctx.fillStyle = isNvt ? '#8895a4' : '#444';
                      ctx.font = 'bold 10px sans-serif';
                      ctx.textAlign = 'center';
                      ctx.textBaseline = 'bottom';
                      // For 0% bars, label sits just above the stub
                      const labelY = isZero ? bar.base - 5 : bar.y - 1;
                      ctx.fillText(isNvt ? 'NVT' : v + '%', bar.x, labelY);
                      ctx.restore();
                    });
                  });
                },
              };
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

              function buildRttiChart(selectedYear) {
                if (rttiState.chart) {
                  rttiState.chart.destroy();
                  rttiState.chart = null;
                }
                const filtered =
                  selectedYear === 'se'
                    ? allResults.filter((r) => r.exam.type === 'pta')
                    : allResults.filter((r) => r.exam.academic_year === selectedYear);
                const canvas = el.querySelector('#mc-rtti-chart');
                const rLabels = filtered.map((r) => examLabel(r.exam));
                const avg = (cat) => {
                  const vals = filtered
                    .map((r) => (r.res[cat] === 'NVT' ? null : r.res[cat]))
                    .filter((v) => v !== null);
                  return vals.length
                    ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
                    : null;
                };
                const toVal = (v) => (v === 'NVT' ? 50 : v === null ? null : v);
                const toClr = (v, c) => (v === 'NVT' ? NVT_CLR : c);
                const labels = [...rLabels, 'Gem.'];
                const cats = { R: '#5cb85c', T1: '#5bc0de', T2: '#f0ad4e', I: '#d9534f' };
                const datasets = Object.entries(cats).map(([cat, color]) => {
                  const raw = filtered.map((r) => r.res[cat]);
                  return {
                    label: cat,
                    data: [...raw.map(toVal), avg(cat)],
                    backgroundColor: [...raw.map((v) => toClr(v, color)), color],
                    nvtArr: [...raw.map((v) => v === 'NVT'), false],
                    _legendColor: color,
                  };
                });
                const nvtMap = {};
                datasets.forEach((ds, di) => {
                  nvtMap[di] = ds.nvtArr;
                });
                rttiState.chart = new Chart(canvas, {
                  type: 'bar',
                  plugins: [dlAbovePctNvt, lgUp],
                  data: {
                    labels,
                    datasets: datasets.map(
                      ({ label, data, backgroundColor, _legendColor, nvtArr }) => ({
                        label,
                        data,
                        backgroundColor,
                        _legendColor,
                        nvtArr,
                      })
                    ),
                  },
                  options: {
                    maintainAspectRatio: false,
                    transitions: { resize: { animation: { duration: 0 } } },
                    scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
                    plugins: {
                      legend: {
                        position: 'top',
                        labels: {
                          font: { size: 11 },
                          boxWidth: 12,
                          padding: 10,
                          generateLabels: rttiGenLabels,
                        },
                      },
                      title: { display: true, text: 'RTTI-scores per toets', font: { size: 13 } },
                      tooltip: {
                        callbacks: {
                          title: (items) => {
                            const r = filtered[items[0].dataIndex];
                            if (!r) return 'Gemiddelde';
                            return `Toets ${examLabel(r.exam)}: ${r.exam.title}`;
                          },
                        },
                      },
                    },
                  },
                });
                pushModalChart(rttiState.chart);
              }
              buildRttiChart(allYears[allYears.length - 1]);
              el.querySelectorAll('.mc-rtti-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                  el.querySelectorAll('.mc-rtti-btn').forEach((b) =>
                    b.classList.remove('selected')
                  );
                  btn.classList.add('selected');
                  buildRttiChart(btn.dataset.year);
                });
              });

              // ── GRAPH: Observaties per schooljaar ──────────────────────────────
              if (hasObsData) {
                const xEntries = [];
                const yGroupsObs = [];
                let idx = 0;
                for (const yr of allYears) {
                  const counts = obsPerYear[yr];
                  const obsIds = Object.keys(counts).filter((id) => counts[id] > 0);
                  if (!obsIds.length) continue;
                  const startIdx = idx;
                  for (const obsId of obsIds) {
                    const o = allObs.find((ob) => ob.id === obsId);
                    xEntries.push({
                      icon: o?.icon ?? '?',
                      name: o?.naam ?? obsId,
                      count: counts[obsId],
                    });
                    idx++;
                  }
                  yGroupsObs.push({ label: yearLabel(yr), startIdx, endIdx: idx - 1 });
                }
                const obsCanvas = el.querySelector('#mc-obs-chart');
                if (obsCanvas && xEntries.length) {
                  pushModalChart(
                    new Chart(obsCanvas, {
                      type: 'bar',
                      plugins: [
                        makeYearGroupPlugin(yGroupsObs, xEntries.length),
                        {
                          id: '_obsLabelTooltip',
                          afterEvent(chart, args) {
                            const { event } = args;
                            const xScale = chart.scales.x;
                            let tip = document.getElementById('_obs-label-tip');
                            if (!tip) {
                              tip = document.createElement('div');
                              tip.id = '_obs-label-tip';
                              tip.style.cssText =
                                'position:fixed;background:#333;color:#fff;padding:3px 8px;border-radius:4px;font-size:12px;pointer-events:none;z-index:9999;display:none;white-space:nowrap';
                              document.body.appendChild(tip);
                            }
                            const inLabelArea =
                              event.y > chart.chartArea.bottom && event.y <= chart.height;
                            if (!inLabelArea) {
                              tip.style.display = 'none';
                              return;
                            }
                            let found = -1;
                            for (let i = 0; i < xEntries.length; i++) {
                              if (Math.abs(event.x - xScale.getPixelForTick(i)) < 20) {
                                found = i;
                                break;
                              }
                            }
                            if (found < 0) {
                              tip.style.display = 'none';
                              return;
                            }
                            const rect = chart.canvas.getBoundingClientRect();
                            tip.textContent = xEntries[found].name;
                            tip.style.left = rect.left + event.x + 12 + 'px';
                            tip.style.top = rect.top + event.y - 28 + 'px';
                            tip.style.display = 'block';
                          },
                          afterDestroy() {
                            document.getElementById('_obs-label-tip')?.remove();
                          },
                        },
                        {
                          id: '_dlAboveObs',
                          afterDatasetsDraw(chart) {
                            const { ctx } = chart;
                            chart.data.datasets.forEach((ds, di) => {
                              chart.getDatasetMeta(di).data.forEach((bar, j) => {
                                const v = ds.data[j];
                                if (!v || bar.y >= bar.base - 12) return;
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
                        },
                      ],
                      data: {
                        labels: xEntries.map((e) => e.icon),
                        datasets: [
                          {
                            data: xEntries.map((e) => e.count),
                            backgroundColor: '#4A90D9',
                            borderRadius: 3,
                          },
                        ],
                      },
                      options: {
                        maintainAspectRatio: false,
                        layout: { padding: { bottom: 32 } },
                        plugins: {
                          legend: { display: false },
                          title: {
                            display: true,
                            text: 'Observaties per schooljaar',
                            font: { size: 13 },
                          },
                        },
                        scales: {
                          x: { ticks: { font: { size: 13 }, maxRotation: 0 } },
                          y: {
                            beginAtZero: true,
                            ticks: { stepSize: 1, precision: 0 },
                            afterFit(s) {
                              s.paddingTop = 25;
                            },
                          },
                        },
                      },
                    })
                  );
                }
              }
            }

            // Tab switching
            const tabInited = new Set([activeTab]);
            function switchTab(name) {
              el.querySelectorAll('.overview-tab').forEach((b) =>
                b.classList.toggle('selected', b.dataset.tab === name)
              );
              el.querySelectorAll('.tab-pane').forEach((p) =>
                p.classList.toggle('hidden', p.id !== `tab-${name}`)
              );
              if (!tabInited.has(name)) {
                tabInited.add(name);
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    if (name === 'analyse') initAnalyse();
                    else if (name === 'cijferverloop') initCijferverloop();
                  })
                );
              }
            }
            el.querySelectorAll('.overview-tab').forEach((btn) => {
              btn.addEventListener('click', () => switchTab(btn.dataset.tab));
            });
            // Initialize whichever tab is active first
            if (activeTab === 'analyse') initAnalyse();
            else initCijferverloop();
          }) // end inner rAF
      ); // end double-requestAnimationFrame
    },
    'modal-profile'
  );
}
