import { navigateTo, showUserBadge } from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Startup — two-step subject + user picker
// ═══════════════════════════════════════════════════════════════════════════════

const SUBJECT_EMOJI = { nat: '⚡', bio: '🌱', schk: '⚗️', wi: '📐' };

export async function renderStartup() {
  const container = document.getElementById('screen-startup');

  const [users, session] = await Promise.all([Store.loadUsers(), Store.loadLastSession()]);

  let selectedSubject = session?.lastSubject ?? null;

  // If the remembered subject no longer exists in SUBJECT_DISPLAY, clear it.
  if (selectedSubject && !Store.SUBJECT_DISPLAY[selectedSubject]) selectedSubject = null;

  function getUsersForSubject(subject) {
    return users.filter((u) => u.actief && !u.isAdmin && u.vakken.includes(subject));
  }

  const adminUser = users.find((u) => u.isAdmin && u.actief) ?? null;

  function renderBadge(user) {
    const shape = user.isAdmin ? 'badge-square' : 'badge-circle';
    const initials = user.afkorting || (user.voornaam[0] ?? '') + (user.achternaam[0] ?? '');
    const fotoAttr = user.foto ? ` data-foto="${user.foto}"` : '';
    return `
      <button class="user-badge ${shape}" data-user-id="${user.id}"
              style="--badge-color: ${user.kleur ?? '#888'}"${fotoAttr}>
        <span class="badge-initials" data-len="${initials.length}">${initials}</span>
        <span class="badge-name">${user.voornaam}</span>
      </button>`;
  }

  function render() {
    const subjectButtons = Object.entries(Store.SUBJECT_DISPLAY)
      .map(([key, label]) => {
        const cls = selectedSubject === key ? 'selected' : selectedSubject ? 'dimmed' : '';
        return `
          <button class="subject-card ${cls}" data-subject="${key}">
            <span class="subject-emoji">${SUBJECT_EMOJI[key] ?? ''}</span>
            <span class="subject-label">${label}</span>
          </button>`;
      })
      .join('');

    let mainContent;
    if (selectedSubject) {
      const subjectUsers = getUsersForSubject(selectedSubject);
      const userBadges = subjectUsers.map(renderBadge).join('');
      const adminBadge = adminUser
        ? `<div class="badge-separator"></div>${renderBadge(adminUser)}`
        : '';
      mainContent = `
        <p class="startup-main-hint">Kies een gebruiker</p>
        <div class="user-badge-grid">
          ${userBadges}
          ${adminBadge}
        </div>`;
    } else {
      mainContent = `<p class="startup-main-hint startup-main-hint--empty">← Selecteer een vak om te beginnen</p>`;
    }

    container.innerHTML = `
      <div class="startup-layout">
        <aside class="startup-sidebar">
          <p class="startup-sidebar-hint">Vak</p>
          ${subjectButtons}
        </aside>
        <main class="startup-main">
          ${mainContent}
        </main>
      </div>`;

    attachListeners();
  }

  async function loadBadgePhotos() {
    const badges = container.querySelectorAll('[data-foto]');
    await Promise.all(
      Array.from(badges).map(async (btn) => {
        const dataUrl = await window.rtti.readPhotoAsDataUrl(btn.dataset.foto);
        if (dataUrl) {
          const initialsEl = btn.querySelector('.badge-initials');
          if (initialsEl) {
            initialsEl.style.backgroundImage = `url(${dataUrl})`;
            initialsEl.style.backgroundSize = 'cover';
            initialsEl.style.backgroundPosition = 'center';
            initialsEl.textContent = '';
          }
        }
      })
    );
  }

  function attachListeners() {
    container.querySelectorAll('[data-subject]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSubject = btn.dataset.subject;
        render();
        loadBadgePhotos();
      });
    });

    container.querySelectorAll('[data-user-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        const user = users.find((u) => u.id === userId);
        if (!user) return;
        Store.setActiveUser(user);
        await Store.initSubject(selectedSubject);
        await Store.saveLastSession(selectedSubject, userId);
        await showUserBadge(user, selectedSubject);
        navigateTo('leerlingen');
      });
    });
  }

  render();
  if (selectedSubject) loadBadgePhotos();
}
