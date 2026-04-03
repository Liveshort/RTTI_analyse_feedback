import { navigateTo, showSubjectBadge } from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Startup — subject picker
// ═══════════════════════════════════════════════════════════════════════════════

const SUBJECT_EMOJI = { nat: '⚡', bio: '🌱', schk: '⚗️', wi: '📐' };

export function renderStartup() {
  const container = document.getElementById('screen-startup');
  container.innerHTML = `
    <div class="startup-screen">
      <h1 class="startup-title">Maatwerk</h1>
      <p class="startup-hint">Selecteer een vak om te beginnen</p>
      <div class="subject-grid">
        ${Object.entries(Store.SUBJECT_DISPLAY)
          .map(
            ([key, label]) => `
          <button class="subject-card" data-subject="${key}">
            <span class="subject-emoji">${SUBJECT_EMOJI[key] ?? ''}</span>
            <span class="subject-label">${label}</span>
          </button>`
          )
          .join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('[data-subject]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const subject = btn.dataset.subject;
      await Store.initSubject(subject);
      showSubjectBadge(subject);
      navigateTo('leerlingen');
    })
  );
}
