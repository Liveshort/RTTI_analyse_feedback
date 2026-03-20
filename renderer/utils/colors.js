// ── Color utilities ───────────────────────────────────────────────────────────

/**
 * Returns the badge/bar colour for an exam based on its type field.
 *   'pta' → red, 'po' → amber/yellow, anything else → blue
 */
export function examTypeColor(exam) {
  if (exam?.type === 'pta') return '#d9534f';
  if (exam?.type === 'po') return '#f0ad4e';
  return '#4A90D9'; // regular toets
}

export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function lerpColor(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1),
    [r2, g2, b2] = hexToRgb(hex2);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

export function stdDevGradeColor(sdStr) {
  if (!sdStr) return null;
  const n = parseFloat(String(sdStr).replace(',', '.'));
  if (isNaN(n)) return null;
  const t = Math.min(1, n / 2.0);
  if (t <= 0.5) return lerpColor('#c3e6cb', '#fff3cd', t * 2);
  return lerpColor('#fff3cd', '#f8d7da', (t - 0.5) * 2);
}

export function gradeColor(gradeStr) {
  if (!gradeStr || gradeStr === '—') return null;
  const n = parseFloat(String(gradeStr).replace(',', '.'));
  if (isNaN(n)) return null;
  if (n < 5.5) return '#f8d7da';
  return lerpColor('#fff3cd', '#c3e6cb', (n - 5.5) / 4.5);
}

export function rttiPctColor(valStr) {
  if (!valStr || valStr === 'NVT') return null;
  const pct = parseInt(valStr);
  if (isNaN(pct)) return null;
  const t = Math.max(0, Math.min(100, pct)) / 100;
  return t <= 0.5
    ? lerpColor('#f8d7da', '#fff3cd', t * 2)
    : lerpColor('#fff3cd', '#c3e6cb', (t - 0.5) * 2);
}
