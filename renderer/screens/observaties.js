import { showModal, closeModal, toast, escHtml } from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Observaties
// ═══════════════════════════════════════════════════════════════════════════════

export const OBS_PRESET_ICONS = [
  { icon: '📏', label: 'Eenheid vergeten' },
  { icon: '🔄', label: 'Formule herschrijven' },
  { icon: '✏️', label: 'Rekenfout' },
  { icon: '±', label: 'Tekenfout' },
  { icon: '🔢', label: 'Significante cijfers' },
  { icon: '📐', label: 'Diagram/schets ontbreekt' },
  { icon: '💬', label: 'Onvolledige redenering' },
  { icon: '🔗', label: 'Vergelijking niet opstellen' },
  { icon: '🎯', label: 'Verkeerde formule gekozen' },
  { icon: '⚡', label: 'Eenheden niet omgezet' },
  { icon: '🔍', label: 'Aflezing grafiek' },
  { icon: '📝', label: 'Definitie onvolledig' },
];

export function renderObservaties() {
  const obs = Store.getObservatiesSync();
  const container = document.getElementById('obs-list');
  document.getElementById('btn-add-obs').onclick = () => openObsModal(null);

  if (obs.length === 0) {
    container.innerHTML =
      '<p class="hint">Nog geen observaties. Klik "+ Observatie toevoegen" om te beginnen.</p>';
    return;
  }

  container.innerHTML = obs
    .map(
      (o) => `
    <div class="card">
      <div class="card-main">
        <div class="student-card-row">
          <span class="obs-card-icon">${escHtml(o.icon)}</span>
          <strong class="obs-card-naam">${escHtml(o.naam)}</strong>
        </div>
        <span class="muted">${escHtml(o.uitleg)}</span>
        <span class="small">Jaarlagen: ${(o.jaarlagen ?? []).join(', ') || '—'}</span>
      </div>
      <div class="card-actions">
        <button class="btn-sm btn-sm-icon" data-action="edit-obs" data-id="${escHtml(o.id)}" title="Observatie bewerken">✎</button>
        <button class="btn-sm btn-danger btn-sm-icon" data-action="del-obs" data-id="${escHtml(o.id)}"${Store.obsIsUsedInAnyExam(o.id) ? ' disabled title="Deze observatie is gekoppeld aan een toets en kan dus niet worden verwijderd."' : ' title="Observatie verwijderen"'}>🗑</button>
      </div>
    </div>`
    )
    .join('');

  container
    .querySelectorAll('[data-action="edit-obs"]')
    .forEach((b) => b.addEventListener('click', () => openObsModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="del-obs"]')
    .forEach((b) => b.addEventListener('click', () => deleteObs(b.dataset.id)));
}

export async function deleteObs(id) {
  if (!confirm('Observatie verwijderen?')) return;
  await Store.deleteObservation(id);
  toast('Observatie verwijderd.', 'info');
  renderObservaties();
}

export async function openObsModal(existingId) {
  const allObs = Store.getObservatiesSync();
  const obs = existingId
    ? JSON.parse(JSON.stringify(allObs.find((o) => o.id === existingId) ?? {}))
    : {
        subject: Store.getActiveSubject(),
        id: 'obs-' + Date.now(),
        naam: '',
        icon: OBS_PRESET_ICONS[0].icon,
        uitleg: '',
        jaarlagen: [],
      };
  const isEdit = !!existingId;
  const jlAll = ['1', '2', '3', '4', '5', '6'];

  showModal(
    `
    <h3>${isEdit ? 'Observatie bewerken' : 'Observatie toevoegen'}</h3>
    <div class="form-group">
      <label>Naam</label>
      <input id="f-onam" type="text" value="${escHtml(obs.naam)}" placeholder="bijv. Eenheid vergeten" />
    </div>
    <div class="form-group">
      <label>Icoon</label>
      <div id="obs-icon-grid" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
        ${OBS_PRESET_ICONS.map(
          (p) =>
            `<button type="button" class="obs-icon-btn${p.icon === obs.icon ? ' selected' : ''}"
            data-icon="${escHtml(p.icon)}" title="${escHtml(p.label)}"
            style="font-size:18px;width:40px;height:40px;border-radius:6px;
              border:2px solid ${p.icon === obs.icon ? 'var(--primary)' : 'var(--border)'};
              background:${p.icon === obs.icon ? '#e8f0fb' : 'var(--bg)'};
              cursor:pointer;transition:all .1s"
            >${escHtml(p.icon)}</button>`
        ).join('')}
      </div>
      <div style="margin-top:6px;font-size:12px;color:var(--muted)">
        Geselecteerd: <span id="obs-icon-preview" style="font-size:16px">${escHtml(obs.icon)}</span>
      </div>
    </div>
    <div class="form-group">
      <label>Uitleg</label>
      <input id="f-ouit" type="text" value="${escHtml(obs.uitleg)}" placeholder="Korte omschrijving voor de leraar" />
    </div>
    <div class="form-group">
      <label>Jaarlagen</label>
      <div class="btn-toggle-group" id="obs-jl-group">
        ${jlAll
          .map(
            (j) =>
              `<button type="button" class="tog-btn jl-btn${(obs.jaarlagen ?? []).includes(j) ? ' selected' : ''}" data-jl="${j}">${j}</button>`
          )
          .join('')}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-osave">${isEdit ? 'Opslaan' : 'Toevoegen'}</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      let selectedIcon = obs.icon;
      el.querySelector('#obs-icon-grid').addEventListener('click', (e) => {
        const btn = e.target.closest('.obs-icon-btn');
        if (!btn) return;
        selectedIcon = btn.dataset.icon;
        el.querySelectorAll('.obs-icon-btn').forEach((b) => {
          const active = b.dataset.icon === selectedIcon;
          b.classList.toggle('selected', active);
          b.style.border = `2px solid ${active ? 'var(--primary)' : 'var(--border)'}`;
          b.style.background = active ? '#e8f0fb' : 'var(--bg)';
        });
        el.querySelector('#obs-icon-preview').textContent = selectedIcon;
      });

      el.querySelectorAll('.jl-btn').forEach((b) =>
        b.addEventListener('click', () => b.classList.toggle('selected'))
      );

      el.querySelector('#f-osave').addEventListener('click', async () => {
        const naam = el.querySelector('#f-onam').value.trim();
        const uitleg = el.querySelector('#f-ouit').value.trim();
        const jaarlagen = [...el.querySelectorAll('.jl-btn.selected')].map((b) => b.dataset.jl);
        if (!naam) {
          toast('Vul een naam in.', 'error');
          return;
        }
        if (jaarlagen.length === 0) {
          toast('Selecteer minstens één jaarlaag.', 'error');
          return;
        }
        const updated = { ...obs, naam, icon: selectedIcon, uitleg, jaarlagen };
        await Store.upsertObservation(updated);
        closeModal();
        toast('Observatie opgeslagen.', 'success');
        renderObservaties();
      });
    }
  );
}
