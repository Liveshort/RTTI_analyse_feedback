import { showModal, closeModal, toast, escHtml, SEL, overlayElement, getWiFilter } from '../app.js';
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

const SUBCATEGORY_TO_FILTER = {
  onderbouw: 'OB',
  wisa: 'WisA',
  wisb: 'WisB',
  wisc: 'WisC',
  wisd: 'WisD',
};

export function renderGroepenForYear(year) {
  let groups = Store.getGroupsSync(year);
  const students = Store.getStudentsSync(year);
  const container = document.getElementById('group-list');

  // Apply wi-filter when wiskunde is the active subject
  if (Store.getActiveSubject() === 'wi') {
    const wiFilter = getWiFilter();
    groups = groups.filter((g) => {
      const filterKey = SUBCATEGORY_TO_FILTER[g.subcategory ?? ''];
      return filterKey ? wiFilter.has(filterKey) : true;
    });
  }

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
          <button class="btn-sm btn-sm-icon" data-action="edit-group" data-id="${escHtml(g.id)}" title="Groep bewerken">✎</button>
          <button class="btn-sm btn-danger btn-sm-icon" data-action="del-group" data-id="${escHtml(g.id)}"${g.student_ids.length > 0 ? ' disabled title="Deze groep heeft leerlingen en kan dus niet worden verwijderd."' : ' title="Groep verwijderen"'}>🗑</button>
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
  const subject = Store.getActiveSubject();
  const students = await Store.getStudents(year);
  students.sort((a, b) => {
    const scmp = (a.stamklas ?? '').localeCompare(b.stamklas ?? '');
    if (scmp !== 0) return scmp;
    return (a.achternaam ?? '').localeCompare(b.achternaam ?? '');
  });

  let group = { id: '', name: '', jaarlaag: '', student_ids: [] };
  let groupsInJaarlaag = [];

  if (id) {
    const all = await Store.getGroups(year);
    group = JSON.parse(JSON.stringify(all.find((g) => g.id === id) ?? group));
    groupsInJaarlaag = Store.getGroupsSync(year)
      .filter((g) => String(g.jaarlaag) === String(group.jaarlaag))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const hasStudents = group.student_ids.length > 0;
  const isEdit = !!id;

  let studentsSection;
  if (isEdit) {
    const headerCols = groupsInJaarlaag
      .map((g) => `<th class="gst-group-th">${escHtml(g.name)}</th>`)
      .join('');
    const rows = students
      .map((s) => {
        const jl = Store.jaarlaagFromStamklas(s.stamklas);
        const cols = groupsInJaarlaag
          .map((g) => {
            const checked = g.student_ids.includes(s.id) ? 'checked' : '';
            return `<td class="gst-check-td"><input type="checkbox"
              data-student-id="${s.id}"
              data-group-id="${escHtml(g.id)}"
              data-subcategory="${escHtml(g.subcategory ?? '')}"
              ${checked} /></td>`;
          })
          .join('');
        return `<tr data-student-id="${s.id}" data-stamklas-jl="${escHtml(jl)}">
          <td>${escHtml(Store.fullName(s))}</td>
          <td class="gst-stamklas">${escHtml(s.stamklas ?? '')}</td>
          ${cols}
        </tr>`;
      })
      .join('');

    studentsSection = `
      <div class="gst-label-row">
        <label>Leerlingen</label>
        ${group.jaarlaag ? `<button type="button" id="f-g-jl-filter" class="btn-sm btn-primary" data-active="1">Alleen leerlingen van jaarlaag ${escHtml(String(group.jaarlaag))} tonen</button>` : ''}
      </div>
      <div class="gst-scroll">
        <table class="gst-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Stamklas</th>
              ${headerCols}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  showModal(
    `
    <h3>${id ? 'Groep bewerken' : 'Groep toevoegen'}</h3>
    <div class="form-group">
      <label>Naam (bijv. 6nat4 of 2anat)</label>
      <input id="f-gname" type="text" value="${escHtml(group.name)}" ${hasStudents ? 'disabled' : ''} />
      <span class="form-hint muted">${
        hasStudents
          ? 'Naam kan niet worden gewijzigd zolang er leerlingen in de groep zitten.'
          : isEdit
            ? 'Jaarlaag wordt afgeleid van het eerste cijfer in de naam.'
            : 'Jaarlaag wordt afgeleid van het eerste cijfer in de naam. Leerlingen kunnen worden toegevoegd nadat de groep is aangemaakt.'
      }</span>
    </div>
    ${isEdit ? `<div class="form-group">${studentsSection}</div>` : ''}
    <div class="form-actions">
      <button class="btn-primary" id="f-g-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      // Filter button: toggle showing only students from this group's jaarlaag
      const filterBtn = el.querySelector('#f-g-jl-filter');
      const applyFilter = (active) => {
        el.querySelectorAll('tbody tr').forEach((row) => {
          row.style.display =
            !active || row.dataset.stamklasJl === String(group.jaarlaag) ? '' : 'none';
        });
      };
      if (filterBtn) {
        // Apply filter immediately on open
        applyFilter(true);
        filterBtn.addEventListener('click', () => {
          const isActive = filterBtn.dataset.active === '1';
          filterBtn.dataset.active = isActive ? '0' : '1';
          filterBtn.classList.toggle('btn-primary', !isActive);
          filterBtn.classList.toggle('btn-secondary', isActive);
          applyFilter(!isActive);
        });
      }

      // Conflict resolution: checking a box may uncheck others for the same student
      if (isEdit) {
        el.querySelector('tbody').addEventListener('change', (e) => {
          if (e.target.type !== 'checkbox' || !e.target.checked) return;
          const sid = e.target.dataset.studentId;
          const sub = e.target.dataset.subcategory;
          el.querySelectorAll(`tbody input[type="checkbox"][data-student-id="${sid}"]`).forEach(
            (cb) => {
              if (cb === e.target) return;
              if (subject === 'wi') {
                // Wiskunde: only conflict within the same non-empty subcategory
                if (sub && cb.dataset.subcategory === sub) cb.checked = false;
              } else {
                // Other subjects: student can only be in one group
                cb.checked = false;
              }
            }
          );
        });
      }

      el.querySelector('#f-g-save').addEventListener('click', async () => {
        const name = hasStudents ? group.name : el.querySelector('#f-gname').value.trim();
        if (!name) {
          toast('Vul een naam in.', 'error');
          return;
        }

        const parsed = Store.parseGroupName(name, subject);
        if (!parsed.jaarlaag) {
          toast(
            'Kan de jaarlaag niet afleiden uit de naam. Begin de naam met een cijfer (bijv. 4nat1).',
            'error'
          );
          return;
        }
        if (subject === 'wi' && !parsed.subcategory) {
          toast(
            'Kan de subcategorie niet afleiden uit de naam. Gebruik bijv. 4wisa1, 5wisb2 of 3wi1 voor onderbouw.',
            'error'
          );
          return;
        }

        if (isEdit) {
          // Collect new student_ids per group from table checkboxes
          const byGroup = {};
          groupsInJaarlaag.forEach((g) => (byGroup[g.id] = []));
          el.querySelectorAll('tbody input[type="checkbox"]:checked').forEach((cb) => {
            if (byGroup[cb.dataset.groupId])
              byGroup[cb.dataset.groupId].push(Number(cb.dataset.studentId));
          });

          const allGroups = await Store.getGroups(year);
          for (const g of groupsInJaarlaag) {
            const existing = allGroups.find((ag) => ag.id === g.id);
            if (!existing) continue;
            const newIds = byGroup[g.id] ?? [];
            const nameChanged = g.id === id && !hasStudents && name !== existing.name;
            const idsChanged =
              [...existing.student_ids].sort((a, b) => a - b).join(',') !==
              [...newIds].sort((a, b) => a - b).join(',');
            if (!idsChanged && !nameChanged) continue;

            let updated = { ...existing, student_ids: newIds };
            if (nameChanged) {
              updated = {
                ...updated,
                name,
                jaarlaag: parsed.jaarlaag,
                subcategory: parsed.subcategory ?? undefined,
              };
            }
            await Store.upsertGroup(updated, year);
          }
        } else {
          const ids = [...el.querySelectorAll('#f-gstudents input:checked')].map((i) =>
            Number(i.value)
          );
          const gid = Store.makeGroupId(name, year);
          await Store.upsertGroup(
            {
              id: gid,
              name,
              jaarlaag: parsed.jaarlaag,
              subcategory: parsed.subcategory ?? undefined,
              student_ids: ids,
            },
            year
          );
        }

        closeModal();
        toast('Groep opgeslagen.', 'success');
        renderGroepen();
      });
    },
    'modal-xl'
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
        const subject = Store.getActiveSubject();
        const toSave = Object.values(groupMap).map((g) => {
          const parsed = Store.parseGroupName(g.name, subject);
          return {
            id: Store.makeGroupId(g.name, year),
            name: g.name,
            jaarlaag: parsed.jaarlaag ?? g.jaarlaag,
            subcategory: parsed.subcategory ?? undefined,
            student_ids: g.student_ids,
          };
        });
        await Store.upsertGroups(toSave, year);
        closeModal();
        toast(`${toSave.length} groepen geïmporteerd voor ${year}.`, 'success');
        renderGroepen();
      });
    }
  );
}
