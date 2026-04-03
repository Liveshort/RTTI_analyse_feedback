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
import { computeExamStats } from './toetsen.js';

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
          <button class="btn-sm btn-sm-icon" data-action="edit-student" data-id="${s.id}" title="Leerling bewerken">✎</button>
          <button class="btn-sm btn-danger btn-sm-icon" data-action="del-student" data-id="${s.id}" title="Leerling verwijderen">🗑</button>
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

  // Disable Verwijderen for students that have scores (non-blocking)
  for (const s of students) {
    Store.studentHasScores(s.id, year).then((has) => {
      if (!has) return;
      const btn = container.querySelector(
        `[data-action="del-student"][data-id="${CSS.escape(String(s.id))}"]`
      );
      if (btn) {
        btn.disabled = true;
        btn.title =
          'Er zijn scores ingevoerd voor deze leerling, de leerling kan dus niet worden verwijderd.';
      }
    });
  }
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

  // Group into families: one column per original exam, with resits attached
  const _resitMap = {};
  exams
    .filter((e) => e.parent_id)
    .forEach((e) => {
      (_resitMap[e.parent_id] ??= []).push(e);
    });
  const examFamilies = exams
    .filter((e) => !e.parent_id)
    .map((e) => ({
      original: e,
      resits: (_resitMap[e.id] ?? []).sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1)),
    }));

  // Load current-year scores for grade cells
  const scoreMap = {};
  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    scoreMap[s.id] = rec?.scores ?? {};
  }

  // Per-student dossier (SE) average from full history — mirrors openProfielModal
  const dossierAvgMap = {};
  for (const s of students) {
    const history = Store.resolveBestAttempts(await Store.getStudentHistory(s.id));
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

  function bestGradeForFamily(s, family) {
    const candidates = [family.original, ...family.resits]
      .map((e) => ({ exam: e, grade: studentGrade(s, e) }))
      .filter((x) => x.grade !== null);
    if (candidates.length === 0) return { grade: null, exam: null };
    return candidates.reduce((a, b) => (b.grade > a.grade ? b : a));
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
  const periodes = [...new Set(examFamilies.map((f) => f.original.periode ?? '—'))].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
  const byPeriode = periodes.map((p) => ({
    p,
    families: examFamilies.filter((f) => (f.original.periode ?? '—') === p),
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
        ({ p, families }) =>
          `<th colspan="${families.reduce((sum, f) => sum + 2, 0)}" ${thStyle} style="text-align:center;padding:3px 6px;font-size:11px;
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
      .map(({ families }, pi) =>
        families
          .map(
            (f, fi) =>
              `<th style="text-align:right;padding:4px 6px;border-bottom:2px solid var(--border)">
        <span class="volgnummer" style="text-align:center;background:${examTypeColor(f.original)};margin-right:0">${f.original.volgnummer}</span></th>
        <th style="text-align:center;padding:4px 3px;border-bottom:2px solid var(--border);
        ${fi === families.length - 1 ? 'border-right:1px solid #e0e0e0' : ''}"></th>`
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
        .map(({ families }, pi) =>
          families
            .map((f, fi) => {
              const { grade: g, exam: fromExam } = bestGradeForFamily(s, f);
              const label = g !== null ? formatGrade(g) : '—';
              const bc = gradeBorderColor(g);
              const tc = gradeTextColor(g);
              const fw = g !== null && g < 5.5 ? 'bold' : '500';
              const borderR = fi === families.length - 1 ? 'border-right:1px solid #e0e0e0' : '';
              const badgeLetter = fromExam?.parent_id
                ? (fromExam.description ?? '').trim().charAt(0).toUpperCase() || '?'
                : '';
              const badgeCell =
                `<td style="text-align:left;vertical-align:top;padding:3px 1px 3px 2px;width:30px;${rowBg};${borderR}">` +
                (badgeLetter
                  ? `<span title="${(fromExam.description ?? '').trim()}" style="display:inline-flex;align-items:center;justify-content:center;` +
                    `width:16px;height:16px;border-radius:50%;background:var(--primary);` +
                    `color:#fff;font-size:8px;font-weight:700;line-height:1;cursor:default">${badgeLetter}</span>`
                  : '') +
                `</td>`;
              return (
                `<td style="text-align:right;padding:3px 4px;width:50px;${rowBg}">` +
                `<span style="text-align:center;display:inline-block;min-width:36px;padding:1px 5px;border:2px solid ${bc};` +
                `border-radius:4px;font-size:12px;font-weight:${fw};color:${tc}">${label}</span></td>` +
                badgeCell
              );
            })
            .join('')
        )
        .join('');

      // Weighted averages
      const yearPairs = examFamilies.map((f) => ({
        grade: bestGradeForFamily(s, f).grade,
        weging: f.original.weging,
      }));
      const yearAvg = calcWeightedAvg(yearPairs);
      const dossierAvg = dossierAvgMap[s.id];

      const avgCells =
        `<td style="text-align:center;padding:3px 4px;width:70px;border-left:2px solid var(--border);${rowBg}">${
          yearAvg !== null
            ? `<span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${gradeBorderColor(yearAvg)};
              border-radius:4px;font-size:12px;font-weight:${yearAvg < 5.5 ? 'bold' : '500'};color:${gradeTextColor(yearAvg)}"
            >${formatGrade(yearAvg)}</span>`
            : `<span style="color:#aaa">—</span>`
        }</td>` +
        `<td style="text-align:center;padding:3px 4px;width:70px;${rowBg}">${
          dossierAvg !== null
            ? `<span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${gradeBorderColor(dossierAvg)};
              border-radius:4px;font-size:12px;font-weight:${dossierAvg < 5.5 ? 'bold' : '500'};color:${gradeTextColor(dossierAvg)}"
            >${formatGrade(dossierAvg)}</span>`
            : `<span style="color:#aaa">—</span>`
        }</td>`;

      return `<tr>${nameCell}${examCells}${avgCells}</tr>`;
    })
    .join('');

  // ── Averages footer row ────────────────────────────────────────────────────
  const avgRowExamCells = byPeriode
    .map(({ families }) =>
      families
        .map((f, fi) => {
          const grades = students
            .map((s) => bestGradeForFamily(s, f).grade)
            .filter((g) => g !== null);
          const avg = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
          const label = avg !== null ? formatGrade(avg) : '—';
          const bc = gradeBorderColor(avg);
          const tc = gradeTextColor(avg);
          const fw = avg !== null && avg < 5.5 ? 'bold' : '500';
          const borderR = fi === families.length - 1 ? 'border-right:1px solid #e0e0e0' : '';
          return (
            `<td style="text-align:right;padding:3px 4px;background:#f0f4ff">` +
            `<span style="text-align:center;display:inline-block;min-width:36px;padding:1px 5px;border:2px solid ${bc};` +
            `border-radius:4px;font-size:12px;font-weight:${fw};color:${tc}">${label}</span></td>` +
            `<td style="background:#f0f4ff;${borderR}"></td>`
          );
        })
        .join('')
    )
    .join('');

  const yearAvgs = students
    .map((s) => {
      const pairs = examFamilies.map((f) => ({
        grade: bestGradeForFamily(s, f).grade,
        weging: f.original.weging,
      }));
      return calcWeightedAvg(pairs);
    })
    .filter((g) => g !== null);
  const yearAvgOfAvgs =
    yearAvgs.length > 0 ? yearAvgs.reduce((a, b) => a + b, 0) / yearAvgs.length : null;

  const seAvgs = students.map((s) => dossierAvgMap[s.id]).filter((g) => g !== null);
  const seAvgOfAvgs = seAvgs.length > 0 ? seAvgs.reduce((a, b) => a + b, 0) / seAvgs.length : null;

  const avgRowSummary =
    `<td style="text-align:center;padding:3px 4px;background:#f0f4ff;border-left:2px solid var(--border)">${
      yearAvgOfAvgs !== null
        ? `<span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${gradeBorderColor(yearAvgOfAvgs)};` +
          `border-radius:4px;font-size:12px;font-weight:${yearAvgOfAvgs < 5.5 ? 'bold' : '500'};color:${gradeTextColor(yearAvgOfAvgs)}">${formatGrade(yearAvgOfAvgs)}</span>`
        : `<span style="color:#aaa">—</span>`
    }</td>` +
    `<td style="text-align:center;padding:3px 4px;background:#f0f4ff">${
      seAvgOfAvgs !== null
        ? `<span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${gradeBorderColor(seAvgOfAvgs)};` +
          `border-radius:4px;font-size:12px;font-weight:${seAvgOfAvgs < 5.5 ? 'bold' : '500'};color:${gradeTextColor(seAvgOfAvgs)}">${formatGrade(seAvgOfAvgs)}</span>`
        : `<span style="color:#aaa">—</span>`
    }</td>`;

  const avgRow =
    `<tr style="border-top:2px solid var(--border)">` +
    `<td style="padding:5px 12px 5px 4px;white-space:nowrap;background:#f0f4ff;font-size:11px;` +
    `font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">Gemiddelde</td>` +
    avgRowExamCells +
    avgRowSummary +
    `</tr>`;

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
        <tfoot>${avgRow}</tfoot>
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
