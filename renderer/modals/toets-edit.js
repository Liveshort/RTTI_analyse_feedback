import { wireSpinners, spinnerValue } from '../utils/spinners.js';
import {
  showModal,
  closeModal,
  toast,
  escHtml,
  formatGrade,
  SEL,
  onModalSync,
  showReloadNotice,
  changedByName,
} from '../app.js';
import { SEC_ROMAN, SEC_ALPHA2, renderToetsen } from '../screens/toetsen.js';

export async function openExamModal(existingId, afterSave = null) {
  const cfg = await Store.getConfig();
  const toetsYear = SEL.toetsenYear.getValue() || cfg.activeYear;
  await Store.loadYear(toetsYear);

  const isWi = Store.getActiveSubject() === 'wi';
  const schoolSS = Store.getSchoolSync().schoolsoort ?? [];
  const schoolSSFilter = schoolSS.length > 0;

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
        <div class="form-group" style="flex:none;margin-bottom:0">
          <label>Schoolsoort</label>
          <div class="btn-toggle-group">
            ${['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium']
              .map((ss) => {
                const dis = schoolSSFilter && !schoolSS.includes(ss);
                return `<button class="tog-btn ss-btn${dis ? ' tog-btn-disabled' : ''}" data-ss="${ss}"${dis ? ' disabled' : ''}>${ss}</button>`;
              })
              .join('')}
          </div>
        </div>
        ${
          isWi
            ? `
        <div class="form-group" style="flex:none;margin-bottom:0">
          <label>Subcategorie</label>
          <div class="btn-toggle-group">
            <button class="tog-btn sub-btn" data-sub="wisa">A</button>
            <button class="tog-btn sub-btn" data-sub="wisb">B</button>
            <button class="tog-btn sub-btn" data-sub="wisc">C</button>
            <button class="tog-btn sub-btn" data-sub="wisd">D</button>
          </div>
        </div>`
            : ''
        }
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

        // Schoolsoort multi-select
        el.querySelectorAll('.ss-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
          });
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
          const schoolsoort = [...el.querySelectorAll('.ss-btn.selected')].map((b) => b.dataset.ss);
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
          if (schoolsoort.length === 0) {
            toast('Selecteer minimaal één schoolsoort.', 'error');
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
            schoolsoort,
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

  const availableObs = Store.getObservatiesSync()
    .filter((o) => {
      if (!(o.jaarlagen ?? []).map(String).includes(String(exam.jaarlaag))) return false;
      const obsSS = o.schoolsoort ?? [];
      if (obsSS.length === 0) return true;
      return (exam.schoolsoort ?? []).some((ss) => obsSS.includes(ss));
    })
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));

  showModal(
    `
    <h3>${
      isEdit
        ? `Toets bewerken: <em>${escHtml(exam.title)}</em> <span style="font-weight:normal;font-size:14px;font-style:normal">(Jaarlaag ${escHtml(String(exam.jaarlaag))}, ${escHtml((exam.schoolsoort ?? []).join(' / ') || '—')}, ${escHtml(toetsYear)})</span>`
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
      // Someone else changed or removed this exam while it is being edited
      // (saving would be refused anyway, so reload with their version).
      if (isEdit) {
        onModalSync('exam', async (ev) => {
          if (ev.id !== exam.id || ev.year !== toetsYear) return;
          const who = await changedByName(ev);
          if (!ev.after) {
            showReloadNotice(`Deze toets is verwijderd door een collega.`, () => {
              closeModal();
              renderToetsen();
            });
          } else {
            showReloadNotice(
              `Deze toets is gewijzigd door ${who}. Het venster wordt opnieuw geladen.`,
              () => openExamModal(exam.id, afterSave)
            );
          }
        });
      }

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
