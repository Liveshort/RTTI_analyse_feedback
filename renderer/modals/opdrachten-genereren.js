import {
  showModal,
  closeModal,
  toast,
  escHtml,
  onModalSync,
  onModalCleanup,
  showReloadNotice,
  changedByName,
} from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL: Opdrachten genereren (opened from an exam card on the Toetsen screen)
//
// Couples the exam's observaties to opdrachten (saved as exam.opdrachten), and
// grade cards "Cijfer onder …" too (exam.opdrachtenCijfer), shows which
// students receive which opdracht and compiles them into one PDF: one block per
// student, ordered by group and name, each starting on an odd page.
// ═══════════════════════════════════════════════════════════════════════════════

export async function openOpdrachtenGenererenModal(examId, year) {
  const exam = Store.getExamsSync(year).find((e) => e.id === examId);
  if (!exam) return;
  const subject = exam.subject ?? Store.getActiveSubject();
  await Promise.all([Store.getOpdrachten(), Store.getObservaties(subject)]);

  // Modal state (kept while the modal is open, also across silent refreshes)
  const state = {
    exam,
    coupling: Store.getOpdrachtCoupling(exam), // { obsId: [opdrachtId] }
    cijfer: Store.getOpdrachtCijferCards(exam), // [{ id, onder, opdrachten }]
    savedJson: null, // coupling as last saved (or loaded), to detect changes
    showAll: false,
    excluded: new Set(), // student ids unticked for this run
    includeAnswers: true,
    assignments: null, // result of Store.getOpdrachtAssignments
    busy: false,
  };
  state.savedJson = couplingJson(state);

  showModal(
    `<h3 class="modal-title">Opdrachten genereren — ${escHtml(exam.title)}</h3>
     <div class="og-root">
     <div class="og-settings">
       <div class="og-scroll">
         <div class="og-section-head">
           <h4>Observaties en cijfers koppelen aan opdrachten</h4>
           <label class="og-inline-check">
             <input type="checkbox" data-action="og-show-all" /> Toon alle opdrachten
           </label>
         </div>
         <div class="og-obs-list"></div>
         <div class="og-cijfer-list"></div>
         <button type="button" class="btn-secondary btn-sm og-cijfer-add" data-action="og-cijfer-add">
           + Cijfer onder … toevoegen
         </button>
         <div class="og-section-head">
           <h4>Leerlingen</h4>
           <span class="og-student-toggles">
             <button type="button" class="btn-link" data-action="og-all-on">Alles aan</button> ·
             <button type="button" class="btn-link" data-action="og-all-off">Alles uit</button>
           </span>
         </div>
         <div class="og-student-list"><div class="rapport-spinner">Leerlingen worden geladen…</div></div>
       </div>
       <div class="og-footer">
         <label class="og-inline-check">
           <input type="checkbox" data-action="og-answers" checked /> Antwoorden meegeven
         </label>
         <span class="og-summary muted"></span>
         <button type="button" class="btn-secondary" data-action="og-key">Antwoordsleutel</button>
         <button type="button" class="btn-primary" data-action="og-generate">Genereren</button>
       </div>
     </div>
     <div class="og-result" hidden>
       <div class="og-result-bar">
         <button type="button" class="btn-secondary btn-sm" data-action="og-back">← Terug naar koppelingen</button>
       </div>
       <div class="rapport-modal-content og-result-content"></div>
     </div>
     </div>`,
    // Everything works on .og-root: #modal-content itself is shared by all
    // modals and stays in the DOM, so only og-root tells whether we're still open.
    (el) => initModal(el.querySelector('.og-root'), state, year),
    'modal-pdf',
    () => saveCoupling(state, year)
  );
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function obsLabel(obs) {
  return `${escHtml(obs.icon)} ${escHtml(obs.naam)}`;
}

const couplingJson = (state) => JSON.stringify({ obs: state.coupling, cijfer: state.cijfer });

const countLabel = (n) => (n === undefined ? '' : n === 1 ? '1 leerling' : `${n} leerlingen`);

const fmtOnder = (onder) => Number(onder).toFixed(1).replace('.', ',');

function renderCijferList(el, state) {
  const list = el.querySelector('.og-cijfer-list');
  // Don't replace a threshold the user is typing in (a background refresh).
  if (list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const { exam, assignments } = state;
  const opdrachten = Store.getOpdrachtenSync();
  const reasonIcon = Store.cijferCardReason({ onder: 0 }).icon;

  list.innerHTML = state.cijfer
    .map((card) => {
      const selected = card.opdrachten;
      const nStudents = assignments?.cijferStudents?.[card.id]?.length;
      const candidates = opdrachten
        .filter(
          (o) => state.showAll || Store.opdrachtMatchesExam(o, exam) || selected.includes(o.id)
        )
        .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'));
      const items = candidates.length
        ? candidates
            .map((o) => {
              const fits = Store.opdrachtMatchesExam(o, exam);
              return `
            <label class="checkbox-item og-op-item">
              <input type="checkbox" data-action="og-couple-cijfer" data-card="${escHtml(card.id)}"
                data-op="${escHtml(o.id)}" ${selected.includes(o.id) ? 'checked' : ''} />
              <span class="og-op-name">${escHtml(o.naam)}</span>
              ${o.beschrijving ? `<span class="muted">${escHtml(o.beschrijving)}</span>` : ''}
              ${fits ? '' : '<span class="og-tag">past niet bij vak/jaarlaag/schoolsoort van de toets</span>'}
            </label>`;
            })
            .join('')
        : `<p class="muted og-empty">Geen passende opdrachten. Vink "Toon alle opdrachten" aan of maak een opdracht aan op het tabblad Opdrachten.</p>`;
      const warn =
        nStudents > 0 && selected.length === 0
          ? `<p class="og-warn">Geen opdracht gekoppeld: deze leerlingen krijgen hiervoor niets.</p>`
          : '';
      return `
      <div class="og-obs">
        <div class="og-obs-head">
          <label class="og-obs-name og-cijfer-head">${reasonIcon} Cijfer onder
            <input type="text" inputmode="decimal" class="og-cijfer-input" data-action="og-cijfer-onder"
              data-card="${escHtml(card.id)}" value="${fmtOnder(card.onder)}" aria-label="Cijfergrens" />
          </label>
          <span class="muted">${countLabel(nStudents)}</span>
          <button type="button" class="btn-link og-cijfer-remove" data-action="og-cijfer-remove"
            data-card="${escHtml(card.id)}" title="Verwijder deze cijfergrens">✕</button>
        </div>
        <div class="og-op-list">${items}</div>
        ${warn}
      </div>`;
    })
    .join('');
}

function renderObsList(el, state) {
  renderCijferList(el, state);
  const { exam, coupling, assignments } = state;
  const obsById = Object.fromEntries(
    Store.getObservatiesSync(exam.subject ?? Store.getActiveSubject()).map((o) => [o.id, o])
  );
  const opdrachten = Store.getOpdrachtenSync();
  const list = el.querySelector('.og-obs-list');

  const rows = (exam.obs_ids ?? []).map((obsId) => {
    const obs = obsById[obsId];
    if (!obs) return '';
    const selected = coupling[obsId] ?? [];
    const nStudents = assignments?.obsStudents?.[obsId]?.length;
    const countText = countLabel(nStudents);

    // Candidates: matching opdrachten (or all), plus whatever is selected already.
    // Opdrachten that list this observatie come first.
    const candidates = opdrachten
      .filter((o) => state.showAll || Store.opdrachtMatchesExam(o, exam) || selected.includes(o.id))
      .sort((a, b) => {
        const la = (a.observaties ?? []).includes(obsId) ? 0 : 1;
        const lb = (b.observaties ?? []).includes(obsId) ? 0 : 1;
        return la - lb || (a.naam ?? '').localeCompare(b.naam ?? '', 'nl');
      });

    const items = candidates.length
      ? candidates
          .map((o) => {
            const linked = (o.observaties ?? []).includes(obsId);
            const fits = Store.opdrachtMatchesExam(o, exam);
            const tags = [
              linked ? '' : 'niet gekoppeld aan deze observatie',
              fits ? '' : 'past niet bij vak/jaarlaag/schoolsoort van de toets',
            ].filter(Boolean);
            return `
            <label class="checkbox-item og-op-item">
              <input type="checkbox" data-action="og-couple" data-obs="${escHtml(obsId)}"
                data-op="${escHtml(o.id)}" ${selected.includes(o.id) ? 'checked' : ''} />
              <span class="og-op-name">${escHtml(o.naam)}</span>
              ${o.beschrijving ? `<span class="muted">${escHtml(o.beschrijving)}</span>` : ''}
              ${tags.length ? `<span class="og-tag">${escHtml(tags.join(' · '))}</span>` : ''}
            </label>`;
          })
          .join('')
      : `<p class="muted og-empty">Geen passende opdrachten. Vink "Toon alle opdrachten" aan of maak een opdracht aan op het tabblad Opdrachten.</p>`;

    const warn =
      nStudents > 0 && selected.length === 0
        ? `<p class="og-warn">Geen opdracht gekoppeld: deze leerlingen krijgen hiervoor niets.</p>`
        : '';

    return `
      <div class="og-obs">
        <div class="og-obs-head">
          <span class="og-obs-name" title="${escHtml(obs.uitleg ?? '')}">${obsLabel(obs)}</span>
          <span class="muted">${countText}</span>
        </div>
        <div class="og-op-list">${items}</div>
        ${warn}
      </div>`;
  });

  list.innerHTML =
    rows.join('') ||
    '<p class="hint">Er zijn geen observaties gekoppeld aan deze toets. Voeg ze toe via "Toets bewerken", of koppel opdrachten aan een cijfergrens hieronder.</p>';
}

function renderStudentList(el, state) {
  const list = el.querySelector('.og-student-list');
  const students = state.assignments?.students ?? [];
  if (!students.length) {
    list.innerHTML =
      '<p class="hint">Geen enkele leerling krijgt een opdracht. Koppel opdrachten aan de observaties of cijfergrenzen hierboven, of geef leerlingen observaties in het scoreoverzicht.</p>';
    renderSummary(el, state);
    return;
  }

  let html = '';
  let lastGroup;
  for (const { student, group, items } of students) {
    const groupName = group?.name ?? 'Zonder groep';
    if (groupName !== lastGroup) {
      html += `<div class="og-group-head">${escHtml(groupName)}</div>`;
      lastGroup = groupName;
    }
    const id = String(student.id);
    const ops = items
      .map(
        ({ opdracht, obs }) =>
          `<span class="og-chip" title="${escHtml(obs.map((o) => o.naam).join(', '))}">${obs
            .map((o) => escHtml(o.icon))
            .join('')} ${escHtml(opdracht.naam)}</span>`
      )
      .join('');
    html += `
      <label class="og-student">
        <input type="checkbox" data-action="og-student" data-id="${escHtml(id)}"
          ${state.excluded.has(id) ? '' : 'checked'} />
        <span class="og-student-name">${escHtml(Store.fullName(student))}</span>
        <span class="og-chips">${ops}</span>
      </label>`;
  }
  list.innerHTML = html;
  renderSummary(el, state);
}

function includedStudents(state) {
  return (state.assignments?.students ?? []).filter(
    (e) => !state.excluded.has(String(e.student.id))
  );
}

function renderSummary(el, state) {
  const included = includedStudents(state);
  const nOps = included.reduce((sum, e) => sum + e.items.length, 0);
  el.querySelector('.og-summary').textContent =
    `${included.length} ${included.length === 1 ? 'leerling' : 'leerlingen'} · ` +
    `${nOps} ${nOps === 1 ? 'opdracht' : 'opdrachten'}`;
  el.querySelector('[data-action="og-generate"]').disabled = state.busy || nOps === 0;
  el.querySelector('[data-action="og-key"]').disabled = state.busy || nOps === 0;
}

// Recompute who gets what (after a coupling change or a background change).
let _recomputeSeq = 0;
async function recompute(el, state, year) {
  const seq = ++_recomputeSeq;
  const assignments = await Store.getOpdrachtAssignments(
    state.exam,
    year,
    state.coupling,
    state.cijfer
  );
  if (seq !== _recomputeSeq || !el.isConnected) return;
  state.assignments = assignments;
  renderObsList(el, state);
  renderStudentList(el, state);
}

// ── Saving the coupling ───────────────────────────────────────────────────────

async function saveCoupling(state, year) {
  const json = couplingJson(state);
  if (json === state.savedJson) return;
  try {
    state.exam = await Store.setExamOpdrachten(
      state.exam.id,
      state.coupling,
      year,
      state.exam.subject,
      state.cijfer
    );
    state.savedJson = json;
  } catch (e) {
    toast(`Koppeling kon niet worden opgeslagen: ${e.message}`, 'error');
  }
}

// ── Generating ────────────────────────────────────────────────────────────────

function studentJobs(state) {
  const { exam } = state;
  return includedStudents(state).flatMap(({ student, group, items }) =>
    items.map(({ opdracht, obs }) => ({
      key: String(student.id),
      typFile: opdracht.typFile,
      label: opdracht.naam,
      mode: 'student',
      header: {
        title: opdracht.naam,
        student: Store.fullName(student),
        group: group?.name ?? '',
        exam: exam.title,
        observaties: obs.map((o) => ({ icon: o.icon, name: o.naam })),
      },
    }))
  );
}

function answerKeyJobs(state) {
  const seen = new Map();
  for (const { items } of includedStudents(state)) {
    for (const { opdracht } of items) seen.set(opdracht.id, opdracht);
  }
  return [...seen.values()]
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'))
    .map((o) => ({
      key: o.id,
      typFile: o.typFile,
      label: o.naam,
      mode: 'answers',
      header: { title: o.naam },
    }));
}

async function generate(el, state, year, kind) {
  if (state.busy) return;
  const jobs = kind === 'key' ? answerKeyJobs(state) : studentJobs(state);
  const missing = jobs.filter((j) => !j.typFile);
  if (missing.length) {
    toast(`Opdracht "${missing[0].label}" heeft geen Typst-bestand.`, 'error');
    return;
  }
  if (!jobs.length) return;

  state.busy = true;
  renderSummary(el, state);
  await saveCoupling(state, year);

  const settings = el.querySelector('.og-settings');
  const result = el.querySelector('.og-result');
  const content = el.querySelector('.og-result-content');
  const backBtn = el.querySelector('[data-action="og-back"]');
  settings.hidden = true;
  result.hidden = false;
  backBtn.disabled = true;

  const what = kind === 'key' ? 'Antwoordsleutel' : 'Opdrachten';
  content.innerHTML = `<div class="rapport-spinner">${what} worden gegenereerd… <span class="og-progress"></span></div>`;
  const progressEl = content.querySelector('.og-progress');
  const offProgress = window.rtti.onAssignmentProgress(({ done, total }) => {
    if (progressEl.isConnected) progressEl.textContent = `${done} / ${total}`;
  });

  let res;
  try {
    res = await window.rtti.renderAssignmentBatch(jobs, {
      includeAnswers: state.includeAnswers,
      duplex: kind !== 'key',
      outputName: kind === 'key' ? 'antwoordsleutel.pdf' : 'opdrachten.pdf',
    });
  } catch (e) {
    res = { success: false, error: String(e?.message ?? e) };
  } finally {
    offProgress();
    state.busy = false;
  }
  if (!el.isConnected) return;
  backBtn.disabled = false;
  renderSummary(el, state);

  if (!res.success) {
    content.innerHTML = `<pre class="hint rapport-error">${escHtml(res.error)}</pre>`;
    toast(`Fout bij het genereren van de ${what.toLowerCase()}.`, 'error');
    return;
  }

  // Cache-buster: the output file name is reused for every run.
  const pdfUrl = 'file:///' + res.pdfPath.replace(/\\/g, '/') + `?t=${Date.now()}`;
  content.innerHTML = `<iframe class="rapport-pdf-frame" src="pdf-viewer.html?file=${encodeURIComponent(pdfUrl)}"></iframe>`;
  state.printPath = res.pdfPath;
  toast(`${what} gegenereerd (${res.pages} pagina's).`, 'success');
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function initModal(el, state, year) {
  const { exam } = state;
  const subject = exam.subject ?? Store.getActiveSubject();

  el.addEventListener('change', (e) => {
    const t = e.target;
    switch (t.dataset.action) {
      case 'og-show-all':
        state.showAll = t.checked;
        renderObsList(el, state);
        break;
      case 'og-answers':
        state.includeAnswers = t.checked;
        break;
      case 'og-couple': {
        const { obs, op } = t.dataset;
        const list = (state.coupling[obs] ?? []).filter((id) => id !== op);
        if (t.checked) list.push(op);
        state.coupling[obs] = list;
        recompute(el, state, year);
        break;
      }
      case 'og-couple-cijfer': {
        const card = state.cijfer.find((c) => c.id === t.dataset.card);
        if (!card) break;
        card.opdrachten = card.opdrachten.filter((id) => id !== t.dataset.op);
        if (t.checked) card.opdrachten.push(t.dataset.op);
        recompute(el, state, year);
        break;
      }
      case 'og-cijfer-onder': {
        const card = state.cijfer.find((c) => c.id === t.dataset.card);
        if (!card) break;
        const n = Number(t.value.trim().replace(',', '.'));
        if (t.value.trim() === '' || isNaN(n) || n <= 1 || n > 10) {
          toast('Vul een cijfergrens in tussen 1,0 en 10,0.', 'error');
          t.value = fmtOnder(card.onder);
          break;
        }
        card.onder = Math.round(n * 10) / 10;
        t.value = fmtOnder(card.onder);
        t.blur(); // lets the refresh re-render the card
        recompute(el, state, year);
        break;
      }
      case 'og-student':
        if (t.checked) state.excluded.delete(t.dataset.id);
        else state.excluded.add(t.dataset.id);
        renderSummary(el, state);
        break;
    }
  });

  el.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'og-generate') generate(el, state, year, 'student');
    else if (action === 'og-cijfer-add') {
      state.cijfer.push({ id: `cijfer-${Date.now()}`, onder: 5.5, opdrachten: [] });
      recompute(el, state, year);
      renderCijferList(el, state);
    } else if (action === 'og-cijfer-remove') {
      const id = e.target.closest('[data-card]').dataset.card;
      state.cijfer = state.cijfer.filter((c) => c.id !== id);
      recompute(el, state, year);
      renderCijferList(el, state);
    } else if (action === 'og-key') generate(el, state, year, 'key');
    else if (action === 'og-back') {
      el.querySelector('.og-result').hidden = true;
      el.querySelector('.og-settings').hidden = false;
      el.querySelector('.og-result-content').innerHTML = '';
    } else if (action === 'og-all-on' || action === 'og-all-off') {
      for (const { student } of state.assignments?.students ?? []) {
        if (action === 'og-all-on') state.excluded.delete(String(student.id));
        else state.excluded.add(String(student.id));
      }
      renderStudentList(el, state);
    }
  });

  // The PDF viewer's "Afdrukken" button opens the file in the system viewer
  // (window.print() doesn't work in Electron iframes).
  const onMessage = (e) => {
    if (e.data?.type === 'print-pdf' && state.printPath) window.rtti.openPath(state.printPath);
  };
  window.addEventListener('message', onMessage);
  onModalCleanup(() => window.removeEventListener('message', onMessage));

  // Background changes by colleagues. Scores, groups, students and opdrachten only
  // change who gets what: recompute silently. A change to this exam reloads.
  let timer = null;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => recompute(el, state, year), 400);
  };
  onModalCleanup(() => clearTimeout(timer));
  onModalSync('scores', (ev) => {
    if (ev.year === year && ev.subject === subject) refresh();
  });
  onModalSync('students', (ev) => {
    if (ev.year === year) refresh();
  });
  onModalSync('group', (ev) => {
    if (ev.year === year) refresh();
  });
  onModalSync('opdracht', refresh);
  onModalSync('observatie', refresh);
  onModalSync('exam', async (ev) => {
    if (ev.id !== exam.id || ev.year !== year) return;
    const who = await changedByName(ev);
    if (!ev.after) {
      state.savedJson = couplingJson(state); // nothing left to save to
      showReloadNotice(`Deze toets is verwijderd door ${who}.`, closeModal);
      return;
    }
    // Keep our unsaved coupling choices; the reopened modal starts from the
    // exam as it is now.
    showReloadNotice(
      `Deze toets is gewijzigd door ${who}. Het venster wordt opnieuw geladen.`,
      async () => {
        await saveCoupling(state, year);
        openOpdrachtenGenererenModal(exam.id, year);
      }
    );
  });

  renderObsList(el, state);
  recompute(el, state, year);
}
