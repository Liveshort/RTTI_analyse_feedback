import { showModal, closeModal, toast, escHtml, getAdminSubjectFilter } from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Gebruikers — admin-only user management
// ═══════════════════════════════════════════════════════════════════════════════

const SUBJECTS = ['bio', 'nat', 'schk', 'wi'];
const SUBJECT_LABEL = { nat: 'Natuurkunde', bio: 'Biologie', schk: 'Scheikunde', wi: 'Wiskunde' };
const SCHOOLSOORTEN = ['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium'];

export async function renderGebruikers() {
  const container = document.getElementById('screen-gebruikers');
  container.innerHTML = `
    <div class="screen-header">
      <h2>Gebruikers</h2>
      <div class="header-actions">
        <button class="btn-primary" id="btn-add-user">+ Gebruiker toevoegen</button>
      </div>
    </div>
    <div id="user-list" class="card-list"></div>`;

  await renderUserList();

  container.querySelector('#btn-add-user').addEventListener('click', () => openUserModal(null));
}

async function renderUserList() {
  const container = document.getElementById('user-list');
  if (!container) return;

  const users = await Store.loadUsers();
  const subjFilter = getAdminSubjectFilter();
  const matchesFilter = (u) => !subjFilter || (u.vakken ?? []).includes(subjFilter);
  const active = users.filter((u) => u.actief && !u.isAdmin && matchesFilter(u));
  const inactive = users.filter((u) => !u.actief && !u.isAdmin && matchesFilter(u));
  const adminUser = users.find((u) => u.isAdmin);

  function renderCard(user) {
    const initials = user.afkorting || (user.voornaam[0] ?? '') + (user.achternaam[0] ?? '');
    const shape = user.isAdmin ? 'badge-square' : 'badge-circle';
    const vakkenLabels = (user.vakken ?? []).map((v) => SUBJECT_LABEL[v] ?? v).join(', ') || '—';
    const name = [user.voornaam, user.tussenvoegsel, user.achternaam].filter(Boolean).join(' ');

    return `
      <div class="card gebruiker-card">
        <div class="gebruiker-card-left">
          <div class="user-badge ${shape}" style="--badge-color: ${user.kleur ?? '#888'}; pointer-events:none">
            <span class="badge-initials">${escHtml(initials)}</span>
          </div>
        </div>
        <div class="gebruiker-card-body">
          <div class="gebruiker-card-name">${escHtml(name)}</div>
          <div class="gebruiker-card-vakken">${escHtml(vakkenLabels)}</div>
        </div>
        <div class="card-actions">
          ${
            !user.isAdmin
              ? `
            <button class="btn-sm btn-sm-icon" data-action="edit-user" data-id="${escHtml(user.id)}" title="Gebruiker bewerken">✎</button>
            <button class="btn-sm btn-danger btn-sm-icon" data-action="toggle-user" data-id="${escHtml(user.id)}"
                    title="${user.actief ? 'Gebruiker deactiveren' : 'Gebruiker activeren'}">
              ${user.actief ? '🚫' : '✓'}
            </button>
          `
              : ''
          }
        </div>
      </div>`;
  }

  let html = '';
  if (adminUser) {
    html += `<h3 class="list-section-header">Beheerder</h3>${renderCard(adminUser)}`;
  }
  if (active.length) {
    html += `<h3 class="list-section-header">Actieve gebruikers</h3>${active.map(renderCard).join('')}`;
  }
  if (inactive.length) {
    html += `<h3 class="list-section-header muted">Gedeactiveerde gebruikers</h3>${inactive.map(renderCard).join('')}`;
  }
  if (!active.length && !adminUser) {
    html = `<p class="hint">Nog geen gebruikers aangemaakt.</p>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('[data-action="edit-user"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const users = await Store.loadUsers();
      const user = users.find((u) => u.id === btn.dataset.id);
      if (user) openUserModal(user);
    });
  });

  container.querySelectorAll('[data-action="toggle-user"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const users = await Store.loadUsers();
      const user = users.find((u) => u.id === btn.dataset.id);
      if (!user) return;
      user.actief = !user.actief;
      await Store.upsertUser(user);
      toast(
        user.actief ? `${user.voornaam} geactiveerd.` : `${user.voornaam} gedeactiveerd.`,
        'success'
      );
      await renderUserList();
    });
  });
}

function openUserModal(user) {
  const isNew = !user;
  const isAdmin = user?.isAdmin === true;
  const title = isNew
    ? 'Gebruiker toevoegen'
    : isAdmin
      ? 'Beheerder bewerken'
      : 'Gebruiker bewerken';

  const vakkenButtons = SUBJECTS.map((s) => {
    const active = (user?.vakken ?? []).includes(s);
    return `<button type="button" class="tog-btn vak-toggle${active ? ' selected' : ''}" data-vak="${s}">${SUBJECT_LABEL[s]}</button>`;
  }).join('');

  const schoolSS = Store.getSchoolSync().schoolsoort ?? [];
  const schoolSSFilter = schoolSS.length > 0;
  const schoolsoortButtons = SCHOOLSOORTEN.map((ss) => {
    const active = (user?.schoolsoort ?? []).includes(ss);
    const disabled = schoolSSFilter && !schoolSS.includes(ss);
    return `<button type="button" class="tog-btn ss-toggle${active ? ' selected' : ''}${disabled ? ' tog-btn-disabled' : ''}" data-ss="${ss}"${disabled ? ' disabled' : ''}>${ss}</button>`;
  }).join('');

  const html = `
    <h3>${escHtml(title)}</h3>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>Voornaam</label>
        <input id="f-uvoornaam" type="text" value="${escHtml(user?.voornaam ?? '')}" />
      </div>
      <div class="form-group" style="flex:1">
        <label>Tussenvoegsel</label>
        <input id="f-utussen" type="text" value="${escHtml(user?.tussenvoegsel ?? '')}" placeholder="van" />
      </div>
      <div class="form-group" style="flex:2">
        <label>Achternaam</label>
        <input id="f-uachter" type="text" value="${escHtml(user?.achternaam ?? '')}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label>Afkorting (op badge)</label>
        <input id="f-uafkorting" type="text" maxlength="5" value="${escHtml(user?.afkorting ?? '')}" placeholder="bijv. JAN" style="text-transform:uppercase" />
      </div>
      <div class="form-group" style="flex:1">
        <label>Kleur (badge rand)</label>
        <input id="f-ukleur" type="color" value="${user?.kleur ?? '#4a90d9'}" style="width:48px;height:28px;padding:2px;cursor:pointer;vertical-align:middle" />
      </div>
    </div>
    <div class="form-group">
      <label>Schoolsoort</label>
      <div class="vak-toggle-group">${schoolsoortButtons}</div>
    </div>
    ${
      !isAdmin
        ? `
    <div class="form-group">
      <label>Vakken</label>
      <div class="vak-toggle-group">${vakkenButtons}</div>
    </div>
    `
        : ''
    }
    <div class="form-group">
      <label>Profielfoto (optioneel, 1:1 verhouding)</label>
      <input id="f-ufoto" type="file" accept="image/jpeg,image/png" />
      ${user?.foto ? `<span class="hint" style="display:block;margin-top:4px">Huidig: ${escHtml(user.foto)}</span>` : ''}
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-u-save">${isNew ? 'Toevoegen' : 'Opslaan'}</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>`;

  showModal(html, (content) => {
    // Toggle schoolsoort buttons
    content.querySelectorAll('.ss-toggle').forEach((btn) => {
      btn.addEventListener('click', () => btn.classList.toggle('selected'));
    });

    // Toggle vak buttons
    content.querySelectorAll('.vak-toggle').forEach((btn) => {
      btn.addEventListener('click', () => btn.classList.toggle('selected'));
    });

    content.querySelector('#f-u-save').addEventListener('click', async () => {
      const voornaam = content.querySelector('#f-uvoornaam').value.trim();
      const achternaam = content.querySelector('#f-uachter').value.trim();
      if (!voornaam) {
        toast('Voornaam is verplicht.', 'error');
        return;
      }

      const selectedSchoolsoort = Array.from(content.querySelectorAll('.ss-toggle.selected')).map(
        (b) => b.dataset.ss
      );

      const selectedVakken = isAdmin
        ? (user?.vakken ?? SUBJECTS)
        : Array.from(content.querySelectorAll('.vak-toggle.selected')).map((b) => b.dataset.vak);

      let fotoPath = user?.foto ?? null;
      const fileInput = content.querySelector('#f-ufoto');
      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        fotoPath = await new Promise((resolve) => {
          reader.onload = async (ev) => {
            const base64 = ev.target.result.split(',')[1];
            const ext = file.name.endsWith('.png') ? 'png' : 'jpg';
            const userId = user?.id ?? `gebr-${Date.now()}`;
            const relPath = `fotos/${userId}.${ext}`;
            await window.rtti.savePhoto(relPath, base64);
            resolve(relPath);
          };
          reader.readAsDataURL(file);
        });
      }

      const saved = {
        id: user?.id ?? `gebr-${Date.now()}`,
        voornaam,
        tussenvoegsel: content.querySelector('#f-utussen').value.trim(),
        achternaam,
        afkorting:
          content.querySelector('#f-uafkorting').value.trim().toUpperCase() ||
          voornaam.slice(0, 3).toUpperCase(),
        schoolsoort: selectedSchoolsoort,
        vakken: selectedVakken,
        kleur: content.querySelector('#f-ukleur').value,
        foto: fotoPath,
        isAdmin: user?.isAdmin ?? false,
        actief: user?.actief ?? true,
      };

      await Store.upsertUser(saved);
      closeModal();
      toast(isNew ? `${voornaam} toegevoegd.` : `${voornaam} opgeslagen.`, 'success');
      await renderUserList();
    });
  });
}
