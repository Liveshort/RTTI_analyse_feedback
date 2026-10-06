import { toast, escHtml } from '../app.js';
import { ICONS } from '../utils/icons.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: School — admin-only school information
// ═══════════════════════════════════════════════════════════════════════════════

const FIELD_LABELS = { naam: 'Naam', ondertitel: 'Ondertitel', motto: 'Motto' };
const SCHOOLSOORTEN = ['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium'];

export async function renderSchool() {
  const container = document.getElementById('screen-school');
  container.innerHTML = `<p class="hint">Laden…</p>`;

  const school = (await Store.loadSchool()) ?? {};
  const [logoUrl, watermerkUrl] = await Promise.all([
    school.logo ? window.rtti.readPhotoAsDataUrl(school.logo) : Promise.resolve(null),
    school.watermerk ? window.rtti.readPhotoAsDataUrl(school.watermerk) : Promise.resolve(null),
  ]);

  container.innerHTML = buildHtml(school, logoUrl, watermerkUrl);
  attachListeners(container, school);
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function buildHtml(school, logoUrl, watermerkUrl) {
  return `
    <div class="screen-header">
      <h2>School</h2>
    </div>
    <div class="school-card">
      <div class="school-logo-wrap">
        <div class="school-logo-area" id="school-logo-area">
          ${logoHtml(logoUrl)}
          <button class="school-logo-edit-btn btn-sm btn-sm-icon" id="btn-edit-logo" title="Logo wijzigen">${ICONS.pen}</button>
          <input type="file" id="input-logo" accept="image/*" style="display:none" />
        </div>
      </div>
      <div class="school-fields">
        ${textFieldRow('naam', school.naam ?? '')}
        ${textFieldRow('ondertitel', school.ondertitel ?? '')}
        ${textFieldRow('motto', school.motto ?? '')}
        ${schoolsoortRow(school.schoolsoort ?? [])}
        ${watermerkRow(watermerkUrl)}
      </div>
    </div>`;
}

function logoHtml(url) {
  if (url) return `<img src="${escHtml(url)}" class="school-logo-img" alt="Logo" />`;
  return `<div class="school-logo-empty">Nog niet ingesteld</div>`;
}

function textFieldRow(field, value) {
  const label = FIELD_LABELS[field];
  const hasValue = value.length > 0;
  return `
    <div class="school-field-row" data-field="${field}">
      <div class="school-field-label">${label}</div>
      <div class="school-field-value-wrap">
        <span class="school-field-text school-field-${field}${hasValue ? '' : ' school-placeholder'}"
              data-value="${escHtml(value)}">${hasValue ? escHtml(value) : 'Nog niet ingesteld'}</span>
        <button class="btn-sm btn-sm-icon" data-action="edit-field" data-field="${field}"
                title="${label} bewerken">${ICONS.pen}</button>
      </div>
    </div>`;
}

function schoolsoortRow(selected) {
  const buttons = SCHOOLSOORTEN.map((ss) => {
    const active = selected.includes(ss);
    return `<button type="button" class="tog-btn school-ss-btn${active ? ' selected' : ''}" data-ss="${ss}">${ss}</button>`;
  }).join('');
  return `
    <div class="school-field-row" data-field="schoolsoort">
      <div class="school-field-label">Schoolsoort</div>
      <div class="school-field-value-wrap">
        <div class="vak-toggle-group">${buttons}</div>
      </div>
    </div>`;
}

function watermerkRow(url) {
  const preview = url
    ? `<img src="${escHtml(url)}" class="school-watermark-img" alt="Watermerk" />`
    : `<span class="school-placeholder">Nog niet ingesteld</span>`;
  return `
    <div class="school-field-row" data-field="watermerk">
      <div class="school-field-label">Watermerk</div>
      <div class="school-field-value-wrap">
        <div class="school-watermark-preview" id="school-watermark-preview">${preview}</div>
        <button class="btn-sm btn-sm-icon" data-action="edit-watermerk" title="Watermerk wijzigen">${ICONS.pen}</button>
        <input type="file" id="input-watermerk" accept="image/svg+xml,.svg" style="display:none" />
      </div>
    </div>`;
}

// ── Event listeners ───────────────────────────────────────────────────────────

function attachListeners(container, school) {
  // Logo
  container.querySelector('#btn-edit-logo').addEventListener('click', () => {
    container.querySelector('#input-logo').click();
  });
  container.querySelector('#input-logo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await saveImageField(file, 'school-logo', 'logo', school, container);
    e.target.value = '';
  });

  // Text fields
  container.querySelectorAll('[data-action="edit-field"]').forEach((btn) => {
    btn.addEventListener('click', () => startTextEdit(btn.dataset.field, container, school));
  });

  // Schoolsoort toggles — save immediately on each click
  container.querySelectorAll('.school-ss-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.classList.toggle('selected');
      school.schoolsoort = [...container.querySelectorAll('.school-ss-btn.selected')].map(
        (b) => b.dataset.ss
      );
      try {
        await Store.saveSchool(school);
      } catch (_) {
        toast('Opslaan mislukt.', 'error');
      }
    });
  });

  // Watermerk
  container.querySelector('[data-action="edit-watermerk"]').addEventListener('click', () => {
    container.querySelector('#input-watermerk').click();
  });
  container.querySelector('#input-watermerk').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isSvg = file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml';
    if (!isSvg) {
      toast('Alleen SVG-bestanden zijn toegestaan voor het watermerk.', 'error');
      e.target.value = '';
      return;
    }
    await saveImageField(file, 'school-watermerk', 'watermerk', school, container);
    e.target.value = '';
  });
}

// ── Inline text editing ───────────────────────────────────────────────────────

function startTextEdit(field, container, school) {
  const row = container.querySelector(`.school-field-row[data-field="${field}"]`);
  const valueWrap = row.querySelector('.school-field-value-wrap');
  const span = row.querySelector('.school-field-text');
  const editBtn = row.querySelector('[data-action="edit-field"]');
  const currentValue = span.dataset.value;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.className = `school-field-input school-field-${field}`;
  span.replaceWith(input);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-sm btn-sm-icon btn-primary';
  confirmBtn.title = 'Opslaan';
  confirmBtn.innerHTML = ICONS.check;

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-sm btn-sm-icon btn-danger';
  cancelBtn.title = 'Annuleren';
  cancelBtn.innerHTML = ICONS.x;

  editBtn.replaceWith(confirmBtn, cancelBtn);
  input.focus();
  input.select();

  async function doConfirm() {
    const newValue = input.value.trim();
    school[field] = newValue;
    try {
      await Store.saveSchool(school);
    } catch (_) {
      toast('Opslaan mislukt.', 'error');
    }
    restoreDisplay(field, newValue, confirmBtn, cancelBtn, container, school);
  }

  function doCancel() {
    restoreDisplay(field, currentValue, confirmBtn, cancelBtn, container, school);
  }

  confirmBtn.addEventListener('click', doConfirm);
  cancelBtn.addEventListener('click', doCancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doConfirm();
    if (e.key === 'Escape') doCancel();
  });
}

function restoreDisplay(field, value, confirmBtn, cancelBtn, container, school) {
  const row = container.querySelector(`.school-field-row[data-field="${field}"]`);
  const input = row.querySelector('.school-field-input');
  const hasValue = value.length > 0;

  const newSpan = document.createElement('span');
  newSpan.className = `school-field-text school-field-${field}${hasValue ? '' : ' school-placeholder'}`;
  newSpan.dataset.value = value;
  newSpan.textContent = hasValue ? value : 'Nog niet ingesteld';
  input.replaceWith(newSpan);

  const newEditBtn = document.createElement('button');
  newEditBtn.className = 'btn-sm btn-sm-icon';
  newEditBtn.dataset.action = 'edit-field';
  newEditBtn.dataset.field = field;
  newEditBtn.title = `${FIELD_LABELS[field]} bewerken`;
  newEditBtn.innerHTML = ICONS.pen;
  newEditBtn.addEventListener('click', () => startTextEdit(field, container, school));

  confirmBtn.replaceWith(newEditBtn);
  cancelBtn.remove();
}

// ── Image saving ──────────────────────────────────────────────────────────────

async function saveImageField(file, fileBaseName, field, school, container) {
  const ext = file.name.split('.').pop().toLowerCase();
  const relPath = `fotos/${fileBaseName}.${ext}`;

  const dataUrl = await readFileAsDataUrl(file);
  const base64 = dataUrl.split(',')[1];

  await window.rtti.savePhoto(relPath, base64);
  school[field] = relPath;

  try {
    await Store.saveSchool(school);
    toast('Afbeelding opgeslagen.', 'success');
  } catch (_) {
    toast('Opslaan mislukt.', 'error');
    return;
  }

  const reloadedUrl = await window.rtti.readPhotoAsDataUrl(relPath);
  if (!reloadedUrl) return;

  if (field === 'logo') {
    const area = container.querySelector('#school-logo-area');
    const existing = area.querySelector('img, .school-logo-empty');
    const img = document.createElement('img');
    img.src = reloadedUrl;
    img.className = 'school-logo-img';
    img.alt = 'Logo';
    existing.replaceWith(img);
  } else if (field === 'watermerk') {
    const preview = container.querySelector('#school-watermark-preview');
    const img = document.createElement('img');
    img.src = reloadedUrl;
    img.className = 'school-watermark-img';
    img.alt = 'Watermerk';
    preview.innerHTML = '';
    preview.appendChild(img);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
