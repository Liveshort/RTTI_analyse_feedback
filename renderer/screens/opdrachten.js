import {
  showModal,
  closeModal,
  toast,
  escHtml,
  getSchoolsoortFilter,
  matchesJaarlaagFilter,
  getAdminSubjectFilter,
  getObservatieFilter,
  setObservatieFilterOptions,
  openEditor,
} from '../app.js';
import { ICONS } from '../utils/icons.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Opdrachten
// ═══════════════════════════════════════════════════════════════════════════════

const SCHOOLSOORTEN = ['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium'];

const SUBJECT_BTNS = [
  { code: 'bio', label: 'Biologie' },
  { code: 'nat', label: 'Natuurkunde' },
  { code: 'schk', label: 'Scheikunde' },
  { code: 'wisob', label: 'Wis OB' },
  { code: 'wisa', label: 'WisA' },
  { code: 'wisb', label: 'WisB' },
  { code: 'wisc', label: 'WisC' },
  { code: 'wisd', label: 'WisD' },
];

const SUBJECT_LABEL = Object.fromEntries(SUBJECT_BTNS.map((s) => [s.code, s.label]));

export async function renderOpdrachten() {
  const container = document.getElementById('opdracht-list');
  document.getElementById('btn-add-opdracht').onclick = () => openOpdrachtenModal(null);

  const [, allObsRaw] = await Promise.all([
    Store.getOpdrachten(),
    window.rtti.readAllJson('observaties'),
  ]);
  const allOpdrachten = Store.getOpdrachtenSync();
  const _allObsForCards = (allObsRaw ?? []).filter((o) => o && o.id);

  // ── Filters ────────────────────────────────────────────────────────────────
  // Items without schoolsoort / jaarlagen / vakken always pass that filter.
  const schoolsoortFilter = getSchoolsoortFilter();
  const adminSubject = getAdminSubjectFilter();
  const matchesSchoolsoort = (item) =>
    !(item.schoolsoort ?? []).length || item.schoolsoort.some((ss) => schoolsoortFilter.has(ss));
  const matchesVak = (o) =>
    !adminSubject ||
    !(o.vakken ?? []).length ||
    o.vakken.some((v) => (adminSubject === 'wi' ? v.startsWith('wis') : v === adminSubject));

  // Observatie filter options: observaties matching the current schoolsoort + jaarlagen
  const obsOptions = _allObsForCards
    .filter((obs) => matchesSchoolsoort(obs) && matchesJaarlaagFilter(obs.jaarlagen))
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));
  setObservatieFilterOptions(obsOptions);
  const obsFilter = getObservatieFilter();

  let opdrachten = allOpdrachten.filter(
    (o) =>
      matchesSchoolsoort(o) &&
      matchesJaarlaagFilter(o.jaarlagen) &&
      matchesVak(o) &&
      (!obsFilter || (o.observaties ?? []).some((id) => obsFilter.has(id)))
  );

  // ── Sort: min(jaarlagen) asc, then naam alpha ──────────────────────────────
  opdrachten = [...opdrachten].sort((a, b) => {
    const aJl = Math.min(...(a.jaarlagen?.length ? a.jaarlagen : [Infinity]));
    const bJl = Math.min(...(b.jaarlagen?.length ? b.jaarlagen : [Infinity]));
    if (aJl !== bJl) return aJl - bJl;
    return (a.naam ?? '').localeCompare(b.naam ?? '', 'nl');
  });

  if (opdrachten.length === 0) {
    container.innerHTML = allOpdrachten.length
      ? '<p class="hint">Geen opdrachten gevonden voor de huidige filters.</p>'
      : '<p class="hint">Nog geen opdrachten. Klik "+ Opdracht toevoegen" om te beginnen.</p>';
    return;
  }

  const obsById = Object.fromEntries(_allObsForCards.map((o) => [o.id, o]));

  container.innerHTML = opdrachten
    .map((o) => {
      const ssDisplay = (o.schoolsoort ?? []).join(', ') || '—';
      const vakDisplay = (o.vakken ?? []).map((v) => SUBJECT_LABEL[v] ?? v).join(', ') || '—';
      const jlDisplay = (o.jaarlagen ?? []).join(', ') || '—';
      const obsIcons = (o.observaties ?? [])
        .map((id) => obsById[id])
        .filter(Boolean)
        .map(
          (obs) =>
            `<span title="${escHtml(obs.naam)}" style="cursor:default">${escHtml(obs.icon)}</span>`
        )
        .join(' ');

      return `
    <div class="card">
      <div class="card-main">
        <div class="student-card-row">
          <button class="student-name-btn" data-action="open-editor" data-id="${escHtml(o.id)}">${escHtml(o.naam)}</button>
        </div>
        <span class="muted">${escHtml(o.beschrijving ?? '')}</span>
        <span class="small">Schoolsoort: ${escHtml(ssDisplay)} &nbsp;·&nbsp; Vakken: ${escHtml(vakDisplay)} &nbsp;·&nbsp; Jaarlagen: ${escHtml(jlDisplay)} &nbsp;·&nbsp; Observaties: ${obsIcons || '—'}</span>
      </div>
      <div class="card-actions">
        <button class="btn-sm btn-sm-icon" data-action="edit-opdracht" data-id="${escHtml(o.id)}" title="Opdracht bewerken">${ICONS.pen}</button>
        <button class="btn-sm btn-danger btn-sm-icon" data-action="del-opdracht" data-id="${escHtml(o.id)}" title="Opdracht verwijderen">${ICONS.trash}</button>
      </div>
    </div>`;
    })
    .join('');

  container.querySelectorAll('[data-action="open-editor"]').forEach((b) =>
    b.addEventListener('click', () => {
      const opdracht = Store.getOpdrachtenSync().find((o) => o.id === b.dataset.id);
      if (opdracht) openEditor(opdracht);
    })
  );
  container
    .querySelectorAll('[data-action="edit-opdracht"]')
    .forEach((b) => b.addEventListener('click', () => openOpdrachtenModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="del-opdracht"]')
    .forEach((b) => b.addEventListener('click', () => deleteOpdracht(b.dataset.id)));
}

async function deleteOpdracht(id) {
  if (!confirm('Opdracht verwijderen? Dit verwijdert ook het bijbehorende Typst-bestand.')) return;
  await Store.deleteOpdracht(id);
  toast('Opdracht verwijderd.', 'info');
  renderOpdrachten();
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────

async function openOpdrachtenModal(existingId) {
  // Load all observations (across all subjects) before opening the modal
  const allObs = (await window.rtti.readAllJson('observaties')).filter((o) => o && o.id);

  const allOpdrachten = Store.getOpdrachtenSync();
  const existing = existingId ? (allOpdrachten.find((o) => o.id === existingId) ?? null) : null;
  const isEdit = !!existing;

  const data = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        naam: '',
        beschrijving: '',
        schoolsoort: [],
        vakken: [],
        jaarlagen: [],
        observaties: [],
      };

  const jlAll = ['1', '2', '3', '4', '5', '6'];

  const schoolSS = Store.getSchoolSync().schoolsoort ?? [];
  const schoolSSFilter = schoolSS.length > 0;

  const schoolsoortHtml = SCHOOLSOORTEN.map((ss) => {
    const sel = (data.schoolsoort ?? []).includes(ss);
    const disabled = schoolSSFilter && !schoolSS.includes(ss);
    const cls = `tog-btn ss-op-btn${sel ? ' selected' : ''}${disabled ? ' tog-btn-disabled' : ''}`;
    return `<button type="button" class="${cls}" data-ss="${ss}" style="height:30px"${disabled ? ' disabled' : ''}>${escHtml(ss)}</button>`;
  }).join('');

  const vakkenHtml = SUBJECT_BTNS.map((s) => {
    const sel = (data.vakken ?? []).includes(s.code);
    return `<button type="button" class="tog-btn vak-op-btn${sel ? ' selected' : ''}" data-vak="${s.code}" style="height:30px">${escHtml(s.label)}</button>`;
  }).join('');

  const jaarlagenHtml = jlAll
    .map((j) => {
      const sel = (data.jaarlagen ?? []).map(String).includes(j);
      return `<button type="button" class="tog-btn jl-btn jl-op-btn${sel ? ' selected' : ''}" data-jl="${j}">${j}</button>`;
    })
    .join('');

  showModal(
    `
    <h3>${isEdit ? 'Opdracht bewerken' : 'Opdracht toevoegen'}</h3>
    <div class="form-group">
      <label>Naam</label>
      <input id="f-opnam" type="text" value="${escHtml(data.naam)}" placeholder="bijv. Krachten analyseren" />
    </div>
    <div class="form-group">
      <label>Beschrijving</label>
      <textarea id="f-opbes" rows="2" placeholder="Korte omschrijving van de opdracht...">${escHtml(data.beschrijving ?? '')}</textarea>
    </div>
    <div class="form-group">
      <label>Schoolsoort</label>
      <div class="btn-toggle-group" id="op-ss-group">${schoolsoortHtml}</div>
    </div>
    <div class="form-group">
      <label>Vakken</label>
      <div class="btn-toggle-group" id="op-vak-group">${vakkenHtml}</div>
    </div>
    <div class="form-group">
      <label>Jaarlagen</label>
      <div class="btn-toggle-group" id="op-jl-group">${jaarlagenHtml}</div>
    </div>
    <div class="form-group">
      <label>Observaties</label>
      <div id="op-obs-group" style="display:flex;flex-wrap:wrap;gap:6px;min-height:36px;padding:4px 0"></div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-opsave">${isEdit ? 'Opslaan' : 'Toevoegen'}</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      function getSelectedSS() {
        return [...el.querySelectorAll('.ss-op-btn.selected')].map((b) => b.dataset.ss);
      }
      function getSelectedVak() {
        return [...el.querySelectorAll('.vak-op-btn.selected')].map((b) => b.dataset.vak);
      }
      function getSelectedJL() {
        return [...el.querySelectorAll('.jl-op-btn.selected')].map((b) => b.dataset.jl);
      }

      function obsMatchesSelections(obs, selectedSS, selectedVak, selectedJL) {
        const ssOk =
          selectedSS.length === 0 ||
          !obs.schoolsoort?.length ||
          obs.schoolsoort.some((ss) => selectedSS.includes(ss));
        const vakOk =
          selectedVak.length === 0 ||
          !obs.subjects?.length ||
          obs.subjects.some((v) => selectedVak.includes(v));
        const jlOk =
          selectedJL.length === 0 ||
          !obs.jaarlagen?.length ||
          obs.jaarlagen.map(String).some((jl) => selectedJL.includes(jl));
        return ssOk && vakOk && jlOk;
      }

      function rebuildObsToggles() {
        const selectedSS = getSelectedSS();
        const selectedVak = getSelectedVak();
        const selectedJL = getSelectedJL();
        const obsGroup = el.querySelector('#op-obs-group');

        // Preserve current selection; seed from saved data on first render
        const currentSelected = new Set(
          [...obsGroup.querySelectorAll('.obs-icon-op-btn.selected')].map((b) => b.dataset.obsid)
        );
        if (currentSelected.size === 0 && (data.observaties ?? []).length > 0) {
          (data.observaties ?? []).forEach((id) => currentSelected.add(id));
        }

        // Subtractive: start with all obs, filter OUT those that don't match any
        // selected value in a field (only when that field has a selection).
        const matching = allObs.filter((obs) =>
          obsMatchesSelections(obs, selectedSS, selectedVak, selectedJL)
        );

        if (matching.length === 0) {
          obsGroup.innerHTML =
            '<span class="muted" style="font-size:13px">Geen observaties gevonden voor de huidige selectie.</span>';
          return;
        }

        obsGroup.innerHTML = matching
          .map(
            (obs) =>
              `<button type="button"
                class="obs-icon-op-btn${currentSelected.has(obs.id) ? ' selected' : ''}"
                data-obsid="${escHtml(obs.id)}"
                title="${escHtml(obs.naam)}"
                style="width:30px;height:30px;padding:0;font-size:16px"
              >${escHtml(obs.icon)}</button>`
          )
          .join('');

        obsGroup
          .querySelectorAll('.obs-icon-op-btn')
          .forEach((b) => b.addEventListener('click', () => b.classList.toggle('selected')));
      }

      // Wire toggle groups
      el.querySelectorAll('.ss-op-btn').forEach((b) =>
        b.addEventListener('click', () => {
          b.classList.toggle('selected');
          rebuildObsToggles();
        })
      );
      el.querySelectorAll('.vak-op-btn').forEach((b) =>
        b.addEventListener('click', () => {
          b.classList.toggle('selected');
          rebuildObsToggles();
        })
      );
      el.querySelectorAll('.jl-op-btn').forEach((b) =>
        b.addEventListener('click', () => {
          b.classList.toggle('selected');
          rebuildObsToggles();
        })
      );

      // Initial obs render (for edit mode or if toggles pre-selected)
      rebuildObsToggles();

      el.querySelector('#f-opsave').addEventListener('click', async () => {
        const naam = el.querySelector('#f-opnam').value.trim();
        const beschrijving = el.querySelector('#f-opbes').value.trim();
        const schoolsoort = getSelectedSS();
        const vakken = getSelectedVak();
        const jaarlagen = getSelectedJL().map(Number);
        const observaties = [...el.querySelectorAll('.obs-icon-op-btn.selected')].map(
          (b) => b.dataset.obsid
        );

        if (!naam) {
          toast('Vul een naam in.', 'error');
          return;
        }
        if (schoolsoort.length === 0) {
          toast('Selecteer minstens één schoolsoort.', 'error');
          return;
        }
        if (vakken.length === 0) {
          toast('Selecteer minstens één vak.', 'error');
          return;
        }
        if (jaarlagen.length === 0) {
          toast('Selecteer minstens één jaarlaag.', 'error');
          return;
        }

        const id = existing?.id ?? `opdracht_${Date.now()}`;
        const typFile = existing?.typFile ?? `${id}.typ`;

        if (!existing) {
          await window.rtti.createAssignmentTypFile(typFile);
        }

        await Store.upsertOpdracht({
          id,
          naam,
          beschrijving,
          schoolsoort,
          vakken,
          jaarlagen,
          observaties,
          typFile,
        });
        closeModal();
        toast(`Opdracht ${isEdit ? 'bijgewerkt' : 'toegevoegd'}.`, 'success');
        renderOpdrachten();
      });
    }
  );
}
