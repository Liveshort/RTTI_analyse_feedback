import {
  lerpColor,
  gradeColor,
  stdDevGradeColor,
  rttiPctColor,
  examTypeColor,
} from '../utils/colors.js';
import { wireSpinners, spinnerValue } from '../utils/spinners.js';
import {
  showModal,
  closeModal,
  toast,
  persistentError,
  escHtml,
  formatGrade,
  onModalSync,
  showReloadNotice,
  changedByName,
  onModalCleanup,
} from '../app.js';
import * as Presence from '../presence.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Scores invoeren
// Col layout (TOFF = O > 0 ? O + 1 : 0):
//   0..1        = id, naam
//   2..N+1      = question scores
//   N+2         = spacer1
//   N+3..N+2+O  = obs checkboxes (only when O > 0)
//   N+3+O       = spacer2 (only when O > 0)
//   N+3+TOFF    = Totaal
//   N+4+TOFF    = Cijfer
//   N+5+TOFF    = spacer3
//   N+6+TOFF    = R%
//   N+7+TOFF    = T1%
//   N+8+TOFF    = T2%
//   N+9+TOFF    = I%
// When O=0, TOFF=0 and layout matches the simpler variant without obs cols.
// ═══════════════════════════════════════════════════════════════════════════════

let activeExam = null;
let activeObs = []; // observaties applicable to current exam jaarlaag
let activeGridData = [];
let hotInstances = [];
let scoreHistory = []; // undo stack
let redoHistory = []; // redo stack
let undoKeydownHandler = null;
let undoBtnEl = null;
let redoBtnEl = null;
const MAX_HISTORY = 50;

// ── Background changes (other teachers) ──────────────────────────────────────
// One updater per group grid: (studentId, scoreRecord) => applies that record.
let rowUpdaters = [];
// Groups, students and observaties shown in the open modal; when a background
// change alters this, the modal has to be reloaded.
let activeRoster = null;
// Cells with a save in flight ("studentId:col" -> count). Background updates
// skip these, so a slightly older file on disk never overwrites fresh input.
const pendingSaves = new Map();
const REMOTE_FLASH_MS = 2000;
const REMOTE_FLASH_COLOR = '#f5a623';
// Outline color for cells changed by a colleague: the color of the colleague
// in this modal who edited most recently (set by renderPresence).
let remoteFlashColor = REMOTE_FLASH_COLOR;
// One per group grid: (cursors) => draws colleagues' positions in that grid.
let cursorUpdaters = [];

async function waitForPendingSaves(timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (pendingSaves.size > 0 && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

function changedInBackground(action) {
  toast(`Niet ${action}: deze score is intussen door een collega gewijzigd.`, 'info');
  return false;
}

function updateUndoRedoBtns() {
  if (undoBtnEl) undoBtnEl.disabled = scoreHistory.length === 0;
  if (redoBtnEl) redoBtnEl.disabled = redoHistory.length === 0;
}

function pushHistory(entry) {
  scoreHistory.push(entry);
  if (scoreHistory.length > MAX_HISTORY) scoreHistory.shift();
  redoHistory = []; // a new action clears the redo stack
  updateUndoRedoBtns();
}

async function undoLast() {
  if (scoreHistory.length === 0) return;
  const entry = scoreHistory.pop();
  redoHistory.push(entry);
  // An entry returns false when the cell was changed by someone else since;
  // it is then dropped instead of overwriting their value.
  if ((await entry.undo()) === false) redoHistory.pop();
  updateUndoRedoBtns();
}

async function redoLast() {
  if (redoHistory.length === 0) return;
  const entry = redoHistory.pop();
  scoreHistory.push(entry);
  if ((await entry.redo()) === false) scoreHistory.pop();
  updateUndoRedoBtns();
}

export function destroyHotInstances() {
  hotInstances.forEach((h) => {
    try {
      h.destroy();
    } catch (_) {}
  });
  hotInstances = [];
  rowUpdaters = [];
  cursorUpdaters = [];
  activeRoster = null;
  activeGridData = [];
  activeExam = null;
  activeObs = [];
  scoreHistory = [];
  redoHistory = [];
  undoBtnEl = null;
  redoBtnEl = null;
  if (undoKeydownHandler) {
    document.removeEventListener('keydown', undoKeydownHandler);
    undoKeydownHandler = null;
  }
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
        <div id="sc-presence" class="presence-badges"></div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <button class="btn-secondary" id="sc-undo" title="Ongedaan maken (Ctrl+Z)" style="width:32px;height:32px;padding:0;font-size:16px;">&#x21B6;</button>
        <button class="btn-secondary" id="sc-redo" title="Opnieuw (Ctrl+Y)" style="width:32px;height:32px;padding:0;font-size:16px;">&#x21B7;</button>
        <button class="btn-secondary" id="sc-help" disabled
          title="Navigeer sneller door gebruik te maken van de numpad:&#10;0-9: Punten invullen&#10;Punt (.): N invullen&#10;Enter: Bevestigen &amp; volgende veld&#10;/ of *: Vorige / volgende veld&#10;- of +: Vorige / volgende leerling"
          style="cursor:default;color:#9aa0ab;border-color:#d0d6df;">Help ?</button>
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
        await Store.setExamNTerm(activeExam.id, val, year);
        recomputeAllRows();
      };
      ntermSp
        .querySelectorAll('.spin-btn')
        .forEach((b) => b.addEventListener('click', () => setTimeout(handleNtermChange, 0)));
      ntermSp.querySelector('.spin-val').addEventListener('change', handleNtermChange);

      undoBtnEl = el.querySelector('#sc-undo');
      redoBtnEl = el.querySelector('#sc-redo');
      undoBtnEl.addEventListener('click', () => undoLast());
      redoBtnEl.addEventListener('click', () => redoLast());

      undoKeydownHandler = (e) => {
        if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
          e.preventDefault();
          undoLast();
        }
        if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
          e.preventDefault();
          redoLast();
        }
      };
      document.addEventListener('keydown', undoKeydownHandler);

      el.querySelector('#sc-edit-exam').addEventListener('click', () => {
        closeModal();
        deps.openExamModal(examId, async () => {
          deps.renderToetsenList();
          openScoreModal(examId, year, deps);
        });
      });

      // ── Presence: tell colleagues we're here, show who else is ─────────────
      Presence.setScoreModal({ year, subject: Store.getActiveSubject(), examId });
      onModalCleanup(() => Presence.setScoreModal(null));
      onModalCleanup(Presence.onChange(() => renderPresence(el, examId, year)));

      // ── Changes made by other teachers while this modal is open ────────────
      onModalSync('scores', (ev) => {
        if (ev.year !== year || ev.subject !== Store.getActiveSubject()) return;
        if (ev.after === null && ev.kind !== 'deleted') return; // not loaded here
        rowUpdaters.forEach((apply) => apply(ev.id, ev.after));
      });

      // An N-term change by someone else is applied in place. Any other edit
      // of this exam reloads the modal; a deleted exam closes it.
      onModalSync('exam', async (ev) => {
        if (ev.id !== examId || ev.year !== year || !activeExam) return;
        if (!ev.after) {
          showReloadNotice(
            `Toets ${activeExam.title} is verwijderd door een collega. Het scorescherm wordt gesloten.`,
            closeModal
          );
          return;
        }
        if (!onlyNTermDiffers(activeExam, ev.after)) {
          const who = await changedByName(ev);
          showReloadNotice(
            `Toets ${ev.after.title} is gewijzigd door ${who}. Het scorescherm wordt opnieuw geladen.`,
            () => reloadScoreModal(examId, year, deps)
          );
          return;
        }
        const input = ntermSp.querySelector('.spin-val');
        if (document.activeElement === input) return; // the user's own input wins
        const val = ev.after.n_term ?? 1;
        if (val === activeExam.n_term) return;
        activeExam.n_term = val;
        ntermSp.dataset.val = val;
        input.value = String(val).replace('.', ',');
        recomputeAllRows();
        input.style.transition = 'none';
        input.style.background = REMOTE_FLASH_COLOR;
        setTimeout(() => {
          input.style.transition = 'background 0.6s';
          input.style.background = '';
        }, REMOTE_FLASH_MS);
      });

      // Groups, students or observaties shown in this modal changed: reload it.
      const NOTICE_SUBJECT = {
        group: 'Groepsgegevens',
        students: 'Leerlinggegevens',
        observatie: 'Observaties',
      };
      for (const type of Object.keys(NOTICE_SUBJECT)) {
        onModalSync(type, async (ev) => {
          if (ev.year && ev.year !== year) return;
          if (!activeExam || rosterSignature(activeExam, year) === activeRoster) return;
          const who = await changedByName(ev);
          showReloadNotice(
            `${NOTICE_SUBJECT[type]} zijn gewijzigd door ${who}. Het scorescherm wordt opnieuw geladen.`,
            () => reloadScoreModal(examId, year, deps)
          );
        });
      }

      await loadScoreGrid(
        String(exam.jaarlaag),
        examId,
        el.querySelector('#sc-grid-container'),
        year
      );
      renderPresence(el, examId, year);
    },
    'modal-scores',
    deps?.renderToetsenList
  );
}

// Badges of colleagues in this score modal (green: entered scores in the last
// 2 minutes, orange: only has it open) and their cursor positions in the grids.
async function renderPresence(el, examId, year) {
  const host = el.querySelector('#sc-presence');
  if (!host) return;
  const users = await Store.loadUsers();
  const others = Presence.inScoreModal(year, Store.getActiveSubject(), examId)
    .map((o) => ({ ...o, user: users.find((u) => u.id === o.userId) }))
    .filter((o) => o.user);
  host.innerHTML = others
    .map((o) => {
      const name = Store.fullName(o.user);
      const what =
        o.status === 'active'
          ? 'heeft de afgelopen 2 minuten scores ingevoerd'
          : 'heeft dit scorescherm open';
      return Presence.badgeHtml(o.user, o.status, `${name} ${what}`);
    })
    .join('');
  const active = others.find((o) => o.status === 'active');
  remoteFlashColor = active?.user.kleur ?? REMOTE_FLASH_COLOR;
  const cursors = others
    .filter((o) => o.scoreModal.cell)
    .map((o) => ({
      ...o.scoreModal.cell,
      color: o.user.kleur ?? '#888',
      name: o.user.voornaam || o.user.afkorting || '?',
    }));
  cursorUpdaters.forEach((draw) => draw(cursors));
}

// Recalculate totals, grades and summary rows of every group (e.g. after an N-term change).
function recomputeAllRows() {
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
}

// JSON with sorted keys, so two versions of an object compare regardless of key order.
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

// True when two versions of an exam differ only in their N-term (and version info).
function onlyNTermDiffers(a, b) {
  const strip = ({ n_term: _n, _meta: _m, ...rest }) => rest;
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

// Groups (in display order) whose students take this exam.
function examGroups(exam, year, jaarlaag = exam.jaarlaag) {
  const examSchoolsoort = exam.schoolsoort ?? [];
  return Store.getGroupsSync(year)
    .filter((g) => {
      if (String(g.jaarlaag) !== String(jaarlaag)) return false;
      if (examSchoolsoort.length === 0) return true;
      return (g.schoolsoort ?? []).some((ss) => examSchoolsoort.includes(ss));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function groupStudentsOf(group, allStudents) {
  return allStudents
    .filter((s) => group.student_ids.includes(s.id))
    .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));
}

// Everything about the modal's layout that comes from groups, students and observaties.
function rosterSignature(exam, year) {
  const allStudents = Store.getStudentsSync(year);
  const allObs = Store.getObservatiesSync();
  return stableStringify({
    groups: examGroups(exam, year).map((g) => [
      g.id,
      g.name,
      groupStudentsOf(g, allStudents).map((s) => [s.id, Store.fullName(s)]),
    ]),
    obs: (exam.obs_ids ?? []).map((id) => {
      const o = allObs.find((x) => x.id === id);
      return o ? [o.id, o.naam, o.icon] : null;
    }),
  });
}

// Close and reopen the score modal after committing any open cell editor.
async function reloadScoreModal(examId, year, deps) {
  hotInstances.forEach((h) => {
    const editor = h.getActiveEditor();
    if (editor?.isOpened?.()) editor.finishEditing();
  });
  await waitForPendingSaves();
  closeModal();
  if (Store.getExamsSync(year).some((e) => e.id === examId)) openScoreModal(examId, year, deps);
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
  activeRoster = rosterSignature(exam, year);

  const groups = examGroups(exam, year, jaarlaag);
  const allStudents = Store.getStudentsSync(year);

  if (groups.length === 0) {
    container.innerHTML = '<p class="hint">Geen groepen gevonden. Voeg eerst groepen toe.</p>';
    return;
  }

  container.innerHTML = '';

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const groupStudents = groupStudentsOf(group, allStudents);
    if (groupStudents.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'score-group-section';
    section.innerHTML = `<h3 class="group-heading">${escHtml(group.name)}</h3><div id="hot-g${gi}"></div>`;
    container.appendChild(section);

    // Row: [id, naam, ...N scores, spacer1, ...O obs, spacer2?, Totaal, Cijfer, spacer3, R%, T1%, T2%, I%]
    const N = exam.questions.length;
    const gridData = [];
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
      // spacer1 (N+2)
      row.push('');
      // obs cols (N+3..N+2+O) and spacer2 (N+3+O) — only when O > 0
      if (activeObs.length > 0) {
        activeObs.forEach((o) => row.push(examObsIds.includes(o.id)));
        row.push(''); // spacer2
      }
      // Totaal, Cijfer, spacer3, R%, T1%, T2%, I%
      row.push('', '', '', '', '', '', '');
      gridData.push(row);
    }

    // Summary rows: avg (sentinel __avg__) then std dev (sentinel __std__)
    const O = activeObs.length;
    const obsInsert = O > 0 ? [...Array(O).fill(''), ''] : [];
    const trailCells = ['', ...obsInsert, '', '', '', '', '', '', ''];
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
 * Col layout (N = questions, O = applicable obs, TOFF = O > 0 ? O + 1 : 0):
 *   0..1        = id, naam
 *   2..N+1      = question scores
 *   N+2         = spacer1
 *   N+3..N+2+O  = obs checkboxes (if O > 0)
 *   N+3+O       = spacer2 (if O > 0)
 *   N+3+TOFF    = Totaal
 *   N+4+TOFF    = Cijfer
 *   N+5+TOFF    = spacer3
 *   N+6+TOFF    = R%
 *   N+7+TOFF    = T1%
 *   N+8+TOFF    = T2%
 *   N+9+TOFF    = I%
 */
export function recomputeRow(gridData, exam, rowIdx, O = 0) {
  const N = exam.questions.length;
  const TOFF = O > 0 ? O + 1 : 0;
  const row = gridData[rowIdx];

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
    row[N + 2] = ''; // spacer1
    if (O > 0) row[N + 3 + O] = ''; // spacer2
    row[N + 3 + TOFF] = '';
    row[N + 4 + TOFF] = '';
    row[N + 5 + TOFF] = '';
    row[N + 6 + TOFF] = '';
    row[N + 7 + TOFF] = '';
    row[N + 8 + TOFF] = '';
    row[N + 9 + TOFF] = '';
    return;
  }

  const res = Store.calcResults(exam, questionScores);
  row[N + 2] = ''; // spacer1
  if (O > 0) row[N + 3 + O] = ''; // spacer2 — obs cols untouched
  row[N + 3 + TOFF] =
    res.hasBonus && res.scored > res.normalMax
      ? `${res.scored} / ${res.normalMax} (+)`
      : `${res.scored} / ${res.normalMax}`;
  row[N + 4 + TOFF] = res.grade !== null ? formatGrade(res.grade) : '';
  row[N + 5 + TOFF] = ''; // spacer3
  row[N + 6 + TOFF] = res.R === 'NVT' ? 'NVT' : res.R + '%';
  row[N + 7 + TOFF] = res.T1 === 'NVT' ? 'NVT' : res.T1 + '%';
  row[N + 8 + TOFF] = res.T2 === 'NVT' ? 'NVT' : res.T2 + '%';
  row[N + 9 + TOFF] = res.I === 'NVT' ? 'NVT' : res.I + '%';
}

export function recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, O = 0) {
  const N = exam.questions.length;
  const TOFF = O > 0 ? O + 1 : 0;
  const examMaxTotal = exam.questions.reduce((s, q) => s + q.max_points, 0);
  const totaals = [],
    grades = [];

  for (let r = 0; r < summaryIdx; r++) {
    const totaalStr = gridData[r][N + 3 + TOFF];
    const gradeStr = gridData[r][N + 4 + TOFF];
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
    row[N + 2] = ''; // spacer1
    if (O > 0) {
      for (let i = 0; i < O; i++) row[N + 3 + i] = '';
      row[N + 3 + O] = ''; // spacer2
    }
    row[N + 3 + TOFF] = '';
    row[N + 4 + TOFF] = '';
    row[N + 5 + TOFF] = '';
    row[N + 6 + TOFF] = '';
    row[N + 7 + TOFF] = '';
    row[N + 8 + TOFF] = '';
    row[N + 9 + TOFF] = '';
  }

  // Avg row
  const avgRow = gridData[summaryIdx];
  const meanTotaal =
    totaals.length > 0 ? totaals.reduce((a, b) => a + b, 0) / totaals.length : null;
  const meanGrade = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
  clearSpecialRow(avgRow);
  avgRow[N + 3 + TOFF] =
    meanTotaal !== null ? meanTotaal.toFixed(1).replace('.', ',') + ' / ' + examMaxTotal : '';
  avgRow[N + 4 + TOFF] = meanGrade !== null ? meanGrade.toFixed(1).replace('.', ',') : '';

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
  sdRow[N + 3 + TOFF] = sdTotaal !== null ? sdTotaal.toFixed(1).replace('.', ',') : '';
  sdRow[N + 4 + TOFF] = sdGrade !== null ? sdGrade.toFixed(1).replace('.', ',') : '';
}

/**
 * How typed input is shown in the grid (`cell`) and stored (`value`):
 * empty → removed, N → null (not evaluated), valid number → number,
 * anything else → kept as typed so it can be corrected.
 */
function normalizeScore(input, q) {
  const raw = String(input ?? '').trim();
  if (raw === '') return { cell: '', value: undefined };
  if (raw.toUpperCase() === 'N') return { cell: 'N', value: null };
  const num = Number(raw);
  if (isNaN(num) || num < 0 || num > q.max_points) return { cell: raw, value: raw };
  return { cell: String(num), value: num };
}

export function createGroupHOT(container, exam, students, gridData, year, obsArr = []) {
  const N = exam.questions.length;
  const summaryIdx = gridData.findIndex((r) => r[0] === '__avg__');
  const stdIdx = gridData.findIndex((r) => r[0] === '__std__');
  const O = obsArr.length;
  // ── Navigation constants ──────────────────────────────────────────────────
  const firstQCol = 2;
  const lastQCol = N + 1;
  const obsStart = N + 3; // first obs col (only valid when O > 0)
  const firstObsCol = obsStart;
  const lastObsCol = O > 0 ? obsStart + O - 1 : -1;
  const firstDataRow = 0;
  const lastDataRow = summaryIdx - 1;

  const editableCols = [
    ...Array.from({ length: N }, (_, i) => 2 + i),
    ...(O > 0 ? Array.from({ length: O }, (_, i) => obsStart + i) : []),
  ];

  function isQCol(col) {
    return col >= firstQCol && col <= lastQCol;
  }
  function isObsCol(col) {
    return O > 0 && col >= firstObsCol && col <= lastObsCol;
  }
  // Returns the first empty question col, or null if all are filled.
  function firstEmptyQ(row) {
    for (let c = firstQCol; c <= lastQCol; c++) {
      const v = gridData[row][c];
      if (v === '' || v === undefined || v === null) return c;
    }
    return null;
  }
  function goTo(row, col) {
    if (row < firstDataRow || row > lastDataRow) return;
    if (col < 0) return;
    hot.selectCell(row, col);
  }

  // ── Selected cell tracking (per HOT instance) ─────────────────────────────
  let selectedCell = { row: -1, col: -1 };

  // ── Saving & background changes ───────────────────────────────────────────
  // Every save goes through saveCell, so background updates can leave cells
  // with a save in flight alone (see pendingSaves).
  async function saveCell(row, col, write) {
    const key = `${students[row].id}:${col}`;
    pendingSaves.set(key, (pendingSaves.get(key) ?? 0) + 1);
    Presence.markEdit();
    try {
      await write();
    } finally {
      const n = pendingSaves.get(key) - 1;
      if (n > 0) pendingSaves.set(key, n);
      else pendingSaves.delete(key);
    }
  }

  // Cells recently changed by someone else ("row:col" -> time the flash ends).
  const flashUntil = new Map();

  // Apply a score file saved by another teacher to this student's row.
  function applyRemoteRecord(studentId, rec) {
    const row = students.findIndex((st) => String(st.id) === String(studentId));
    if (row < 0 || hot.isDestroyed) return;
    const examScores = rec?.scores?.[exam.id] ?? {};
    const obsIds = rec?.observations?.[exam.id] ?? [];
    const editor = hot.getActiveEditor();
    const editing = editor?.isOpened?.() ? { row: editor.row, col: editor.col } : null;
    let changed = false;
    const setCell = (col, value) => {
      if (gridData[row][col] === value) return;
      if (editing && editing.row === row && editing.col === col) return;
      if (pendingSaves.has(`${students[row].id}:${col}`)) return;
      gridData[row][col] = value;
      flashUntil.set(`${row}:${col}`, Date.now() + REMOTE_FLASH_MS);
      changed = true;
    };
    exam.questions.forEach((q, qi) => {
      const v = examScores[q.id];
      setCell(2 + qi, v === undefined ? '' : v === null ? 'N' : String(v));
    });
    obsArr.forEach((o, oi) => setCell(obsStart + oi, obsIds.includes(o.id)));
    if (!changed) return;
    rowStatus[row] = computeRowStatus(row);
    recomputeRow(gridData, exam, row, O);
    recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, O);
    hot.render();
    setTimeout(() => {
      if (!hot.isDestroyed) hot.render();
    }, REMOTE_FLASH_MS + 50);
  }
  rowUpdaters.push(applyRemoteRecord);

  // ── Colleagues' cursors ───────────────────────────────────────────────────
  // Drawn as an overlay (thick colored border + name flag) on the group's
  // section, because table cells clip their content.
  let remoteCursors = [];
  const layer = container.parentElement;
  layer.style.position = 'relative';

  function cellOf({ studentId, questionId }) {
    const row = students.findIndex((st) => String(st.id) === String(studentId));
    if (row < 0) return null;
    if (String(questionId).startsWith('obs:')) {
      const oi = obsArr.findIndex((o) => `obs:${o.id}` === questionId);
      return oi < 0 ? null : { row, col: obsStart + oi };
    }
    const qi = exam.questions.findIndex((q) => q.id === questionId);
    return qi < 0 ? null : { row, col: 2 + qi };
  }

  function drawCursors() {
    layer.querySelectorAll(':scope > .remote-cursor').forEach((n) => n.remove());
    if (hot.isDestroyed) return;
    const base = layer.getBoundingClientRect();
    for (const cursor of remoteCursors) {
      const cell = cellOf(cursor);
      const td = cell && hot.getCell(cell.row, cell.col);
      if (!td) continue;
      const r = td.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'remote-cursor';
      box.style.cssText =
        `left:${r.left - base.left}px;top:${r.top - base.top}px;` +
        `width:${r.width}px;height:${r.height}px;--cursor-color:${cursor.color}`;
      box.innerHTML = `<span class="remote-cursor-flag">${escHtml(cursor.name)}</span>`;
      layer.appendChild(box);
    }
  }

  cursorUpdaters.push((cursors) => {
    remoteCursors = cursors;
    drawCursors();
  });

  // Question headers: RTTI (top) → pts → section → number (bottom)
  const qHeaders = exam.questions.map((q) => {
    const isSpecial = qKind(q) !== 'normal';
    const tooltip =
      qKind(q) === 'bonus' ? 'Bonusvraag' : qKind(q) === 'diag' ? 'Diagnostische vraag' : '';
    if (isSpecial) {
      return (
        `<span style="color:#9aa0ab;font-style:italic" title="${tooltip}">` +
        `<span class="hdr-rtti">${escHtml(q.rtti)}</span>` +
        `<span class="hdr-pts">${q.max_points}p</span>` +
        `<span class="hdr-opgave" style="color:#9aa0ab">${escHtml(q.section)}</span>` +
        `<span class="hdr-vraag" style="color:#9aa0ab">${q.number}</span>` +
        `</span>`
      );
    }
    return (
      `<span class="hdr-rtti">${escHtml(q.rtti)}</span>` +
      `<span class="hdr-pts">${q.max_points}p</span>` +
      `<span class="hdr-opgave">${escHtml(q.section)}</span>` +
      `<span class="hdr-vraag">${q.number}</span>`
    );
  });

  const obsHeaders =
    O > 0
      ? [
          ...obsArr.map(
            (o) => `<span class="hdr-obs" title="${escHtml(o.naam)}">${escHtml(o.icon)}</span>`
          ),
          '', // spacer2 header
        ]
      : [];

  // New order: scores, spacer1, obs+spacer2, Totaal, Cijfer, spacer3, RTTI
  const colHeaders = [
    '#',
    'Naam',
    ...qHeaders,
    '', // spacer1
    ...obsHeaders,
    'Totaal',
    'Cijfer',
    '', // spacer3
    'R%',
    'T1%',
    'T2%',
    'I%',
  ];

  // ── Row validation status ─────────────────────────────────────────────────

  function computeRowStatus(rowIdx) {
    const row = gridData[rowIdx];
    if (!row || row[0] === '__avg__' || row[0] === '__std__') return 'ok';
    let filled = 0,
      invalid = false;
    for (let qi = 0; qi < exam.questions.length; qi++) {
      const q = exam.questions[qi];
      const val = row[2 + qi];
      if (val === '' || val === undefined || val === null) continue;
      filled++;
      const upper = String(val).toUpperCase().trim();
      if (upper === 'N') continue;
      const num = Number(val);
      if (isNaN(num) || num < 0 || num > q.max_points) invalid = true;
    }
    if (invalid) return 'invalid';
    if (filled > 0 && filled < exam.questions.length) return 'partial';
    return 'ok';
  }

  const rowStatus = gridData.map((_, i) => computeRowStatus(i));

  // ── Highlight helper ──────────────────────────────────────────────────────

  function applyHighlight(TD, row, col) {
    const flashEnd = flashUntil.get(`${row}:${col}`);
    const flashing = flashEnd !== undefined && flashEnd > Date.now();
    if (flashEnd !== undefined && !flashing) flashUntil.delete(`${row}:${col}`);
    TD.style.boxShadow = flashing ? `inset 0 0 0 2px ${remoteFlashColor}` : '';
    const onRow = row === selectedCell.row;
    const onCol = col === selectedCell.col;
    if (!onRow && !onCol) return;
    const alpha = onRow && onCol ? 0.16 : 0.08;
    // backgroundImage overlays on top of the background color already set
    TD.style.backgroundImage = `linear-gradient(rgba(74,144,217,${alpha}), rgba(74,144,217,${alpha}))`;
  }

  // ── Custom renderers ──────────────────────────────────────────────────────

  function idRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    const isSpecial = row === summaryIdx || row === stdIdx;
    const status = isSpecial ? null : rowStatus[row];
    TD.style.background = isSpecial
      ? '#e8ecf2'
      : status === 'invalid'
        ? '#ff0033'
        : status === 'partial'
          ? '#fff3cd'
          : '#f8f9fb';
    TD.style.color = status === 'invalid' ? '#fff' : '';
    TD.style.textAlign = 'center';
    if (isSpecial) TD.style.color = 'transparent';
    applyHighlight(TD, row, col);
  }

  function naamRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    const isSpecial = row === summaryIdx || row === stdIdx;
    const status = isSpecial ? null : rowStatus[row];
    TD.style.background = isSpecial
      ? '#e8ecf2'
      : status === 'invalid'
        ? '#ff0033'
        : status === 'partial'
          ? '#fff3cd'
          : '#f8f9fb';
    TD.style.color = status === 'invalid' ? '#fff' : isSpecial ? 'var(--muted, #7f8c8d)' : '#000';
    TD.style.fontWeight = isSpecial ? '700' : '400';
    TD.style.fontStyle = isSpecial ? 'italic' : 'normal';
    applyHighlight(TD, row, col);
  }

  function calcCentered(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign = 'center';
    TD.style.background = row === summaryIdx || row === stdIdx ? '#dde4f0' : '#eef2f7';
    TD.style.fontWeight = '600';
    applyHighlight(TD, row, col);
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
    applyHighlight(TD, row, col);
  }

  function rttiRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign = 'center';
    TD.style.fontWeight = '500';
    TD.style.background = row === summaryIdx ? '#e8ecf2' : rttiPctColor(value) || '#eef2f7';
    applyHighlight(TD, row, col);
  }

  function scoreRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign = 'center';
    TD.style.fontStyle = 'normal'; // reset in case HOT reuses the TD
    if (row === summaryIdx || row === stdIdx) {
      TD.style.background = '#e8ecf2';
      applyHighlight(TD, row, col);
      return;
    }
    const q = exam.questions[col - 2];
    const kind = q ? qKind(q) : 'normal';

    // Bonus: always blue; Diag: always gray — regardless of value
    if (kind === 'bonus') {
      TD.style.background = '#cce5ff';
      TD.style.fontStyle = 'italic';
    } else if (kind === 'diag') {
      TD.style.background = '#d0d6df';
      TD.style.fontStyle = 'italic';
    }

    if (!value) {
      applyHighlight(TD, row, col);
      return;
    }
    if (!q) {
      applyHighlight(TD, row, col);
      return;
    }

    const upper = String(value).toUpperCase().trim();
    if (upper === 'N') {
      TD.style.background = '#d0d6df';
      TD.style.color = '#4a5568';
      TD.style.fontWeight = '600';
      applyHighlight(TD, row, col);
      return;
    }

    const num = Number(value);
    if (isNaN(num) || num < 0 || num > q.max_points) {
      TD.style.background = '#ff0033';
      TD.style.color = '#fff';
      TD.style.fontWeight = '700';
      applyHighlight(TD, row, col);
      return;
    }

    // Normal questions: apply value-based colors
    if (kind === 'normal') {
      if (value === '0') {
        TD.style.background = '#f8d7da';
      } else if (num === q.max_points) {
        TD.style.background = '#d4edda';
      } else {
        TD.style.background = '#fff3cd';
      }
    }
    // Bonus/diag: keep their column background (already set above)
    applyHighlight(TD, row, col);
  }

  function obsRenderer(hot, TD, row, col, prop, value) {
    TD.innerHTML = '';
    TD.style.textAlign = 'center';
    TD.style.verticalAlign = 'middle';
    TD.style.background = row === summaryIdx || row === stdIdx ? '#e8ecf2' : '';
    if (row === summaryIdx || row === stdIdx) {
      applyHighlight(TD, row, col);
      return;
    }
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = value === true;
    cb.style.cssText = 'cursor:pointer;width:14px;height:14px;margin:0';
    cb.addEventListener('mousedown', async (e) => {
      const alreadySelected = selectedCell.row === row && selectedCell.col === col;

      if (alreadySelected) {
        // Cell is already focused: let the native click/change flow handle the toggle.
        // Just stop HOT from interfering.
        e.stopPropagation();
        return;
      }

      // Cell was not yet selected: HOT's afterSelection will trigger a re-render
      // that destroys this element before click/change can fire, so we must toggle
      // manually here and prevent the native toggle from also firing.
      e.stopPropagation();
      e.preventDefault();

      const obsColStart = N + 3;
      const obsIdx = col - obsColStart;
      const obs = obsArr[obsIdx];
      const student = students[row];
      if (!obs || !student) return;

      const newChecked = !cb.checked;
      const prevVal = cb.checked;

      cb.checked = newChecked;
      gridData[row][col] = newChecked;

      pushHistory({
        undo: async () => {
          if (gridData[row][col] !== newChecked) return changedInBackground('ongedaan gemaakt');
          gridData[row][col] = prevVal;
          await saveCell(row, col, () =>
            Store.setObservation(student.id, exam.id, obs.id, prevVal, year)
          );
          hotInstances.forEach((h) => h.render());
        },
        redo: async () => {
          if (gridData[row][col] !== prevVal) return changedInBackground('opnieuw uitgevoerd');
          gridData[row][col] = newChecked;
          await saveCell(row, col, () =>
            Store.setObservation(student.id, exam.id, obs.id, newChecked, year)
          );
          hotInstances.forEach((h) => h.render());
        },
      });

      hot.selectCell(row, col); // triggers afterSelection → render
      await saveCell(row, col, () =>
        Store.setObservation(student.id, exam.id, obs.id, newChecked, year)
      );
    });
    cb.addEventListener('change', async () => {
      // Handles the case where the cell was already selected (native toggle path).
      const obsColStart = N + 3;
      const obsIdx = col - obsColStart;
      const obs = obsArr[obsIdx];
      const student = students[row];
      if (!obs || !student) return;
      const newChecked = cb.checked;
      const prevVal = !newChecked;
      gridData[row][col] = newChecked;
      pushHistory({
        undo: async () => {
          if (gridData[row][col] !== newChecked) return changedInBackground('ongedaan gemaakt');
          gridData[row][col] = prevVal;
          await saveCell(row, col, () =>
            Store.setObservation(student.id, exam.id, obs.id, prevVal, year)
          );
          hotInstances.forEach((h) => h.render());
        },
        redo: async () => {
          if (gridData[row][col] !== prevVal) return changedInBackground('opnieuw uitgevoerd');
          gridData[row][col] = newChecked;
          await saveCell(row, col, () =>
            Store.setObservation(student.id, exam.id, obs.id, newChecked, year)
          );
          hotInstances.forEach((h) => h.render());
        },
      });
      await saveCell(row, col, () =>
        Store.setObservation(student.id, exam.id, obs.id, newChecked, year)
      );
    });
    TD.appendChild(cb);
    applyHighlight(TD, row, col);
  }

  const guard = { processing: false };

  const hot = new Handsontable(container, {
    data: gridData,
    colHeaders,
    rowHeaders: false,
    height: 'auto',
    licenseKey: 'non-commercial-and-evaluation',
    // New column order: scores, spacer1, obs+spacer2, Totaal, Cijfer, spacer3, RTTI
    columns: [
      { type: 'text', readOnly: true, renderer: idRenderer, width: 72 }, // 0: #
      { type: 'text', readOnly: true, renderer: naamRenderer, width: 150 }, // 1: naam
      ...exam.questions.map(() => ({ type: 'text', renderer: scoreRenderer, width: 32 })),
      { type: 'text', readOnly: true, width: 20 }, // spacer1
      ...(O > 0
        ? [
            ...obsArr.map(() => ({ readOnly: false, renderer: obsRenderer, width: 28 })),
            { type: 'text', readOnly: true, width: 20 }, // spacer2
          ]
        : []),
      { type: 'text', readOnly: true, renderer: calcCentered, width: 72 }, // Totaal
      { type: 'text', readOnly: true, renderer: gradeRenderer, width: 52 }, // Cijfer
      { type: 'text', readOnly: true, width: 20 }, // spacer3
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
        const obsColStart = N + 3; // new layout: directly after spacer1
        if (col >= obsColStart && col < obsColStart + O) return { readOnly: false };
      }
      return { readOnly: true };
    },
    enterMoves: { row: 0, col: 0 },
    tabMoves() {
      const sel = hot.getSelected();
      if (!sel) return { row: 0, col: 1 };
      const [row, col] = sel[0];

      if (isQCol(col)) {
        if (col < lastQCol) {
          return { row: 0, col: 1 };
        } else if (O > 0) {
          // Last question → first obs
          return { row: 0, col: firstObsCol - col };
        } else {
          // Last question, no obs → first question of next student
          if (row < lastDataRow) {
            return { row: 1, col: firstQCol - col };
          } else {
            return { row: 0, col: 0 }; // last student, stop
          }
        }
      }

      if (isObsCol(col)) {
        if (col < lastObsCol) {
          return { row: 0, col: 1 };
        } else {
          // Last obs → first question of next student
          if (row < lastDataRow) {
            return { row: 1, col: firstQCol - col };
          } else {
            return { row: 0, col: 0 }; // last student, stop
          }
        }
      }

      return { row: 0, col: 1 };
    },
    afterRender() {
      // (Also runs while HOT is being constructed, before there are cursors.)
      if (remoteCursors.length) drawCursors();
    },
    afterSelection(row, col) {
      if (row < summaryIdx && students[row]) {
        if (isQCol(col)) Presence.setPosition(students[row].id, exam.questions[col - 2].id);
        else if (isObsCol(col)) {
          Presence.setPosition(students[row].id, `obs:${obsArr[col - firstObsCol].id}`);
        }
      }
      if (selectedCell.row !== row || selectedCell.col !== col) {
        selectedCell = { row, col };
        hot.render();
      }
    },
    afterGetColHeader(col, TH) {
      // Bottom-align all headers
      TH.style.verticalAlign = 'bottom';
      // Left-align Naam header
      if (col === 1) TH.style.textAlign = 'left';
      // Tint bonus/diag question headers to match cell background
      const q = exam.questions[col - 2];
      if (q) {
        const kind = qKind(q);
        if (kind === 'bonus') TH.style.background = '#cce5ff';
        else if (kind === 'diag') TH.style.background = '#d0d6df';
      }
    },
    afterBeginEditing() {
      // Handsontable bug: it sets aria-hidden on its own focused textarea.
      const ta = container.querySelector('textarea.handsontableInput');
      if (ta) ta.removeAttribute('aria-hidden');
    },
    afterChange: async (changes) => {
      if (!changes || guard.processing) return;
      guard.processing = true;
      try {
        for (const [row, col, oldVal, newVal] of changes) {
          if (row === summaryIdx || row === stdIdx) continue;
          if (col < 2 || col >= 2 + N) continue;
          const student = students[row];
          const q = exam.questions[col - 2];
          if (!student || !q) continue;

          const raw = String(newVal ?? '').trim();
          const upper = raw.toUpperCase();
          const prevRaw = oldVal;

          // Snapshot for undo/redo. Undo/redo only apply while the cell still
          // holds the value this entry left behind (a colleague may have changed it).
          const applyScore = async (str) => {
            const { cell, value } = normalizeScore(str, q);
            gridData[row][col] = cell;
            rowStatus[row] = computeRowStatus(row);
            await saveCell(row, col, () => Store.setScore(student.id, exam.id, q.id, value, year));
            recomputeRow(gridData, exam, row, activeObs.length);
            recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, activeObs.length);
            hotInstances.forEach((h) => h.render());
          };
          const entry = {
            before: normalizeScore(prevRaw, q).cell,
            after: normalizeScore(newVal, q).cell,
            undo: () =>
              gridData[row][col] === entry.after
                ? applyScore(prevRaw)
                : changedInBackground('ongedaan gemaakt'),
            redo: () =>
              gridData[row][col] === entry.before
                ? applyScore(newVal)
                : changedInBackground('opnieuw uitgevoerd'),
          };
          pushHistory(entry);

          if (raw === '') {
            gridData[row][col] = '';
            await saveCell(row, col, () =>
              Store.setScore(student.id, exam.id, q.id, undefined, year)
            );
          } else if (upper === 'N') {
            gridData[row][col] = 'N';
            await saveCell(row, col, () => Store.setScore(student.id, exam.id, q.id, null, year));
          } else {
            const num = Number(raw);
            if (isNaN(num) || num < 0 || num > q.max_points) {
              gridData[row][col] = raw;
              await saveCell(row, col, () => Store.setScore(student.id, exam.id, q.id, raw, year));
              persistentError(
                `Ongeldige score "${raw}" voor vraag ${q.section}${q.number} (max ${q.max_points}). Controleer en herstel.`
              );
            } else {
              gridData[row][col] = String(num);
              await saveCell(row, col, () => Store.setScore(student.id, exam.id, q.id, num, year));
            }
          }
          rowStatus[row] = computeRowStatus(row);
          recomputeRow(gridData, exam, row, activeObs.length);
          recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, activeObs.length);
        }
      } finally {
        guard.processing = false;
        hot.render();
      }
    },
    beforeKeyDown(event) {
      const sel = hot.getSelected();
      if (!sel) return;
      const [row, col] = sel[0];
      if (row >= summaryIdx) return;
      const isEditing = hot.getActiveEditor()?.isOpened?.() ?? false;
      // Obs cells: block all printable keypresses so HOT cannot open its editor.
      // Specific keys (0, 1, nav, Enter) are handled in the capture-phase listener
      // and never reach this hook.
      if (isObsCol(col) && !isEditing && event.key.length === 1) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
  });

  // ── Capture-phase listener ────────────────────────────────────────────────
  // Fires before HOT's own bubble-phase handlers, so we can fully intercept
  // keys that HOT would otherwise eat (Home, End, NumpadDecimal, Enter, etc.).
  container.addEventListener(
    'keydown',
    (event) => {
      const sel = hot.getSelected();
      if (!sel) return;
      const [row, col] = sel[0];
      if (row >= summaryIdx) return;
      const isEditing = hot.getActiveEditor()?.isOpened?.() ?? false;

      // ── Numpad dot → write N directly into the question cell ───────────
      if (event.code === 'NumpadDecimal' && !isEditing && isQCol(col)) {
        event.stopImmediatePropagation();
        event.preventDefault();
        hot.setDataAtCell(row, col, 'N');
        return;
      }

      // ── Enter / Numpad Enter / multiply → confirm edit + next editable cell
      if (
        event.code === 'Enter' ||
        event.code === 'NumpadEnter' ||
        event.code === 'NumpadMultiply'
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
        if (isEditing) hot.getActiveEditor().finishEditing();
        const pos = editableCols.indexOf(col);
        const isLastEditable = pos === editableCols.length - 1;
        if (!isLastEditable) {
          // Not the last editable cell: just advance right
          goTo(row, editableCols[pos + 1]);
        } else if (row < lastDataRow) {
          // Last editable cell, next student exists: first empty Q or same col
          goTo(row + 1, firstEmptyQ(row + 1) ?? col);
        }
        // Last editable cell of last student: stay
        return;
      }

      // ── Numpad divide → previous editable cell ────────────────────────────
      if (event.code === 'NumpadDivide' && !isEditing) {
        event.stopImmediatePropagation();
        event.preventDefault();
        const pos = editableCols.indexOf(col);
        if (pos > 0) goTo(row, editableCols[pos - 1]);
        return;
      }

      // ── Numpad minus → previous student (first empty Q, or same col) ─────
      if (event.code === 'NumpadSubtract' && !isEditing) {
        event.stopImmediatePropagation();
        event.preventDefault();
        const targetRow = row - 1;
        if (targetRow >= firstDataRow) {
          goTo(targetRow, firstEmptyQ(targetRow) ?? col);
        }
        return;
      }

      // ── Numpad plus → next student (first empty Q, or same col) ──────────
      if (event.code === 'NumpadAdd' && !isEditing) {
        event.stopImmediatePropagation();
        event.preventDefault();
        const targetRow = row + 1;
        if (targetRow <= lastDataRow) {
          goTo(targetRow, firstEmptyQ(targetRow) ?? col);
        }
        return;
      }

      // ── Home ──────────────────────────────────────────────────────────────
      if (event.key === 'Home' && !isEditing) {
        event.stopImmediatePropagation();
        event.preventDefault();
        if (isQCol(col)) {
          goTo(row, firstQCol);
        } else if (isObsCol(col)) {
          goTo(row, col === firstObsCol ? firstQCol : firstObsCol);
        }
        return;
      }

      // ── End ───────────────────────────────────────────────────────────────
      if (event.key === 'End' && !isEditing) {
        event.stopImmediatePropagation();
        event.preventDefault();
        if (isQCol(col)) {
          goTo(row, col === lastQCol && O > 0 ? lastObsCol : lastQCol);
        } else if (isObsCol(col)) {
          goTo(row, lastObsCol);
        }
        return;
      }

      // ── Obs cells: 0 unchecks, 1 checks; handled here to prevent edit mode
      if (isObsCol(col) && !isEditing && (event.key === '0' || event.key === '1')) {
        event.stopImmediatePropagation();
        event.preventDefault();
        const newChecked = event.key === '1';
        const obsIdx = col - firstObsCol;
        const obs = obsArr[obsIdx];
        const student = students[row];
        if (obs && student) {
          const prevVal = gridData[row][col] === true;
          gridData[row][col] = newChecked;
          pushHistory({
            undo: async () => {
              if (gridData[row][col] !== newChecked) {
                return changedInBackground('ongedaan gemaakt');
              }
              gridData[row][col] = prevVal;
              await saveCell(row, col, () =>
                Store.setObservation(student.id, exam.id, obs.id, prevVal, year)
              );
              hotInstances.forEach((h) => h.render());
            },
            redo: async () => {
              if (gridData[row][col] !== prevVal) {
                return changedInBackground('opnieuw uitgevoerd');
              }
              gridData[row][col] = newChecked;
              await saveCell(row, col, () =>
                Store.setObservation(student.id, exam.id, obs.id, newChecked, year)
              );
              hotInstances.forEach((h) => h.render());
            },
          });
          saveCell(row, col, () =>
            Store.setObservation(student.id, exam.id, obs.id, newChecked, year)
          ).then(() => hot.render());
        }
        // Advance: next obs → next obs, last obs + not last student → next row first Q,
        // last obs + last student → stay (nothing to advance to)
        // if (col < lastObsCol) {
        //   goTo(row, col + 1);
        // } else if (row < lastDataRow) {
        //   goTo(row + 1, firstQCol);
        // }
        // else: last obs of last student — value is saved above, cursor stays
        return;
      }
    },
    true // capture phase
  );

  return hot;
}
