import { lerpColor } from '../utils/colors.js';
import { wireSpinners, spinnerValue } from '../utils/spinners.js';
import { showModal, closeModal, toast, escHtml, formatGrade, SEL } from '../app.js';
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
  const examMaxTotal = exam.questions.reduce((s, q) => s + q.max_points, 0);
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
    examMaxTotal,
  };
}

export async function renderToetsenList() {
  const year = SEL.toetsenYear.getValue();
  const exams = Store.getExamsSync(year);
  const container = document.getElementById('exam-list');

  exams.sort(
    (a, b) =>
      String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
      (a.volgnummer ?? 0) - (b.volgnummer ?? 0)
  );

  if (exams.length === 0) {
    container.innerHTML = `<p class="hint">Geen toetsen voor ${escHtml(year)}.</p>`;
    return;
  }

  let html = '';
  let lastJl = null;
  for (const e of exams) {
    const jl = String(e.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    const total = e.questions.reduce((s, q) => s + q.max_points, 0);
    const cats = ['R', 'T1', 'T2', 'I']
      .map((c) => {
        const pts = e.questions.filter((q) => q.rtti === c).reduce((s, q) => s + q.max_points, 0);
        return pts > 0 ? `${c}: ${pts}p` : null;
      })
      .filter(Boolean)
      .join(' · ');
    const typeColor = e?.type === 'pta' ? '#d9534f' : e?.type === 'po' ? '#f0ad4e' : '#4A90D9';
    html += `
      <div class="card">
        <div class="card-main">
          <strong>${e.volgnummer ? `<span class="volgnummer" style="background:${typeColor}">${e.volgnummer}</span> ` : ''}<button class="student-name-btn exam-title-link" data-action="goto-scores" data-examid="${escHtml(e.id)}" data-jaarlaag="${escHtml(String(e.jaarlaag))}">${escHtml(e.title)}</button></strong>
          <span class="muted">
            ${e.periode ? 'Periode ' + escHtml(String(e.periode)) + ' · ' : ''}
            ${e.questions.length} vragen · ${total}p · N-term: ${String(e.n_term).replace('.', ',')} · Weging: ${String(e.weging ?? 1).replace('.', ',')}${e.type === 'pta' ? ` · Weging SE: ${String(e.weging_se ?? e.weging ?? 1).replace('.', ',')}` : ''}
          </span>
          <span class="rtti-summary">${cats}</span>
          <span class="exam-stats muted" data-examid="${escHtml(e.id)}" style="display:none"></span>
        </div>
        <div class="card-actions">
          <button class="btn-sm" data-action="edit-exam" data-id="${escHtml(e.id)}">Bewerken</button>
          <button class="btn-sm btn-danger" data-action="del-exam" data-id="${escHtml(e.id)}">Verwijderen</button>
        </div>
      </div>`;
  }
  container.innerHTML = html;

  container
    .querySelectorAll('[data-action="edit-exam"]')
    .forEach((b) => b.addEventListener('click', () => openExamModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="del-exam"]')
    .forEach((b) => b.addEventListener('click', () => deleteExam(b.dataset.id)));
  container.querySelectorAll('[data-action="goto-scores"]').forEach((b) =>
    b.addEventListener('click', () => {
      const year = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
      openScoreModal(b.dataset.examid, year, { openExamModal, renderToetsenList });
    })
  );

  // Fill in per-exam stats asynchronously (reads from score cache, non-blocking)
  for (const e of exams) {
    const statsEl = container.querySelector(`.exam-stats[data-examid="${CSS.escape(e.id)}"]`);
    if (!statsEl) continue;
    computeExamStats(year, e).then((st) => {
      if (!st) {
        statsEl.remove();
        return;
      }
      const gv = parseFloat(st.avgG.replace(',', '.'));
      const circleColor = gv < 5.5 ? '#e57373' : lerpColor('#ffd54f', '#66bb6a', (gv - 5.5) / 4.5);
      statsEl.innerHTML =
        `<svg width="10" height="10" viewBox="0 0 10 10" style="vertical-align:middle;margin-right:5px;flex-shrink:0"><circle cx="5" cy="5" r="5" fill="${circleColor}"/></svg>` +
        `${st.avgG} ± ${st.sd} · ${st.fails}% onvoldoende`;
      statsEl.style.display = 'flex';
      statsEl.style.alignItems = 'center';
    });
  }
}

export async function openExamModal(existingId, afterSave = null) {
  const cfg = await Store.getConfig();
  const toetsYear = SEL.toetsenYear.getValue() || cfg.activeYear;
  await Store.loadYear(toetsYear);

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

        el.querySelectorAll('.jl-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            el.querySelectorAll('.jl-btn').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
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
          const exam = {
            id: Store.makeExamId(title, toetsYear),
            title,
            jaarlaag,
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
    showExamEditor(exam, true, toetsYear, afterSave);
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

export function showExamEditor(exam, isEdit, toetsYear, afterSave = null) {
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
        <button type="button" class="pta-btn" id="f-epta-btn"
          data-checked="${exam.type === 'pta' ? 'true' : 'false'}">✓</button>
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
        <div class="btn-toggle-group">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button class="tog-btn per-btn${String(exam.periode) === String(n) ? ' selected' : ''}" data-per="${n}">${n}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging</label>
        <div class="num-spinner" id="f-eweging2" data-val="${exam.weging ?? 1}" data-step="0.5" data-min="0" data-max="10">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(exam.weging ?? 1).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging SE</label>
        <div class="num-spinner" id="f-eweging-se2" data-val="${exam.weging_se ?? exam.weging ?? 1}" data-step="0.5" data-min="0" data-max="10">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(exam.weging_se ?? exam.weging ?? 1).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
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
          <th style="width:60px">Vraag</th>
          <th style="width:290px">Max punten</th>
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

      // PTA toggle button
      const ptaBtn2 = el.querySelector('#f-epta-btn');
      const wegingSE2El = el.querySelector('#f-eweging-se2');
      const syncWegingSE2 = () =>
        wegingSE2El.classList.toggle('spinner-disabled', ptaBtn2.dataset.checked !== 'true');
      syncWegingSE2();
      ptaBtn2.addEventListener('click', () => {
        ptaBtn2.dataset.checked = String(ptaBtn2.dataset.checked !== 'true');
        syncWegingSE2();
      });

      // Periode toggle buttons
      el.querySelectorAll('.per-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const already = btn.classList.contains('selected');
          el.querySelectorAll('.per-btn').forEach((b) => b.classList.remove('selected'));
          if (!already) btn.classList.add('selected');
        });
      });

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
              <div class="btn-toggle-group">
                ${['R', 'T1', 'T2', 'I']
                  .map(
                    (cat) =>
                      `<button class="tog-btn rtti-btn${q.rtti === cat ? ' selected' : ''}" data-qi="${i}" data-rtti="${cat}">${cat}</button>`
                  )
                  .join('')}
              </div>
            </td>
            <td><button class="btn-sm btn-danger qi-del" data-qi="${i}">\u2715</button></td>
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

      el.querySelectorAll('.obs-sel-btn').forEach((btn) =>
        btn.addEventListener('click', () => btn.classList.toggle('selected'))
      );

      el.querySelector('#f-addq').addEventListener('click', () => {
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
        const weging = spinnerValue(el.querySelector('#f-eweging2'));
        const weging_se = spinnerValue(el.querySelector('#f-eweging-se2'));
        const periode = el.querySelector('.per-btn.selected')?.dataset.per || null;
        const isPta = el.querySelector('#f-epta-btn').dataset.checked === 'true';
        if (!title || isNaN(nterm) || exam.questions.length === 0) {
          toast('Vul alle velden in en zorg voor minstens \u00e9\u00e9n vraag.', 'error');
          return;
        }
        const obs_ids = [...el.querySelectorAll('.obs-sel-btn.selected')].map(
          (b) => b.dataset.obsId
        );
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

export async function deleteExam(id) {
  if (!confirm('Toets verwijderen?')) return;
  const toetsYear = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
  await Store.deleteExam(id, toetsYear);
  toast('Toets verwijderd.', 'info');
  renderToetsen();
}
