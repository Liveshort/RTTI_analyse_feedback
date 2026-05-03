// ── Student add/edit & CSV import modals ─────────────────────────────────────
import { showModal, closeModal, toast, escHtml, overlayElement } from '../app.js';
import { parseCSV, askSchoolYear } from '../utils/csv.js';
import {
  leerlingenState,
  renderLeerlingen,
  renderStudentList,
  JAARLAGEN,
  SCHOOLSOORTEN,
} from '../screens/leerlingen.js';

export function openStudentModal(id) {
  const jaarlaagHtml = JAARLAGEN.map(
    (jl) =>
      `<button type="button" class="tog-btn jl-btn jl-s-toggle" data-jl="${jl}">${jl}</button>`
  ).join('');
  const schoolSS = Store.getSchoolSync().schoolsoort ?? [];
  const schoolSSFilter = schoolSS.length > 0;
  const schoolsoortHtml = SCHOOLSOORTEN.map((ss) => {
    const disabled = schoolSSFilter && !schoolSS.includes(ss);
    return `<button type="button" class="tog-btn ss-s-toggle${disabled ? ' tog-btn-disabled' : ''}" data-ss="${ss}"${disabled ? ' disabled' : ''}>${ss}</button>`;
  }).join('');

  showModal(
    `
    <h3>${id ? 'Leerling bewerken' : 'Leerling toevoegen'}</h3>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label>Leerlingnummer</label>
        <input id="f-sid" type="number" placeholder="105455" ${id ? 'disabled' : ''} />
      </div>
      <div class="form-group" style="flex:1">
        <label>Geslacht</label>
        <div id="f-sgeslacht-host" class="csel-host"></div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>Voornaam</label>
        <input id="f-svoornaam" type="text" />
      </div>
      <div class="form-group" style="flex:1">
        <label>Tussenvoegsel</label>
        <input id="f-stussen" type="text" placeholder="van" />
      </div>
      <div class="form-group" style="flex:2">
        <label>Achternaam</label>
        <input id="f-sachter" type="text" />
      </div>
    </div>
    <div class="form-row" style="align-items:flex-end;gap:20px">
      <div class="form-group" style="flex:0 0 auto;margin-bottom:0">
        <label>Jaarlaag</label>
        <div class="btn-toggle-group">${jaarlaagHtml}</div>
      </div>
      <div class="form-group" style="flex:2;margin-bottom:0">
        <label>Stamklas</label>
        <input id="f-sstamklas" type="text" placeholder="5A" />
      </div>
    </div>
    <div class="form-row" style="margin-top:10px">
      <div class="form-group" style="flex:1;margin-bottom:0">
        <label>Schoolsoort</label>
        <div class="vak-toggle-group">${schoolsoortHtml}</div>
      </div>
      <div class="form-group" style="flex:0 0 auto;margin-bottom:0">
        <label>Schooljaar</label>
        <div id="f-syear-label" style="padding:7px 0;font-size:13px;color:var(--muted);font-style:italic"></div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-s-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    async (el) => {
      const year = leerlingenState.year || Store.getConfigSync().activeYear;
      el.querySelector('#f-syear-label').textContent = year;

      const geslachtSel = new CustomSelect(el.querySelector('#f-sgeslacht-host'), {
        placeholder: '—',
      });
      geslachtSel.setOptions([
        { value: '', label: '—' },
        { value: 'M', label: 'M' },
        { value: 'V', label: 'V' },
        { value: 'X', label: 'X' },
      ]);
      geslachtSel.setValue('');

      if (id) {
        const s = (await Store.getStudents(year)).find((s) => s.id === id);
        if (s) {
          el.querySelector('#f-sid').value = s.id;
          el.querySelector('#f-svoornaam').value = s.voornaam ?? '';
          el.querySelector('#f-stussen').value = s.tussenvoegsel ?? '';
          el.querySelector('#f-sachter').value = s.achternaam ?? s.name ?? '';
          el.querySelector('#f-sstamklas').value = s.stamklas ?? '';
          geslachtSel.setValue(s.geslacht ?? '');
          if (s.jaarlaag) {
            el.querySelector(`.jl-s-toggle[data-jl="${s.jaarlaag}"]`)?.classList.add('selected');
          }
          (s.schoolsoort ?? []).forEach((ss) => {
            el.querySelector(`.ss-s-toggle[data-ss="${ss}"]`)?.classList.add('selected');
          });
        }
      }

      el.querySelectorAll('.jl-s-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          el.querySelectorAll('.jl-s-toggle').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
      el.querySelectorAll('.ss-s-toggle').forEach((btn) => {
        btn.addEventListener('click', () => btn.classList.toggle('selected'));
      });

      el.querySelector('#f-s-save').addEventListener('click', async () => {
        const sid = Number(el.querySelector('#f-sid').value);
        const achternaam = el.querySelector('#f-sachter').value.trim();
        if (!sid || !achternaam) {
          toast('Vul leerlingnummer en achternaam in.', 'error');
          return;
        }
        const jaarlaag = el.querySelector('.jl-s-toggle.selected')?.dataset.jl ?? '';
        const schoolsoort = [...el.querySelectorAll('.ss-s-toggle.selected')].map(
          (b) => b.dataset.ss
        );
        await Store.upsertStudent(
          {
            id: sid,
            voornaam: el.querySelector('#f-svoornaam').value.trim(),
            tussenvoegsel: el.querySelector('#f-stussen').value.trim(),
            achternaam,
            stamklas: el.querySelector('#f-sstamklas').value.trim(),
            geslacht: geslachtSel.getValue(),
            jaarlaag,
            schoolsoort,
          },
          year
        );
        closeModal();
        toast('Leerling opgeslagen.', 'success');
        renderLeerlingen();
      });
    }
  );
}

export async function deleteStudent(id) {
  if (!confirm('Leerling verwijderen?')) return;
  await Store.deleteStudent(id, leerlingenState.year);
  toast('Leerling verwijderd.', 'info');
  renderStudentList();
}

// ── Student CSV import ────────────────────────────────────────────────────────
export async function openStudentCSVImport() {
  const cfg = await Store.getConfig();
  const existingYears = Store.listYearsSync();
  const ui = { showModal, closeModal, toast, overlay: overlayElement };
  const year = await askSchoolYear(cfg.activeYear, existingYears, ui);
  if (!year) return;

  showModal(
    `
    <h3>Leerlingen importeren — ${escHtml(year)}</h3>
    <p class="muted" style="margin-bottom:12px">
      Verwachte kolommen: <code>Leerlingnummer, Voornaam, Tussenvoegsel, Achternaam, Geslacht, Stamklas, Jaarlaag, Schoolsoort</code>
    </p>
    <div class="form-group">
      <label>CSV-bestand</label>
      <input type="file" id="f-csv-students" accept=".csv,.txt" />
    </div>
    <div id="csv-preview"></div>
    <div class="form-actions" style="margin-top:12px">
      <button class="btn-primary" id="f-csv-import" disabled>Importeren</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      let parsed = null;
      el.querySelector('#f-csv-students').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        parsed = parseCSV(await file.text()).rows;
        const preview = el.querySelector('#csv-preview');
        if (!parsed.length) {
          preview.innerHTML = '<p class="hint">Geen rijen gevonden.</p>';
          el.querySelector('#f-csv-import').disabled = true;
          return;
        }
        preview.innerHTML = `
        <p style="margin:8px 0 4px"><strong>${parsed.length}</strong> leerlingen gevonden (eerste 5):</p>
        <table class="preview-table">
          <thead><tr>${Object.keys(parsed[0])
            .map((h) => `<th>${escHtml(h)}</th>`)
            .join('')}</tr></thead>
          <tbody>${parsed
            .slice(0, 5)
            .map(
              (r) =>
                `<tr>${Object.values(r)
                  .map((v) => `<td>${escHtml(v)}</td>`)
                  .join('')}</tr>`
            )
            .join('')}
          </tbody></table>`;
        el.querySelector('#f-csv-import').disabled = false;
      });
      el.querySelector('#f-csv-import').addEventListener('click', async () => {
        if (!parsed) return;
        const students = parsed
          .map((r) => {
            const ssRaw = (r['Schoolsoort'] ?? r['schoolsoort'] ?? '').trim();
            return {
              id: Number(r['Leerlingnummer'] ?? r['leerlingnummer']),
              voornaam: r['Voornaam'] ?? r['voornaam'] ?? '',
              tussenvoegsel: r['Tussenvoegsel'] ?? r['tussenvoegsel'] ?? '',
              achternaam: r['Achternaam'] ?? r['achternaam'] ?? '',
              geslacht: r['Geslacht'] ?? r['geslacht'] ?? '',
              stamklas: r['Stamklas'] ?? r['stamklas'] ?? '',
              jaarlaag: String(r['Jaarlaag'] ?? r['jaarlaag'] ?? '').trim(),
              schoolsoort: ssRaw
                ? ssRaw
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
            };
          })
          .filter((s) => s.id && s.achternaam);
        await Store.upsertStudents(students, year);
        closeModal();
        toast(`${students.length} leerlingen geïmporteerd voor ${year}.`, 'success');
        leerlingenState.year = year;
        renderLeerlingen();
      });
    }
  );
}
