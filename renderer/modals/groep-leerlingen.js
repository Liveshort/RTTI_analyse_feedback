// ── Group students modal ──────────────────────────────────────────────────────
import {
  showModal,
  closeModal,
  escHtml,
  formatGrade,
  onModalSync,
  showReloadNotice,
  changedByName,
  modalRefresher,
} from '../app.js';
import { lerpColor, examTypeColor } from '../utils/colors.js';
import { gradeTextColor, gradeBorderColor } from '../utils/grades.js';
import { openProfielModal } from './profiel.js';

// The version of one student in a students-file change (before, after), as JSON.
function studentVersions(ev, id) {
  const find = (list) => JSON.stringify((list ?? []).find((s) => s.id === id) ?? null);
  return [find(ev.before), find(ev.after)];
}

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
      // Background changes: new scores and exam edits refresh this overview
      // silently; changes to the group or its students need a notice.
      const reopen = () => openGroupStudentsModal(groupId, year);
      const refresh = modalRefresher(reopen);
      onModalSync('scores', (ev) => {
        if (ev.year !== year || ev.subject !== Store.getActiveSubject()) return;
        if (group.student_ids.some((id) => String(id) === ev.id)) refresh();
      });
      onModalSync('exam', (ev) => {
        if (ev.year === year) refresh();
      });
      onModalSync('group', async (ev) => {
        if (ev.id !== groupId || ev.year !== year) return;
        const who = await changedByName(ev);
        if (!ev.after) showReloadNotice(`Deze groep is verwijderd door ${who}.`, closeModal);
        else {
          showReloadNotice(
            `Deze groep is gewijzigd door ${who}. Het venster wordt opnieuw geladen.`,
            reopen
          );
        }
      });
      onModalSync('students', (ev) => {
        if (ev.year !== year) return;
        const changed = group.student_ids.some((id) => {
          const [before, after] = studentVersions(ev, id);
          return before !== after;
        });
        if (!changed) return;
        showReloadNotice(
          'Leerlinggegevens zijn gewijzigd door een collega. Het venster wordt opnieuw geladen.',
          reopen
        );
      });

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
