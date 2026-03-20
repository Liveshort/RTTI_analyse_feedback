import {
  showModal,
  closeModal,
  toast,
  escHtml,
  formatGrade,
  SEL,
  overlayElement,
  pushModalChart,
} from '../app.js';
import { lerpColor, examTypeColor } from '../utils/colors.js';
import { parseCSV, askSchoolYear } from '../utils/csv.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Leerlingen
// ═══════════════════════════════════════════════════════════════════════════════

export const leerlingenState = { year: null, search: '' };

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

  document.getElementById('btn-add-student').onclick = () => openStudentModal(null);
  document.getElementById('btn-import-students').onclick = () => openStudentCSVImport();

  renderStudentList();
}

export function renderStudentList() {
  const year = leerlingenState.year;
  const query = leerlingenState.search.trim().toLowerCase();
  const container = document.getElementById('student-list');

  let students = [...Store.getStudentsSync(year)];

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
            <button class="student-name-btn" data-action="profile" data-id="${s.id}">${escHtml(Store.fullName(s))}</button>
            <span class="card-sep">·</span>
            <span class="student-id-inline">${s.id}${s._geslacht ? ' · ' + escHtml(s._geslacht) : ''}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-sm" data-action="edit-student" data-id="${s.id}">Bewerken</button>
          <button class="btn-sm btn-danger" data-action="del-student" data-id="${s.id}">Verwijderen</button>
        </div>
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
}

// ── Group students modal ──────────────────────────────────────────────────────
export async function openGroupStudentsModal(groupId, year) {
  const group = Store.getGroupsSync(year).find((g) => g.id === groupId);
  if (!group) return;
  const allStudents = Store.getStudentsSync(year);
  const students = allStudents
    .filter((s) => group.student_ids.includes(s.id))
    .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));

  // All exams for this jaarlaag with a volgnummer, sorted (current year — for column display)
  const exams = Store.getExamsSync(year)
    .filter((e) => String(e.jaarlaag) === String(group.jaarlaag ?? '') && e.volgnummer)
    .sort((a, b) => (a.volgnummer ?? 0) - (b.volgnummer ?? 0));

  // Load current-year scores for grade cells
  const scoreMap = {};
  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    scoreMap[s.id] = rec?.scores ?? {};
  }

  // Per-student dossier (SE) average from full history — mirrors openProfielModal
  const dossierAvgMap = {};
  for (const s of students) {
    const history = await Store.getStudentHistory(s.id);
    const ptaResults = history.filter((h) => h.exam.type === 'pta');
    let sumW = 0,
      sumWG = 0;
    for (const { exam, questionScores } of ptaResults) {
      const res = Store.calcResults(exam, questionScores);
      if (res.grade === null) continue;
      const w = Number(exam.weging_se ?? exam.weging ?? 1);
      sumW += w;
      sumWG += w * res.grade;
    }
    dossierAvgMap[s.id] = sumW > 0 ? sumWG / sumW : null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function studentGrade(s, exam) {
    const examScores = scoreMap[s.id][exam.id];
    if (!examScores || Object.keys(examScores).length === 0) return null;
    const qs = {};
    exam.questions.forEach((q) => {
      const v = examScores[q.id];
      if (v !== undefined) qs[q.id] = v;
    });
    if (Object.keys(qs).length === 0) return null;
    return Store.calcResults(exam, qs).grade;
  }

  function calcWeightedAvg(pairs) {
    // pairs: [{grade, weging}]
    let sumW = 0,
      sumWG = 0;
    for (const { grade, weging } of pairs) {
      if (grade === null) continue;
      const w = Number(weging ?? 1);
      sumW += w;
      sumWG += w * grade;
    }
    return sumW > 0 ? sumWG / sumW : null;
  }

  function gradeTextColor(g) {
    if (g === null) return '#aaa';
    if (g < 5.5) return '#c0392b';
    return lerpColor('#b8860b', '#2e7d32', (g - 5.5) / 4.5);
  }
  function gradeBorderColor(g) {
    if (g === null) return '#ddd';
    if (g < 5.5) return '#e57373';
    return lerpColor('#ffd54f', '#66bb6a', (g - 5.5) / 4.5);
  }
  function gradeCell(g) {
    const label = g !== null ? formatGrade(g) : '—';
    const bc = gradeBorderColor(g);
    const tc = gradeTextColor(g);
    const fw = g !== null && g < 5.5 ? 'bold' : '500';
    return `<td style="text-align:center;padding:3px 4px">
      <span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${bc};
        border-radius:4px;font-size:12px;font-weight:${fw};color:${tc}">${label}</span></td>`;
  }

  // ── Group exams by Periode ─────────────────────────────────────────────────
  const periodes = [...new Set(exams.map((e) => e.periode ?? '—'))].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
  const byPeriode = periodes.map((p) => ({
    p,
    exs: exams.filter((e) => (e.periode ?? '—') === p),
  }));

  // ── Header rows ────────────────────────────────────────────────────────────
  const yearShort = year
    .split('-')
    .map((y) => y.slice(-2))
    .join('');
  // Row 1: Naam | Periode N (colspan) | ... | Jaar | PTA
  const thStyle = `style="text-align:center;padding:3px 6px;font-size:11px;font-weight:600;
    color:var(--muted);text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid var(--border)"`;
  const nameTh = `<th rowspan="2" style="text-align:left;padding:4px 12px 4px 4px;font-weight:600;
    border-bottom:2px solid var(--border);white-space:nowrap;vertical-align:bottom">Naam</th>`;

  const periodeCols =
    byPeriode
      .map(
        ({ p, exs }) =>
          `<th colspan="${exs.length}" ${thStyle} style="text-align:center;padding:3px 6px;font-size:11px;
      font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;
      border-bottom:1px solid var(--border);border-right:1px solid #e0e0e0">
      Periode ${escHtml(String(p))}</th>`
      )
      .join('') +
    `<th colspan="2" ${thStyle} style="text-align:center;padding:3px 6px;font-size:11px;
    font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;
    border-bottom:1px solid var(--border);border-left:2px solid var(--border)">Gemiddelde</th>`;

  // Row 2: exam badges per periode | Jaar | Dossier
  const examBadgeCols =
    byPeriode
      .map(({ exs }, pi) =>
        exs
          .map(
            (e, ei) =>
              `<th style="text-align:center;padding:4px 3px;border-bottom:2px solid var(--border);
        ${ei === exs.length - 1 && pi < byPeriode.length - 1 ? 'border-right:1px solid #e0e0e0' : ''}">
        <span class="volgnummer" style="background:${examTypeColor(e)};margin-right:0">${e.volgnummer}</span></th>`
          )
          .join('')
      )
      .join('') +
    `<th style="text-align:center;padding:4px 6px;border-bottom:2px solid var(--border);
    border-left:2px solid var(--border);font-size:11px;font-weight:600;color:var(--muted);
    white-space:nowrap">${yearShort}</th>` +
    `<th style="text-align:center;padding:4px 6px;border-bottom:2px solid var(--border);
    font-size:11px;font-weight:600;color:var(--muted);white-space:nowrap">SE</th>`;

  // ── Student rows ───────────────────────────────────────────────────────────
  const rows = students
    .map((s, si) => {
      const rowBg = si % 2 === 0 ? 'background:#f8f9fb' : 'background:#fff';

      const nameCell = `<td style="padding:5px 12px 5px 4px;white-space:nowrap;${rowBg}">
      <button class="student-name-btn group-name-btn" data-action="open-student-from-group"
        data-id="${s.id}" data-groupid="${escHtml(groupId)}" data-year="${escHtml(year)}"
        style="font-size:13px">${escHtml(Store.fullName(s))}</button>
      <span class="card-sep" style="margin:0 4px">·</span>
      <span class="student-id-inline">${s.id}</span></td>`;

      const examCells = byPeriode
        .map(({ exs }, pi) =>
          exs
            .map((e, ei) => {
              const g = studentGrade(s, e);
              const label = g !== null ? formatGrade(g) : '—';
              const bc = gradeBorderColor(g);
              const tc = gradeTextColor(g);
              const fw = g !== null && g < 5.5 ? 'bold' : '500';
              const borderR =
                ei === exs.length - 1 && pi < byPeriode.length - 1
                  ? 'border-right:1px solid #e0e0e0'
                  : '';
              return `<td style="text-align:center;padding:3px 4px;${rowBg};${borderR}">
          <span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${bc};
            border-radius:4px;font-size:12px;font-weight:${fw};color:${tc}">${label}</span></td>`;
            })
            .join('')
        )
        .join('');

      // Weighted averages
      const yearPairs = exams.map((e) => ({ grade: studentGrade(s, e), weging: e.weging }));
      const yearAvg = calcWeightedAvg(yearPairs);
      const dossierAvg = dossierAvgMap[s.id];

      const avgCells =
        `<td style="text-align:center;padding:3px 4px;border-left:2px solid var(--border);${rowBg}">${
          yearAvg !== null
            ? `<span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${gradeBorderColor(yearAvg)};
              border-radius:4px;font-size:12px;font-weight:${yearAvg < 5.5 ? 'bold' : '500'};color:${gradeTextColor(yearAvg)}"
            >${formatGrade(yearAvg)}</span>`
            : `<span style="color:#aaa">—</span>`
        }</td>` +
        `<td style="text-align:center;padding:3px 4px;${rowBg}">${
          dossierAvg !== null
            ? `<span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${gradeBorderColor(dossierAvg)};
              border-radius:4px;font-size:12px;font-weight:${dossierAvg < 5.5 ? 'bold' : '500'};color:${gradeTextColor(dossierAvg)}"
            >${formatGrade(dossierAvg)}</span>`
            : `<span style="color:#aaa">—</span>`
        }</td>`;

      return `<tr>${nameCell}${examCells}${avgCells}</tr>`;
    })
    .join('');

  showModal(
    `
    <h3>${escHtml(group.name)}</h3>
    <p class="muted" style="margin-bottom:10px">${students.length} leerlingen &mdash; klik een naam om het leerlingprofiel te openen</p>
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead>
          <tr>${nameTh}${periodeCols}</tr>
          <tr>${examBadgeCols}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `,
    (el) => {
      el.querySelectorAll('[data-action="open-student-from-group"]').forEach((b) =>
        b.addEventListener('click', () =>
          openProfielModal(
            Number(b.dataset.id),
            () => openGroupStudentsModal(b.dataset.groupid, b.dataset.year),
            students
          )
        )
      );
    },
    true
  ); // wide modal
}

// ── Student profile modal ─────────────────────────────────────────────────
export async function openProfielModal(studentId, backFn = null, peers = null) {
  const year = leerlingenState.year || Store.getConfigSync().activeYear;
  const students = await Store.getStudents(year);
  const student = students.find((s) => s.id === studentId);
  if (!student) return;

  const history = await Store.getStudentHistory(studentId);

  if (history.length === 0) {
    showModal(
      `
      <h3>${escHtml(Store.fullName(student))}</h3>
      <p class="hint">Nog geen scores voor deze leerling.</p>
    `,
      () => {
        if (backFn)
          document.getElementById('modal-close').addEventListener('click', backFn, { once: true });
      }
    );
    return;
  }

  const results = history.map(({ exam, questionScores }) => ({
    exam,
    res: Store.calcResults(exam, questionScores),
  }));

  // ── Weighted avg helper ──────────────────────────────────────────────────
  function calcWeightedAvg(rs, useSE = false) {
    let sumW = 0,
      sumWG = 0;
    for (const { exam, res } of rs) {
      if (res.grade === null) continue;
      const w = Number(useSE ? (exam.weging_se ?? exam.weging ?? 1) : (exam.weging ?? 1));
      sumW += w;
      sumWG += w * res.grade;
    }
    return sumW > 0 ? Math.round((sumWG / sumW) * 100) / 100 : null;
  }

  // ── Year groups for graph 1 ──────────────────────────────────────────────
  const barLabels = results.map((r) => (r.exam.volgnummer ? `${r.exam.volgnummer}` : r.exam.title));
  const grades = results.map((r) =>
    r.res.grade !== null ? Math.round(r.res.grade * 10) / 10 : null
  );
  const barColors = results.map((r) => examTypeColor(r.exam));

  const yearGroups = [];
  results.forEach((r, i) => {
    const yr = r.exam.academic_year ?? '\u2014';
    if (!yearGroups.length || yearGroups[yearGroups.length - 1].year !== yr)
      yearGroups.push({ year: yr, startIdx: i, endIdx: i });
    else yearGroups[yearGroups.length - 1].endIdx = i;
  });

  const yearGroupPlugin = {
    id: 'yearGroups',
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
      yearGroups.forEach((g, gi) => {
        const half = x.width / (2 * barLabels.length);
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
        ctx.fillText(g.year, (x0 + x1) / 2, bandY + bandH / 2);
      });
      ctx.restore();
    },
  };

  // ── Per-year stats for graph 3 ───────────────────────────────────────────
  const allYears = [...new Set(results.map((r) => r.exam.academic_year))].sort();
  const ptaResults = results.filter((r) => r.exam.type === 'pta');
  const avgByYear = allYears.map((yr) =>
    calcWeightedAvg(results.filter((r) => r.exam.academic_year === yr))
  );
  const dossierAvg = calcWeightedAvg(ptaResults, true);
  const avg3Labels = [...allYears, 'SE'];
  const avg3Data = [...avgByYear, dossierAvg];
  const avg3Colors = [...allYears.map(() => '#4A90D9'), '#d9534f'];

  showModal(
    `
    <div style="padding:0 2px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <h3 style="margin:0;flex:none">${escHtml(Store.fullName(student))}</h3>
        <div id="mc-prof-nav" style="flex:1;display:flex;justify-content:center;gap:6px;flex-wrap:wrap"></div>
      </div>
      <h4 style="margin:0 0 6px">Cijferverloop</h4>
      <div class="chart-wrap" style="height:300px;margin-bottom:16px"><canvas id="mc-grades"></canvas></div>
      <div style="display:flex;gap:16px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0">RTTI-score per toets</h4>
            <div id="mc-rtti-year-host" class="csel-host" style="width:180px"></div>
          </div>
          <div class="chart-wrap" style="height:240px"><canvas id="mc-rtti"></canvas></div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;margin-bottom:8px">
            <h4 style="margin:0">Gemiddeld cijfer per schooljaar</h4>
            <div style="height:30px;width:1px"></div>
          </div>
          <div class="chart-wrap" style="height:240px"><canvas id="mc-avg"></canvas></div>
        </div>
      </div>
    </div>
  `,
    (el) => {
      // X button: go back to previous screen if backFn provided, otherwise just close
      if (backFn)
        document.getElementById('modal-close').addEventListener('click', backFn, { once: true });

      // Wire prev/next navigation
      if (peers && peers.length > 1) {
        const navEl = el.querySelector('#mc-prof-nav');
        const idx = peers.findIndex((p) => p.id === studentId);
        const prev = idx > 0 ? peers[idx - 1] : null;
        const next = idx < peers.length - 1 ? peers[idx + 1] : null;
        if (prev) {
          const pb = document.createElement('button');
          pb.className = 'btn-secondary btn-sm';
          pb.textContent = `← Vorige (${Store.fullName(prev)})`;
          pb.addEventListener('click', () => openProfielModal(prev.id, backFn, peers));
          navEl.appendChild(pb);
        }
        if (next) {
          const nb = document.createElement('button');
          nb.className = 'btn-secondary btn-sm';
          nb.textContent = `Volgende (${Store.fullName(next)}) →`;
          nb.addEventListener('click', () => openProfielModal(next.id, backFn, peers));
          navEl.appendChild(nb);
        }
      }
      // Double-rAF: wait two paint frames so fullscreen layout fully settles before Chart.js measures canvas sizes
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          // ── Shared bar-label plugin factory ─────────────────────────────────
          // Draws the value on top of each bar; NVT bars use a grey 50%-height stand-in
          function makeBarLabelPlugin(opts = {}) {
            return {
              id: 'barLabels',
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

          // ── Graph 1: Cijferverloop ─────────────────────────────────────────────
          const gc = new Chart(el.querySelector('#mc-grades'), {
            type: 'bar',
            plugins: [
              yearGroupPlugin,
              makeBarLabelPlugin({ font: 'bold 10px sans-serif', format: (v) => formatGrade(v) }),
            ],
            data: {
              labels: barLabels,
              datasets: [
                {
                  label: 'Cijfer',
                  data: grades,
                  backgroundColor: barColors,
                  borderColor: barColors.map((c) => c + 'cc'),
                  borderWidth: 1,
                  borderRadius: 3,
                },
              ],
            },
            options: {
              maintainAspectRatio: false,
              layout: { padding: { bottom: 32 } },
              scales: {
                y: {
                  min: 1,
                  max: 10,
                  ticks: {
                    stepSize: 0.5,
                    callback: (v) => (Number.isInteger(v) ? v : ''),
                  },
                  grid: {
                    color: (ctx) =>
                      Number.isInteger(ctx.tick.value) ? 'rgba(0,0,0,.08)' : 'rgba(0,0,0,.03)',
                    lineWidth: (ctx) => (Number.isInteger(ctx.tick.value) ? 1 : 0.5),
                  },
                },
                x: { grid: { display: false } },
              },
              plugins: {
                legend: { display: false },
                annotation: {
                  annotations: {
                    passLine: {
                      type: 'line',
                      yMin: 5.5,
                      yMax: 5.5,
                      borderColor: 'rgba(120,120,120,.55)',
                      borderWidth: 1.5,
                      borderDash: [5, 4],
                    },
                  },
                },
                tooltip: {
                  callbacks: {
                    title: (items) => {
                      const r = results[items[0].dataIndex];
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

          // ── Graph 3: Avg grades per year ───────────────────────────────────────
          const avgChart = new Chart(el.querySelector('#mc-avg'), {
            type: 'bar',
            plugins: [
              makeBarLabelPlugin({ font: 'bold 10px sans-serif', format: (v) => formatGrade(v) }),
            ],
            data: {
              labels: avg3Labels,
              datasets: [
                {
                  label: 'Gemiddeld cijfer',
                  data: avg3Data,
                  backgroundColor: avg3Colors,
                  borderColor: avg3Colors.map((c) => c + 'cc'),
                  borderWidth: 1,
                  borderRadius: 3,
                },
              ],
            },
            options: {
              maintainAspectRatio: false,
              layout: { padding: { bottom: 4 } },
              scales: {
                y: {
                  min: 1,
                  max: 10,
                  ticks: { stepSize: 1, autoSkip: false },
                  grid: { color: 'rgba(0,0,0,.06)' },
                },
                x: { grid: { display: false } },
              },
              plugins: {
                legend: { display: false },
                annotation: {
                  annotations: {
                    passLine: {
                      type: 'line',
                      yMin: 5.5,
                      yMax: 5.5,
                      borderColor: 'rgba(120,120,120,.55)',
                      borderWidth: 1.5,
                      borderDash: [5, 4],
                    },
                  },
                },
                tooltip: {
                  callbacks: {
                    label: (item) => ` Gemiddeld: ${formatGrade(item.raw)}`,
                  },
                },
              },
            },
          });

          // ── Graph 2: RTTI per toets (with year selector) ───────────────────────
          const profielState = { rttiChart: null };

          function buildRttiChart(selectedYear) {
            if (profielState.rttiChart) {
              profielState.rttiChart.destroy();
              profielState.rttiChart = null;
            }

            let filtered;
            if (selectedYear === 'se') {
              filtered = results.filter((r) => r.exam.type === 'pta');
            } else {
              filtered = results.filter((r) => r.exam.academic_year === selectedYear);
            }

            const canvas = el.querySelector('#mc-rtti');
            const rLabels = filtered.map((r) =>
              r.exam.volgnummer ? `${r.exam.volgnummer}` : r.exam.title
            );

            function avg(cat) {
              const vals = filtered
                .map((r) => (r.res[cat] === 'NVT' ? null : r.res[cat]))
                .filter((v) => v !== null);
              return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            }

            const NVT_CLR = '#c0c8d4';
            // Helper: map raw value to chart data (NVT → 50 for grey bar at half height)
            const toVal = (v) => (v === 'NVT' ? 50 : v === null ? null : v);
            const toClr = (v, c) => (v === 'NVT' ? NVT_CLR : c);
            const isNvtFn = (v) => v === 'NVT';

            // Add gap + average bar at end
            const labels = filtered.length ? [...rLabels, null, 'Gem.'] : ['Gem.'];
            const gap = filtered.length ? [null] : [];
            const gapB = filtered.length ? [false] : [];

            const cats = { R: '#5cb85c', T1: '#5bc0de', T2: '#f0ad4e', I: '#d9534f' };
            const datasets = Object.entries(cats).map(([cat, color]) => {
              const raw = filtered.map((r) => r.res[cat]);
              const data = [...raw.map(toVal), ...gap, avg(cat)];
              const colors = [
                ...raw.map((v) => toClr(v, color)),
                ...(gap.length ? [null] : []),
                color,
              ];
              const nvtArr = [...raw.map(isNvtFn), ...gapB, false];
              return { label: cat, data, backgroundColor: colors, nvtArr };
            });

            // Build nvt map for plugin: { datasetIndex: nvtArray }
            const nvtMap = {};
            datasets.forEach((ds, di) => {
              nvtMap[di] = ds.nvtArr;
            });

            profielState.rttiChart = new Chart(canvas, {
              type: 'bar',
              plugins: [
                makeBarLabelPlugin({
                  nvt: nvtMap,
                  format: (v, di, pi) => {
                    if (nvtMap[di]?.[pi]) return 'NVT';
                    return Math.round(v) + '%';
                  },
                }),
                {
                  id: 'legendMargin',
                  beforeInit(chart) {
                    const orig = chart.legend.fit.bind(chart.legend);
                    chart.legend.fit = function () {
                      orig();
                      this.height += 14;
                    };
                  },
                },
              ],
              data: {
                labels,
                datasets: datasets.map(({ label, data, backgroundColor }) => ({
                  label,
                  data,
                  backgroundColor,
                })),
              },
              options: {
                maintainAspectRatio: false,
                layout: { padding: {} },
                scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
                plugins: {
                  legend: {
                    position: 'top',
                    labels: {
                      generateLabels(chart) {
                        const catColors = {
                          R: '#5cb85c',
                          T1: '#5bc0de',
                          T2: '#f0ad4e',
                          I: '#d9534f',
                        };
                        return chart.data.datasets.map((ds, i) => ({
                          text: ds.label,
                          fillStyle: catColors[ds.label] ?? ds.backgroundColor,
                          strokeStyle: catColors[ds.label] ?? ds.backgroundColor,
                          lineWidth: 0,
                          hidden: !chart.isDatasetVisible(i),
                          datasetIndex: i,
                        }));
                      },
                    },
                  },
                },
              },
            });
            pushModalChart(profielState.rttiChart);
          }

          const rttiyearSel = new CustomSelect(el.querySelector('#mc-rtti-year-host'), {
            placeholder: '\u2014 kies jaar \u2014',
            onChange: (val) => buildRttiChart(val),
          });
          rttiyearSel.setOptions([
            ...allYears.map((y) => ({ value: y, label: y })),
            { value: 'se', label: 'Examendossier' },
          ]);
          const initYear = allYears[allYears.length - 1];
          rttiyearSel.setValue(initYear);
          buildRttiChart(initYear);

          pushModalChart(gc);
          pushModalChart(avgChart);
        })
      ); // end double-requestAnimationFrame
    },
    'modal-profile'
  );
}

// ── Student add/edit modal ────────────────────────────────────────────────────
export function openStudentModal(id) {
  showModal(
    `
    <h3>${id ? 'Leerling bewerken' : 'Leerling toevoegen'}</h3>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label>Leerlingnummer</label>
        <input id="f-sid" type="number" placeholder="105455" ${id ? 'disabled' : ''} />
      </div>
      <div class="form-group" style="flex:1">
        <label>Geslacht</label>
        <div id="f-sgeslacht-host" class="csel-host"></div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>Voornaam</label>
        <input id="f-svoornaam" type="text" />
      </div>
      <div class="form-group" style="flex:1">
        <label>Tussenvoegsel</label>
        <input id="f-stussen" type="text" placeholder="van" />
      </div>
      <div class="form-group" style="flex:2">
        <label>Achternaam</label>
        <input id="f-sachter" type="text" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>Stamklas</label>
        <input id="f-sstamklas" type="text" placeholder="5A" />
      </div>
      <div class="form-group" style="flex:1.5">
        <label>Schooljaar</label>
        <div id="f-syear-label" style="padding:7px 0;font-size:13px;color:var(--muted);font-style:italic"></div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-s-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    async (el) => {
      const year = leerlingenState.year || Store.getConfigSync().activeYear;
      el.querySelector('#f-syear-label').textContent = year;

      const geslachtSel = new CustomSelect(el.querySelector('#f-sgeslacht-host'), {
        placeholder: '—',
      });
      geslachtSel.setOptions([
        { value: '', label: '—' },
        { value: 'M', label: 'M' },
        { value: 'V', label: 'V' },
        { value: 'X', label: 'X' },
      ]);
      geslachtSel.setValue('');

      if (id) {
        const s = (await Store.getStudents(year)).find((s) => s.id === id);
        if (s) {
          el.querySelector('#f-sid').value = s.id;
          el.querySelector('#f-svoornaam').value = s.voornaam ?? '';
          el.querySelector('#f-stussen').value = s.tussenvoegsel ?? '';
          el.querySelector('#f-sachter').value = s.achternaam ?? s.name ?? '';
          el.querySelector('#f-sstamklas').value = s.stamklas ?? '';
          geslachtSel.setValue(s.geslacht ?? '');
        }
      }

      el.querySelector('#f-s-save').addEventListener('click', async () => {
        const sid = Number(el.querySelector('#f-sid').value);
        const achternaam = el.querySelector('#f-sachter').value.trim();
        if (!sid || !achternaam) {
          toast('Vul leerlingnummer en achternaam in.', 'error');
          return;
        }
        await Store.upsertStudent(
          {
            id: sid,
            voornaam: el.querySelector('#f-svoornaam').value.trim(),
            tussenvoegsel: el.querySelector('#f-stussen').value.trim(),
            achternaam,
            stamklas: el.querySelector('#f-sstamklas').value.trim(),
            geslacht: geslachtSel.getValue(),
          },
          year
        );
        closeModal();
        toast('Leerling opgeslagen.', 'success');
        renderLeerlingen();
      });
    }
  );
}

export async function deleteStudent(id) {
  if (!confirm('Leerling verwijderen?')) return;
  await Store.deleteStudent(id, leerlingenState.year);
  toast('Leerling verwijderd.', 'info');
  renderStudentList();
}

// ── Student CSV import ────────────────────────────────────────────────────────
export async function openStudentCSVImport() {
  const cfg = await Store.getConfig();
  const existingYears = Store.listYearsSync();
  const ui = { showModal, closeModal, toast, overlay: overlayElement };
  const year = await askSchoolYear(cfg.activeYear, existingYears, ui);
  if (!year) return;

  showModal(
    `
    <h3>Leerlingen importeren — ${escHtml(year)}</h3>
    <p class="muted" style="margin-bottom:12px">
      Verwachte kolommen: <code>Leerlingnummer, Voornaam, Tussenvoegsel, Achternaam, Geslacht, Stamklas</code>
    </p>
    <div class="form-group">
      <label>CSV-bestand</label>
      <input type="file" id="f-csv-students" accept=".csv,.txt" />
    </div>
    <div id="csv-preview"></div>
    <div class="form-actions" style="margin-top:12px">
      <button class="btn-primary" id="f-csv-import" disabled>Importeren</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      let parsed = null;
      el.querySelector('#f-csv-students').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        parsed = parseCSV(await file.text()).rows;
        const preview = el.querySelector('#csv-preview');
        if (!parsed.length) {
          preview.innerHTML = '<p class="hint">Geen rijen gevonden.</p>';
          el.querySelector('#f-csv-import').disabled = true;
          return;
        }
        preview.innerHTML = `
        <p style="margin:8px 0 4px"><strong>${parsed.length}</strong> leerlingen gevonden (eerste 5):</p>
        <table class="preview-table">
          <thead><tr>${Object.keys(parsed[0])
            .map((h) => `<th>${escHtml(h)}</th>`)
            .join('')}</tr></thead>
          <tbody>${parsed
            .slice(0, 5)
            .map(
              (r) =>
                `<tr>${Object.values(r)
                  .map((v) => `<td>${escHtml(v)}</td>`)
                  .join('')}</tr>`
            )
            .join('')}
          </tbody></table>`;
        el.querySelector('#f-csv-import').disabled = false;
      });
      el.querySelector('#f-csv-import').addEventListener('click', async () => {
        if (!parsed) return;
        const students = parsed
          .map((r) => ({
            id: Number(r['Leerlingnummer'] ?? r['leerlingnummer']),
            voornaam: r['Voornaam'] ?? r['voornaam'] ?? '',
            tussenvoegsel: r['Tussenvoegsel'] ?? r['tussenvoegsel'] ?? '',
            achternaam: r['Achternaam'] ?? r['achternaam'] ?? '',
            geslacht: r['Geslacht'] ?? r['geslacht'] ?? '',
            stamklas: r['Stamklas'] ?? r['stamklas'] ?? '',
          }))
          .filter((s) => s.id && s.achternaam);
        await Store.upsertStudents(students, year);
        closeModal();
        toast(`${students.length} leerlingen geïmporteerd voor ${year}.`, 'success');
        leerlingenState.year = year;
        renderLeerlingen();
      });
    }
  );
}
