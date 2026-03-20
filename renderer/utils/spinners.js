// ── Numeric spinner helpers ───────────────────────────────────────────────────

/**
 * Wire all .num-spinner elements inside `root`.
 * The spinner stores its current numeric value in data-val.
 * Displays with comma decimal separator.
 */
export function wireSpinners(root) {
  root.querySelectorAll('.num-spinner').forEach((sp) => {
    const step = parseFloat(sp.dataset.step ?? 1);
    const min = parseFloat(sp.dataset.min ?? 0);
    const max = parseFloat(sp.dataset.max ?? 999);
    const dec = (() => {
      const s = step.toString();
      const i = s.indexOf('.');
      return i < 0 ? 0 : s.length - i - 1;
    })();
    const inp = sp.querySelector('.spin-val');

    function set(v) {
      v = Math.min(max, Math.max(min, Math.round(v / step) * step));
      v = parseFloat(v.toFixed(dec));
      sp.dataset.val = v;
      inp.value = v.toFixed(dec).replace('.', ',');
    }

    sp.querySelector('.spin-minus').addEventListener('click', () =>
      set(parseFloat(sp.dataset.val) - step)
    );
    sp.querySelector('.spin-plus').addEventListener('click', () =>
      set(parseFloat(sp.dataset.val) + step)
    );

    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value.replace(',', '.'));
      if (!isNaN(v)) set(v);
      else inp.value = parseFloat(sp.dataset.val).toFixed(dec).replace('.', ',');
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        set(parseFloat(sp.dataset.val) + step);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        set(parseFloat(sp.dataset.val) - step);
      }
    });
  });
}

/** Read the current numeric value from a .num-spinner element. */
export function spinnerValue(sp) {
  return parseFloat(
    (sp?.dataset?.val ?? sp?.querySelector?.('.spin-val')?.value ?? '0').replace(',', '.')
  );
}
