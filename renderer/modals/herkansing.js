import { wireSpinners, spinnerValue } from '../utils/spinners.js';
import { showModal, closeModal, toast, escHtml, formatGrade } from '../app.js';
import { showExamEditor } from './toets-edit.js';
import { openExamOverviewModal } from './toets-overzicht.js';
import { renderToetsen } from '../screens/toetsen.js';

export async function openResitModal(parentId, year) {
  const all = await Store.getExams(year);
  const parent = all.find((e) => e.id === parentId);
  if (!parent) return;
  const resits = Store.getResitsSync(parentId, year);
  const nextAttempt = resits.length + 2; // attempt 1 is the original

  showModal(
    `
    <h3 id="f-resit-title">${escHtml(parent.title)} — …</h3>
    <div class="form-row" style="align-items:flex-end;gap:20px">
      <div class="form-group" style="flex:999;min-width:0;margin-bottom:0">
        <label>Beschrijving (bijv. INHAAL)</label>
        <input id="f-resit-desc" type="text" placeholder="INHAAL" autocomplete="off" />
      </div>
    </div>
    <div class="form-row" style="align-items:flex-end;gap:20px;margin-top:10px;opacity:.55;pointer-events:none">
      <div class="form-group" style="flex:2;margin-bottom:0">
        <label>Jaarlaag</label>
        <div class="btn-toggle-group">
          <button class="tog-btn selected" disabled>${escHtml(String(parent.jaarlaag))}</button>
        </div>
      </div>
      <div class="form-group" style="flex:2;margin-bottom:0">
        <label>Periode</label>
        <div class="btn-toggle-group">
          <button class="tog-btn selected" disabled>${escHtml(String(parent.periode ?? '—'))}</button>
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging</label>
        <div class="num-spinner spinner-disabled" style="width:90px">
          <button type="button" class="spin-btn spin-minus" disabled>−</button>
          <input class="spin-val" value="${String(parent.weging ?? 1).replace('.', ',')}" readonly />
          <button type="button" class="spin-btn spin-plus" disabled>+</button>
        </div>
      </div>
      ${
        parent.type === 'pta'
          ? `
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging SE</label>
        <div class="num-spinner spinner-disabled" style="width:90px">
          <button type="button" class="spin-btn spin-minus" disabled>−</button>
          <input class="spin-val" value="${String(parent.weging_se ?? parent.weging ?? 1).replace('.', ',')}" readonly />
          <button type="button" class="spin-btn spin-plus" disabled>+</button>
        </div>
      </div>`
          : ''
      }
    </div>
    <div class="form-row" style="margin-top:10px;gap:20px;align-items:flex-end">
      <div class="form-group" style="flex:1;min-width:160px">
        <label>Opgave- &amp; Vraagstructuur</label>
        <div id="f-resit-struct-host" class="csel-host"></div>
      </div>
      <div class="form-group" style="flex:none;width:108px">
        <label>Aantal vragen</label>
        <div class="num-spinner" id="f-resit-num" data-val="${parent.questions.length}" data-step="1" data-min="1" data-max="40">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${parent.questions.length}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
      <div class="form-group spinner-wrap-sm">
        <label>N-term</label>
        <div class="num-spinner" id="f-resit-nterm" data-val="${parent.n_term}" data-step="0.1" data-min="0" data-max="3">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(parent.n_term).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-resit-next">Verder →</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      const titleEl = el.querySelector('#f-resit-title');
      const descInput = el.querySelector('#f-resit-desc');
      descInput.addEventListener('input', () => {
        const desc = descInput.value.trim();
        titleEl.textContent = `${parent.title} — ${desc || '…'}`;
      });

      wireSpinners(el);

      const structSel = new CustomSelect(el.querySelector('#f-resit-struct-host'), {
        placeholder: '— kies structuur —',
      });
      structSel.setOptions([
        { value: 'roman', label: 'I1 I2 II3 … (Romeins cijfer + Volgnummer)' },
        { value: 'alpha', label: '1a 1b 2a … (Opgave + Letter)' },
        { value: 'alpha2', label: 'A1 A2 B3 … (Sectieletter + Volgnummer)' },
        { value: 'seq', label: '1, 2, 3, … (Volgnummer)' },
      ]);
      structSel.setValue(parent.structureMode ?? 'roman');

      el.querySelector('#f-resit-next').addEventListener('click', () => {
        const description = descInput.value.trim();
        if (!description) {
          toast('Vul een beschrijving in (bijv. INHAAL).', 'error');
          return;
        }
        const nterm = spinnerValue(el.querySelector('#f-resit-nterm'));
        const count = Math.round(spinnerValue(el.querySelector('#f-resit-num')));
        const structureMode = structSel.getValue() ?? parent.structureMode ?? 'roman';
        if (isNaN(nterm) || count < 1) {
          toast('Vul alle velden in.', 'error');
          return;
        }
        const fullTitle = `${parent.title} — ${description}`;
        const resitExam = {
          ...parent,
          id: Store.makeExamId(fullTitle, year),
          title: fullTitle,
          description,
          attempt: nextAttempt,
          parent_id: parent.id,
          n_term: nterm,
          structureMode,
          obs_ids: [],
          questions: Array.from({ length: count }, (_, i) => ({
            id: `q${i + 1}`,
            section: 'I',
            number: i + 1,
            max_points: 2,
            rtti: 'T1',
          })),
        };
        showExamEditor(resitExam, false, year, () => renderToetsen(), false, true);
      });
    }
  );
}

export async function openBestGradesOverviewModal(parentId, year) {
  const bestMap = await Store.computeBestGradeMap(parentId, year);
  // scoreOverride maps studentId → { questionScores, exam, grade }
  // The full entry is passed so openExamOverviewModal can use the pre-computed grade
  // (which was calculated against the correct attempt's exam structure) rather than
  // recalculating against the parent exam structure (which may have different max_points).
  openExamOverviewModal(parentId, year, bestMap, true);
}

export async function openSummaryEditModal(parentId, year) {
  const all = await Store.getExams(year);
  const parent = all.find((e) => e.id === parentId);
  if (!parent) return;
  const resits = Store.getResitsSync(parentId, year);
  const isPta = parent.type === 'pta';

  showModal(
    `
    <h3>Verzamelkaart bewerken: <em>${escHtml(parent.title)}</em></h3>
    <div class="form-row" style="align-items:flex-end;gap:20px;flex-wrap:wrap">
      <div class="form-group" style="flex:999;min-width:0;margin-bottom:0">
        <label>Naam</label>
        <input id="f-sum-naam" type="text" value="${escHtml(parent.title)}" />
      </div>
      <div class="form-group" style="flex:none;margin-bottom:0">
        <label>PTA</label>
        <button type="button" class="pta-btn" id="f-sum-pta" data-checked="${isPta ? 'true' : 'false'}">✓</button>
      </div>
      <div class="form-group" style="flex:1.5;margin-bottom:0">
        <label>Periode</label>
        <div class="btn-toggle-group">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button class="tog-btn per-btn${String(parent.periode) === String(n) ? ' selected' : ''}" data-per="${n}">${n}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging</label>
        <div class="num-spinner" id="f-sum-weging" data-val="${parent.weging ?? 1}" data-step="0.5" data-min="0" data-max="10">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(parent.weging ?? 1).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging SE</label>
        <div class="num-spinner${isPta ? '' : ' spinner-disabled'}" id="f-sum-weging-se" data-val="${parent.weging_se ?? parent.weging ?? 1}" data-step="0.5" data-min="0" data-max="10">
          <button type="button" class="spin-btn spin-minus"${isPta ? '' : ' disabled'}>−</button>
          <input class="spin-val" value="${String(parent.weging_se ?? parent.weging ?? 1).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus"${isPta ? '' : ' disabled'}>+</button>
        </div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-sum-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      const ptaBtn = el.querySelector('#f-sum-pta');
      const wegingSEEl = el.querySelector('#f-sum-weging-se');
      const syncWegingSE = () => {
        const active = ptaBtn.dataset.checked === 'true';
        wegingSEEl.classList.toggle('spinner-disabled', !active);
        wegingSEEl.querySelectorAll('.spin-btn').forEach((b) => {
          b.disabled = !active;
        });
      };
      ptaBtn.addEventListener('click', () => {
        ptaBtn.dataset.checked = String(ptaBtn.dataset.checked !== 'true');
        syncWegingSE();
      });
      el.querySelectorAll('.per-btn').forEach((btn) =>
        btn.addEventListener('click', () => {
          const already = btn.classList.contains('selected');
          el.querySelectorAll('.per-btn').forEach((b) => b.classList.remove('selected'));
          if (!already) btn.classList.add('selected');
        })
      );
      wireSpinners(el);

      el.querySelector('#f-sum-save').addEventListener('click', async () => {
        const naam = el.querySelector('#f-sum-naam').value.trim();
        if (!naam) {
          toast('Vul een naam in.', 'error');
          return;
        }
        const newIsPta = ptaBtn.dataset.checked === 'true';
        const newPeriode = el.querySelector('.per-btn.selected')?.dataset.per ?? null;
        const newWeging = spinnerValue(el.querySelector('#f-sum-weging'));
        const newWegingSE = spinnerValue(el.querySelector('#f-sum-weging-se'));
        const newType = newIsPta ? 'pta' : 'regular';

        // Update parent exam
        await Store.upsertExam(
          {
            ...parent,
            title: naam,
            type: newType,
            periode: newPeriode,
            weging: newWeging,
            weging_se: newWegingSE,
          },
          year
        );

        // Update each resit — derive its title from new parent naam + its own description
        for (const resit of resits) {
          await Store.upsertExam(
            {
              ...resit,
              title: `${naam} — ${resit.description ?? ''}`,
              type: newType,
              periode: newPeriode,
              weging: newWeging,
              weging_se: newWegingSE,
            },
            year
          );
        }

        closeModal();
        toast('Verzamelkaart opgeslagen.', 'success');
        renderToetsen();
      });
    }
  );
}
