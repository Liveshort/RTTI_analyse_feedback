import { SEL } from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Rapport genereren (Phase 4)
// ═══════════════════════════════════════════════════════════════════════════════

export function renderRapport() {
  const cfg = Store.getConfigSync();
  const exams = Store.getExamsSync(cfg.activeYear);
  SEL.rapportExam.setOptions(
    exams.map((e) => ({
      value: e.id,
      label: (e.volgnummer ? e.volgnummer + ' \u2013 ' : '') + e.title,
    }))
  );
}
