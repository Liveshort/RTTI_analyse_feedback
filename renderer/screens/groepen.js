import { showModal, closeModal, toast, escHtml, SEL, overlayElement } from '../app.js';
import { parseCSV, askSchoolYear } from '../utils/csv.js';
import { openGroupStudentsModal } from './leerlingen.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Groepen
// ═══════════════════════════════════════════════════════════════════════════════

export function renderGroepen() {
  const cfg = Store.getConfigSync();
  const years = [...Store.listYearsSync()];
  if (!years.includes(cfg.activeYear)) years.unshift(cfg.activeYear);

  const currentYear = SEL.groupsYear.getValue() || cfg.activeYear;
  SEL.groupsYear.setOptions(years.map((y) => ({ value: y, label: y })));
  SEL.groupsYear.setValue(years.includes(currentYear) ? currentYear : years[0]);

  document.getElementById('btn-add-group').onclick = () => openGroupModal(null);
  document.getElementById('btn-import-groups').onclick = () => openGroupCSVImport();
  renderGroepenForYear(SEL.groupsYear.getValue());
}

export function renderGroepenForYear(year) {
  const groups = Store.getGroupsSync(year);
  const students = Store.getStudentsSync(year);
  const container = document.getElementById('group-list');

  groups.sort(
    (a, b) =>
      String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
      a.name.localeCompare(b.name)
  );

  if (groups.length === 0) {
    container.innerHTML = `<p class="hint">Geen groepen voor ${escHtml(year)}.</p>`;
    return;
  }

  let html = '';
  let lastJl = null;
  for (const g of groups) {
    const jl = String(g.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    const memberNames = g.student_ids
      .map((id) => {
        const s = students.find((s) => s.id === id);
        return s ? s.voornaam || Store.fullName(s) : `#${id}`;
      })
      .sort()
      .join(', ');
    html += `
      <div class="card">
        <div class="card-main">
          <button class="student-name-btn group-name-btn" data-action="open-group" data-id="${escHtml(g.id)}">${escHtml(g.name)}</button>
          <span class="muted">${g.student_ids.length} leerlingen</span>
          <p class="small">${escHtml(memberNames) || '—'}</p>
        </div>
        <div class="card-actions">
          <button class="btn-sm" data-action="edit-group" data-id="${escHtml(g.id)}">Bewerken</button>
          <button class="btn-sm btn-danger" data-action="del-group" data-id="${escHtml(g.id)}">Verwijderen</button>
        </div>
      </div>`;
  }
  container.innerHTML = html;
  container
    .querySelectorAll('[data-action="open-group"]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        openGroupStudentsModal(
          b.dataset.id,
          SEL.groupsYear.getValue() || Store.getConfigSync().activeYear
        )
      )
    );
  container
    .querySelectorAll('[data-action="edit-group"]')
    .forEach((b) => b.addEventListener('click', () => openGroupModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="del-group"]')
    .forEach((b) => b.addEventListener('click', () => deleteGroup(b.dataset.id)));
}

export async function openGroupModal(id) {
  const year = SEL.groupsYear.getValue() || Store.getConfigSync().activeYear;
  const students = await Store.getStudents(year);
  students.sort((a, b) => Store.fullName(a).localeCompare(Store.fullName(b)));

  let group = { id: '', name: '', jaarlaag: '', student_ids: [] };
  if (id) {
    const all = await Store.getGroups(year);
    group = JSON.parse(JSON.stringify(all.find((g) => g.id === id) ?? group));
  }

  showModal(
    `
    <h3>${id ? 'Groep bewerken' : 'Groep toevoegen'}</h3>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>Naam (bijv. 6nat4)</label>
        <input id="f-gname" type="text" value="${escHtml(group.name)}" />
      </div>
      <div class="form-group" style="flex:1.5">
        <label>Jaarlaag</label>
        <div class="btn-toggle-group">
          ${[1, 2, 3, 4, 5, 6]
            .map(
              (n) =>
                `<button class="tog-btn jl-btn${String(group.jaarlaag) === String(n) ? ' selected' : ''}" data-jl="${n}">${n}</button>`
            )
            .join('')}
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>Leerlingen</label>
      <div class="checkbox-list" id="f-gstudents">
        ${students
          .map(
            (s) => `
          <label class="checkbox-item">
            <input type="checkbox" value="${s.id}" ${group.student_ids.includes(s.id) ? 'checked' : ''} />
            ${escHtml(Store.fullName(s))} <span class="muted">(${s.id})</span>
          </label>`
          )
          .join('')}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-g-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      // Jaarlaag toggle buttons
      el.querySelectorAll('.jl-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          el.querySelectorAll('.jl-btn').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });

      el.querySelector('#f-g-save').addEventListener('click', async () => {
        const name = el.querySelector('#f-gname').value.trim();
        const jlBtn = el.querySelector('.jl-btn.selected');
        const jaarlaag = jlBtn ? jlBtn.dataset.jl : '';
        const ids = [...el.querySelectorAll('#f-gstudents input:checked')].map((i) =>
          Number(i.value)
        );
        if (!name) {
          toast('Vul een naam in.', 'error');
          return;
        }
        const gid = id || Store.makeGroupId(name, year);
        await Store.upsertGroup({ id: gid, name, jaarlaag, student_ids: ids }, year);
        closeModal();
        toast('Groep opgeslagen.', 'success');
        renderGroepen();
      });
    }
  );
}

export async function deleteGroup(id) {
  if (!confirm('Groep verwijderen?')) return;
  const year = SEL.groupsYear.getValue() || Store.getConfigSync().activeYear;
  await Store.deleteGroup(id, year);
  toast('Groep verwijderd.', 'info');
  renderGroepen();
}

export async function openGroupCSVImport() {
  const cfg = await Store.getConfig();
  const existingYears = Store.listYearsSync();
  const ui = { showModal, closeModal, toast, overlay: overlayElement };
  const year = await askSchoolYear(cfg.activeYear, existingYears, ui);
  if (!year) return;

  showModal(
    `
    <h3>Groepen importeren — ${escHtml(year)}</h3>
    <p class="muted" style="margin-bottom:12px">
      Verwachte kolommen: <code>Jaarlaag, Groep, Leerlingnummer</code>
    </p>
    <div class="form-group">
      <label>CSV-bestand</label>
      <input type="file" id="f-csv-groups" accept=".csv,.txt" />
    </div>
    <div id="csv-grp-preview"></div>
    <div class="form-actions" style="margin-top:12px">
      <button class="btn-primary" id="f-csv-grp-import" disabled>Importeren</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      let groupMap = null;
      el.querySelector('#f-csv-groups').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const { rows } = parseCSV(await file.text());
        groupMap = {};
        for (const r of rows) {
          const jaarlaag = String(r['Jaarlaag'] ?? r['jaarlaag'] ?? '').trim();
          const naam = (r['Groep'] ?? r['groep'] ?? '').trim();
          const llnr = Number(r['Leerlingnummer'] ?? r['leerlingnummer']);
          if (!naam || !llnr) continue;
          if (!groupMap[naam]) groupMap[naam] = { jaarlaag, name: naam, student_ids: [] };
          if (!groupMap[naam].student_ids.includes(llnr)) groupMap[naam].student_ids.push(llnr);
        }
        const entries = Object.values(groupMap);
        el.querySelector('#csv-grp-preview').innerHTML =
          entries.length === 0
            ? '<p class="hint">Geen groepen gevonden.</p>'
            : `<p style="margin:8px 0 4px"><strong>${entries.length}</strong> groepen:</p>
           <table class="preview-table">
             <thead><tr><th>Groep</th><th>Jaarlaag</th><th>Leerlingen</th></tr></thead>
             <tbody>${entries
               .map(
                 (g) =>
                   `<tr><td>${escHtml(g.name)}</td><td>${escHtml(g.jaarlaag)}</td><td>${g.student_ids.length}</td></tr>`
               )
               .join('')}</tbody></table>`;
        el.querySelector('#f-csv-grp-import').disabled = entries.length === 0;
      });
      el.querySelector('#f-csv-grp-import').addEventListener('click', async () => {
        if (!groupMap) return;
        const toSave = Object.values(groupMap).map((g) => ({
          id: Store.makeGroupId(g.name, year),
          name: g.name,
          jaarlaag: g.jaarlaag,
          student_ids: g.student_ids,
        }));
        await Store.upsertGroups(toSave, year);
        closeModal();
        toast(`${toSave.length} groepen geïmporteerd voor ${year}.`, 'success');
        renderGroepen();
      });
    }
  );
}
