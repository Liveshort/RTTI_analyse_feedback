// ── Grade coloring & grouping utilities ──────────────────────────────────────
import { lerpColor } from './colors.js';
import { formatGrade } from '../app.js';

// ── Grade-group constants (histogram buckets) ────────────────────────────────
export const GRADE_GROUP_LABELS = ['<4', '4–5', '5–6', '6–7', '7–8', '>8'];
export const GRADE_GROUP_MIDPOINTS = [2.5, 4.5, 5.5, 6.5, 7.5, 9.0];

export function gradeGroupIdx(g) {
  if (g < 4) return 0;
  if (g < 5) return 1;
  if (g < 6) return 2;
  if (g < 7) return 3;
  if (g < 8) return 4;
  return 5;
}

// Same gradient used in chart datasets: flat red below 5.5, yellow→green above.
export function gradeChartColor(g) {
  return g < 5.5 ? '#e57373' : lerpColor('#ffd54f', '#66bb6a', Math.min((g - 5.5) / 4.5, 1));
}

// ── Grade text / border colors (for inline grade badges) ─────────────────────
export function gradeTextColor(g) {
  if (g === null) return '#aaa';
  if (g < 5.5) return '#c0392b';
  return lerpColor('#b8860b', '#2e7d32', (g - 5.5) / 4.5);
}

export function gradeBorderColor(g) {
  if (g === null) return '#ddd';
  if (g < 5.5) return '#e57373';
  return lerpColor('#ffd54f', '#66bb6a', (g - 5.5) / 4.5);
}

// ── Grade badge cell (used in group-students table) ──────────────────────────
export function gradeCell(g) {
  const label = g !== null ? formatGrade(g) : '—';
  const bc = gradeBorderColor(g);
  const tc = gradeTextColor(g);
  const fw = g !== null && g < 5.5 ? 'bold' : '500';
  return `<td style="text-align:center;padding:3px 4px">
      <span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${bc};
        border-radius:4px;font-size:12px;font-weight:${fw};color:${tc}">${label}</span></td>`;
}

// ── Grade stats badge (mean ± sd, % onvoldoende) ─────────────────────────────
export function gradeStatHtml({ mean, sd, fails }) {
  const dotColor = mean < 5.5 ? '#e57373' : lerpColor('#ffd54f', '#66bb6a', (mean - 5.5) / 4.5);
  const dot = `<svg width="10" height="10" viewBox="0 0 10 10" style="vertical-align:middle;margin:0 3px 0 0;flex-shrink:0"><circle cx="5" cy="5" r="5" fill="${dotColor}"/></svg>`;
  return (
    `<span class="muted" style="display:flex;align-items:center;gap:0">` +
    `${dot}${mean.toFixed(1).replace('.', ',')} ± ${sd.toFixed(1).replace('.', ',')}` +
    ` &nbsp;·&nbsp; ${fails}% onvoldoende</span>`
  );
}
