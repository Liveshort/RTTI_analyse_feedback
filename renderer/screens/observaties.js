import { ICONS } from '../utils/icons.js';
import {
  showModal,
  closeModal,
  toast,
  escHtml,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
} from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Observaties
// ═══════════════════════════════════════════════════════════════════════════════

export const OBS_PRESET_ICONS = [
  // Meten & rekenen
  { icon: '📏' },
  { icon: '📐' },
  { icon: '🔢' },
  { icon: '🧮' },
  { icon: '➗' },
  { icon: '➕' },
  { icon: '➖' },
  { icon: '📊' },
  { icon: '📈' },
  { icon: '📉' },
  // Schrijven & noteren
  { icon: '✏️' },
  { icon: '📝' },
  { icon: '📌' },
  { icon: '📎' },
  { icon: '🔖' },
  { icon: '📋' },
  { icon: '📓' },
  { icon: '📚' },
  { icon: '🗒️' },
  { icon: '📖' },
  // Denken & analyseren
  { icon: '🔍' },
  { icon: '🔎' },
  { icon: '💡' },
  { icon: '💬' },
  { icon: '🎯' },
  { icon: '✅' },
  { icon: '❌' },
  { icon: '⚠️' },
  { icon: '❓' },
  { icon: '🧠' },
  // Scheikunde & fysica
  { icon: '⚗️' },
  { icon: '🧪' },
  { icon: '🧫' },
  { icon: '🧬' },
  { icon: '🔬' },
  { icon: '🔭' },
  { icon: '🌡️' },
  { icon: '⚡' },
  { icon: '🧲' },
  { icon: '💧' },
  // Biologie & natuur
  { icon: '🌱' },
  { icon: '🦠' },
  { icon: '🌿' },
  { icon: '🦋' },
  { icon: '🐚' },
  // Overige
  { icon: '🔄' },
  { icon: '🔗' },
  { icon: '🎲' },
  { icon: '⏱️' },
  { icon: '🚀' },
];

const SCHOOLSOORTEN = ['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium'];

export function renderObservaties() {
  let obs = Store.getObservatiesSync();
  const container = document.getElementById('obs-list');
  document.getElementById('btn-add-obs').onclick = () => openObsModal(null);

  const activeSubject = Store.getActiveSubject();
  const schoolsoortFilter = getSchoolsoortFilter();
  const jaarlagFilter = getJaarlagFilter();
  const jaarlagKlasFilter = getJaarlagKlasFilter();
  const eigenOnly = getEigenOnly();
  const activeUser = Store.getActiveUser();

  // Schoolsoort filter — always applied; obs without schoolsoort always pass
  obs = obs.filter(
    (o) =>
      !(o.schoolsoort ?? []).length || (o.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss))
  );

  // Jaarlaag filter
  if (activeSubject === 'wi') {
    // Klas 1-6 filter
    obs = obs.filter(
      (o) =>
        !(o.jaarlagen ?? []).length ||
        (o.jaarlagen ?? []).some((jl) => jaarlagKlasFilter.has(String(jl)))
    );
    // Subcategory filter: OB covers jaarlaag 1-3; any WisX covers jaarlaag 4-6
    const allowedJl = new Set();
    if (jaarlagFilter.has('OB')) {
      allowedJl.add('1');
      allowedJl.add('2');
      allowedJl.add('3');
    }
    if (
      jaarlagFilter.has('WisA') ||
      jaarlagFilter.has('WisB') ||
      jaarlagFilter.has('WisC') ||
      jaarlagFilter.has('WisD')
    ) {
      allowedJl.add('4');
      allowedJl.add('5');
      allowedJl.add('6');
    }
    obs = obs.filter(
      (o) =>
        !(o.jaarlagen ?? []).length || (o.jaarlagen ?? []).some((jl) => allowedJl.has(String(jl)))
    );
  } else {
    obs = obs.filter(
      (o) =>
        !(o.jaarlagen ?? []).length ||
        (o.jaarlagen ?? []).some((jl) => jaarlagFilter.has(String(jl)))
    );
  }

  // Eigen filter: obs must be relevant to at least one of teacher's groups
  if (eigenOnly && activeUser && !Store.isAdminActive()) {
    const cfg = Store.getConfigSync();
    const myGroups = Store.getGroupsSync(cfg.activeYear).filter((g) =>
      (g.docenten ?? []).includes(activeUser.id)
    );
    obs = obs.filter((o) =>
      myGroups.some(
        (g) =>
          (o.subjects ?? []).includes(g.subject) &&
          (o.schoolsoort ?? []).some((ss) => (g.schoolsoort ?? []).includes(ss)) &&
          (o.jaarlagen ?? []).map(String).includes(String(g.jaarlaag))
      )
    );
  }

  if (obs.length === 0) {
    container.innerHTML =
      '<p class="hint">Nog geen observaties. Klik "+ Observatie toevoegen" om te beginnen.</p>';
    return;
  }

  obs.sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));

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
        <span class="small">Schoolsoort: ${(o.schoolsoort ?? []).join(', ') || '—'} &nbsp;·&nbsp; Jaarlagen: ${(o.jaarlagen ?? []).join(', ') || '—'}</span>
      </div>
      <div class="card-actions">
        <button class="btn-sm btn-sm-icon" data-action="edit-obs" data-id="${escHtml(o.id)}" title="Observatie bewerken">${ICONS.pen}</button>
        <button class="btn-sm btn-danger btn-sm-icon" data-action="del-obs" data-id="${escHtml(o.id)}"${Store.obsIsUsedInAnyExam(o.id) ? ' disabled title="Deze observatie is gekoppeld aan een toets en kan dus niet worden verwijderd."' : ' title="Observatie verwijderen"'}>${ICONS.trash}</button>
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
        id: 'obs-' + Date.now(),
        naam: '',
        icon: OBS_PRESET_ICONS[0].icon,
        uitleg: '',
        leeradvies: '',
        schoolsoort: [],
        subjects: [Store.getActiveSubject()],
        jaarlagen: [],
      };
  const isEdit = !!existingId;

  // Normalize legacy single-subject field to array
  if (!Array.isArray(obs.subjects) || obs.subjects.length === 0) {
    obs.subjects = obs.subject ? [obs.subject] : [Store.getActiveSubject()];
  }

  const jlAll = ['1', '2', '3', '4', '5', '6'];

  const schoolSS = Store.getSchoolSync().schoolsoort ?? [];
  const schoolSSFilter = schoolSS.length > 0;
  const schoolsoortHtml = SCHOOLSOORTEN.map((ss) => {
    const sel = (obs.schoolsoort ?? []).includes(ss);
    const disabled = schoolSSFilter && !schoolSS.includes(ss);
    const cls = `tog-btn ss-obs-btn${sel ? ' selected' : ''}${disabled ? ' tog-btn-disabled' : ''}`;
    return `<button type="button" class="${cls}" data-ss="${ss}" style="height:30px"${disabled ? ' disabled' : ''}>${ss}</button>`;
  }).join('');

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

  const iconBtn = (p) =>
    `<button type="button" class="obs-icon-btn${p.icon === obs.icon ? ' selected' : ''}"
      data-icon="${escHtml(p.icon)}"
      style="font-size:18px;width:40px;height:40px;border-radius:6px;
        border:2px solid ${p.icon === obs.icon ? 'var(--primary)' : 'var(--border)'};
        background:${p.icon === obs.icon ? '#e8f0fb' : 'var(--bg)'};
        cursor:pointer;transition:all .1s"
      >${escHtml(p.icon)}</button>`;

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
        ${OBS_PRESET_ICONS.slice(0, 12).map(iconBtn).join('')}
        <details class="obs-icon-more">
          <summary class="obs-icon-more-summary">Meer iconen ▾</summary>
          <div class="obs-icon-more-grid">
            ${OBS_PRESET_ICONS.slice(12).map(iconBtn).join('')}
          </div>
        </details>
      </div>
      <div style="margin-top:6px;font-size:12px;color:var(--muted)">
        Geselecteerd: <span id="obs-icon-preview" style="font-size:16px">${escHtml(obs.icon)}</span>
      </div>
    </div>
    <div class="form-group">
      <label>Korte uitleg</label>
      <textarea id="f-ouit" rows="3"
        placeholder="Bijvoorbeeld: Leerling is bij het beantwoorden van rekenvragen de eenheid vergeten."
      >${escHtml(obs.uitleg)}</textarea>
    </div>
    <div class="form-group">
      <label>Leeradvies (voor de leerling bij de toetsanalyse)</label>
      <textarea id="f-oleeradvies" rows="4"
        placeholder="Bijvoorbeeld: Vergeet bij het beantwoorden van vragen nooit te controleren of je de eenheid vergeten bent. Gebruik de GFBA-methode (Gegevens, Formule, Berekening &amp; Antwoord). In de Antwoordstap controleer je of het antwoord de juiste eenheid heeft. Maak nu opgave 1 en 2 van H1 nog eens volgens de GFBA-methode."
      >${escHtml(obs.leeradvies ?? '')}</textarea>
    </div>
    <div class="form-group">
      <label>Schoolsoort</label>
      <div class="btn-toggle-group" id="obs-ss-group">
        ${schoolsoortHtml}
      </div>
    </div>
    <div class="form-group">
      <label>Vakken</label>
      <div class="btn-toggle-group" id="obs-subj-group">
        ${SUBJECT_BTNS.map(
          (s) =>
            `<button type="button" class="tog-btn subj-btn${obs.subjects.includes(s.code) ? ' selected' : ''}" data-subj="${s.code}">${escHtml(s.label)}</button>`
        ).join('')}
      </div>
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

      el.querySelectorAll('.ss-obs-btn').forEach((b) =>
        b.addEventListener('click', () => b.classList.toggle('selected'))
      );

      el.querySelectorAll('.subj-btn').forEach((b) =>
        b.addEventListener('click', () => b.classList.toggle('selected'))
      );

      el.querySelectorAll('.jl-btn').forEach((b) =>
        b.addEventListener('click', () => b.classList.toggle('selected'))
      );

      el.querySelector('#f-osave').addEventListener('click', async () => {
        const naam = el.querySelector('#f-onam').value.trim();
        const uitleg = el.querySelector('#f-ouit').value.trim();
        const leeradvies = el.querySelector('#f-oleeradvies').value.trim();
        const schoolsoort = [...el.querySelectorAll('.ss-obs-btn.selected')].map(
          (b) => b.dataset.ss
        );
        const subjects = [...el.querySelectorAll('.subj-btn.selected')].map((b) => b.dataset.subj);
        const jaarlagen = [...el.querySelectorAll('.jl-btn.selected')].map((b) => b.dataset.jl);
        if (!naam) {
          toast('Vul een naam in.', 'error');
          return;
        }
        if (schoolsoort.length === 0) {
          toast('Selecteer minstens één schoolsoort.', 'error');
          return;
        }
        if (subjects.length === 0) {
          toast('Selecteer minstens één vak.', 'error');
          return;
        }
        if (jaarlagen.length === 0) {
          toast('Selecteer minstens één jaarlaag.', 'error');
          return;
        }
        const updated = {
          ...obs,
          naam,
          icon: selectedIcon,
          uitleg,
          leeradvies,
          schoolsoort,
          subjects,
          jaarlagen,
        };
        delete updated.subject;
        await Store.upsertObservation(updated);
        closeModal();
        toast('Observatie opgeslagen.', 'success');
        renderObservaties();
      });
    }
  );
}
