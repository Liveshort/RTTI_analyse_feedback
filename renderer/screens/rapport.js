import { SEL, toast } from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Rapport genereren
// ═══════════════════════════════════════════════════════════════════════════════

let _allExams = [];

export async function renderRapport() {
  const cfg = Store.getConfigSync();
  const year = cfg.activeYear;

  _allExams = [];
  SEL.rapportJaarlaag.setOptions([]);
  SEL.rapportExam.setOptions([]);
  SEL.rapportExam.setDisabled(true);
  document.getElementById('rapport-content').innerHTML =
    '<p class="hint">Selecteer een jaarlaag en een toets.</p>';

  if (!year) return;

  _allExams = await window.rtti.readAllJson(`${year}/exams`);

  const jaarlagen = [
    ...new Set(_allExams.map((e) => String(e.jaarlaag ?? '')).filter(Boolean)),
  ].sort((a, b) => Number(a) - Number(b));

  SEL.rapportJaarlaag.setOptions(jaarlagen.map((j) => ({ value: j, label: `Klas ${j}` })));
}

export function updateRapportExamsByJaarlaag(jaarlaag) {
  const subject = Store.getActiveSubject();
  const filtered = _allExams.filter(
    (e) => String(e.jaarlaag ?? '') === String(jaarlaag) && (!subject || e.subject === subject)
  );
  SEL.rapportExam.setOptions([
    { value: '', label: '— kies toets —' },
    ...filtered.map((e) => ({
      value: e.id,
      label: (e.volgnummer ? e.volgnummer + ' \u2013 ' : '') + e.title,
    })),
  ]);
  SEL.rapportExam.setDisabled(false);
  document.getElementById('rapport-content').innerHTML = '<p class="hint">Selecteer een toets.</p>';
}

// ── Lollipop data helpers ──────────────────────────────────────────────────────

const RTTI_COLORS = { R: '#5cb85c', T1: '#5bc0de', T2: '#f0ad4e', I: '#d9534f' };

function lerpHex(hex1, hex2, t) {
  const h = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = h(hex1),
    [r2, g2, b2] = h(hex2);
  return (
    '#' +
    [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

function scoreDotColor(score, max) {
  if (score === null) return '#b0b8c1'; // grey — not entered
  if (score <= 0) return '#e57373'; // red — zero
  if (score >= max) return '#66bb6a'; // green — full marks
  const t = score / max;
  return t <= 0.5
    ? lerpHex('#e57373', '#ffd54f', t * 2)
    : lerpHex('#ffd54f', '#66bb6a', (t - 0.5) * 2);
}

/**
 * Build the per-question data array for one student.
 * allQuestionScores: array of questionScores objects for ALL participants,
 * used to compute class averages.
 */
function assembleVragen(exam, questionScores, allQuestionScores) {
  return exam.questions.map((q) => {
    const raw = questionScores?.[q.id];
    const notEntered = raw === undefined || raw === null || String(raw).toUpperCase() === 'N';
    const score = notEntered ? null : Math.max(0, Number(raw));

    // Class average for this question across all participants
    let sum = 0,
      count = 0;
    for (const qs of allQuestionScores) {
      const v = qs[q.id];
      if (v === undefined || v === null || String(v).toUpperCase() === 'N') continue;
      const n = Number(v);
      if (!isNaN(n)) {
        sum += n;
        count++;
      }
    }
    const classAvg = count > 0 ? parseFloat((sum / count).toFixed(1)) : 0;
    const classPct = q.max_points > 0 ? Math.round((classAvg / q.max_points) * 100) : 0;

    const label = q.section ? `${q.section}${q.number}` : String(q.number);

    return {
      label,
      rtti: q.rtti,
      rtti_color: RTTI_COLORS[q.rtti] ?? '#888888',
      score, // null if not entered
      max: q.max_points,
      class_avg: classAvg,
      class_pct: classPct,
      dot_color: scoreDotColor(score, q.max_points),
    };
  });
}

// ── Main generate function ─────────────────────────────────────────────────────

export async function generateRapport(examId) {
  const content = document.getElementById('rapport-content');

  // A — spinner
  content.innerHTML = '<div class="rapport-spinner">Rapport wordt gegenereerd\u2026</div>';

  // B — disable selectors while compiling
  SEL.rapportJaarlaag.setDisabled(true);
  SEL.rapportExam.setDisabled(true);

  const cfg = Store.getConfigSync();
  const year = cfg.activeYear;
  const exam = _allExams.find((e) => e.id === examId);
  const subject = exam?.subject;

  // Ensure students, groups, and scores are loaded for this subject
  await Store.loadYear(year, subject);
  await Store.preloadScores(year, subject);

  const allStudents = Store.getStudentsSync(year);
  const groups = Store.getGroupsSync(year, subject);

  // Filter to the exam's jaarlaag
  const inJaarlaag = exam?.jaarlaag
    ? allStudents.filter((s) => Store.jaarlaagFromStamklas(s.stamklas) === String(exam.jaarlaag))
    : allStudents;

  // Build an entry for each student who has at least one score entered
  const entries = (
    await Promise.all(
      inJaarlaag.map(async (s) => {
        const rec = await Store.getStudentScores(s.id, year, subject);
        const questionScores = rec?.scores?.[examId];
        if (!questionScores) return null;
        const hasEntry = Object.values(questionScores).some((v) => v !== null && v !== undefined);
        if (!hasEntry) return null;
        const { scored, examMaxTotal, grade } = Store.calcResults(exam, questionScores);
        const group = groups.find((g) => g.student_ids.includes(s.id));
        return { student: s, group, scored, examMaxTotal, grade, questionScores };
      })
    )
  ).filter(Boolean);

  // Sort: group name first, then achternaam
  entries.sort((a, b) => {
    const gCmp = (a.group?.name ?? '').localeCompare(b.group?.name ?? '', 'nl');
    if (gCmp !== 0) return gCmp;
    return (a.student.achternaam ?? '').localeCompare(b.student.achternaam ?? '', 'nl');
  });

  // Pre-compute class averages once using all participants' question scores
  const allQuestionScores = entries.map((e) => e.questionScores);
  const globalMax = exam?.questions?.length
    ? Math.max(...exam.questions.map((q) => q.max_points))
    : 1;

  const studentData = entries.map((e) => ({
    name: Store.fullName(e.student),
    student_nr: String(e.student.id),
    group: e.group?.name ?? '\u2014',
    score: e.scored,
    max_score: e.examMaxTotal,
    grade:
      e.grade !== null ? (Math.round(e.grade * 10) / 10).toFixed(1).replace('.', ',') : '\u2014',
    vragen: assembleVragen(exam, e.questionScores, allQuestionScores),
  }));

  const examInfo = {
    name: exam?.title ?? '',
    global_max_points: globalMax,
    n_term: exam?.n_term ?? 1,
  };

  let result;
  try {
    result = await window.rtti.renderRapportPdf(examId, studentData, examInfo);
  } finally {
    SEL.rapportJaarlaag.setDisabled(false);
    SEL.rapportExam.setDisabled(false);
  }

  if (!result.success) {
    content.innerHTML = `<p class="hint" style="color:var(--danger)">Compilatiefout: ${result.error}</p>`;
    // D — error toast
    toast('Compilatiefout bij het genereren van het rapport.', 'error');
    return;
  }

  // Convert Windows backslashes and build a file:// URL
  const pdfUrl = 'file:///' + result.pdfPath.replace(/\\/g, '/');
  content.innerHTML = `<iframe class="rapport-pdf-frame" src="${pdfUrl}"></iframe>`;

  // D — success toast
  toast('Rapport gegenereerd.', 'success');
}
