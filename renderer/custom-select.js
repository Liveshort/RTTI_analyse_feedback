/**
 * CustomSelect — lightweight div-based dropdown that replaces <select>.
 * Bypasses the native OS control so Electron never triggers the black-box flash.
 *
 * Usage:
 *   const sel = new CustomSelect(document.getElementById('my-host'), {
 *     placeholder: '— kies —',
 *     onChange: (value) => console.log(value),
 *   });
 *   sel.setOptions([{ value: '2025-2026', label: '2025-2026' }, ...]);
 *   sel.setValue('2025-2026');
 *   sel.getValue();          // → '2025-2026'
 *   sel.setDisabled(true);
 */
class CustomSelect {
  constructor(host, { placeholder = '—', onChange = null, disabled = false } = {}) {
    this._host        = host;
    this._placeholder = placeholder;
    this._onChange    = onChange;
    this._value       = null;
    this._options     = [];
    this._disabled    = disabled;
    this._open        = false;

    // ── Build DOM ──
    host.classList.add('csel');

    this._trigger = document.createElement('button');
    this._trigger.type = 'button';
    this._trigger.className = 'csel-trigger';
    this._trigger.setAttribute('aria-haspopup', 'listbox');
    this._trigger.setAttribute('aria-expanded', 'false');

    this._dropdown = document.createElement('div');
    this._dropdown.className = 'csel-dropdown';
    this._dropdown.setAttribute('role', 'listbox');

    host.appendChild(this._trigger);
    host.appendChild(this._dropdown);

    this._renderTrigger();

    // ── Events ──
    this._trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._disabled) return;
      this._open ? this._close() : this._openDropdown();
    });

    this._dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('[data-value]');
      if (!item) return;
      this._select(item.dataset.value);
    });

    // Close on outside click
    document.addEventListener('click', this._outsideClick = () => {
      if (this._open) this._close();
    });

    // Close on Escape
    document.addEventListener('keydown', this._keydown = (e) => {
      if (e.key === 'Escape' && this._open) this._close();
    });

    if (disabled) this._setDisabledState(true);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setOptions(options) {
    // options: [{ value, label }]
    this._options = options;
    this._dropdown.innerHTML = options.map(o => `
      <div class="csel-option${o.value === this._value ? ' csel-option--selected' : ''}"
           role="option" data-value="${escHtmlCS(o.value)}"
           aria-selected="${o.value === this._value}">
        ${escHtmlCS(o.label)}
      </div>`).join('');
    // If current value no longer in options, reset to first option
    if (options.length && !options.find(o => o.value === this._value)) {
      this._value = options[0].value;
    }
    this._renderTrigger();
  }

  getValue() { return this._value; }

  setValue(v) {
    this._value = v ?? null;
    this._renderTrigger();
    this._dropdown.querySelectorAll('[data-value]').forEach(el => {
      const sel = el.dataset.value === String(v ?? '');
      el.classList.toggle('csel-option--selected', sel);
      el.setAttribute('aria-selected', sel);
    });
  }

  onChange(fn) { this._onChange = fn; }

  setDisabled(bool) {
    this._disabled = bool;
    this._setDisabledState(bool);
    if (bool && this._open) this._close();
  }

  destroy() {
    document.removeEventListener('click', this._outsideClick);
    document.removeEventListener('keydown', this._keydown);
    this._host.innerHTML = '';
    this._host.classList.remove('csel');
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _select(value) {
    if (value === this._value) { this._close(); return; }
    this._value = value;
    this._renderTrigger();
    this._dropdown.querySelectorAll('[data-value]').forEach(el => {
      const sel = el.dataset.value === value;
      el.classList.toggle('csel-option--selected', sel);
      el.setAttribute('aria-selected', sel);
    });
    this._close();
    if (this._onChange) this._onChange(value);
  }

  _renderTrigger() {
    const opt = this._options.find(o => o.value === this._value);
    const label = opt ? opt.label : this._placeholder;
    this._trigger.innerHTML = `<span class="csel-label">${escHtmlCS(label)}</span><span class="csel-arrow">▾</span>`;
  }

  _openDropdown() {
    this._open = true;
    this._host.classList.add('csel--open');
    this._trigger.setAttribute('aria-expanded', 'true');

    // Use fixed positioning so the dropdown escapes modal overflow:hidden
    const rect    = this._trigger.getBoundingClientRect();
    const dropH   = Math.min(this._options.length * 34 + 8, 280);
    const dropW   = rect.width;
    const below   = window.innerHeight - rect.bottom;
    const above   = rect.top;

    this._dropdown.style.position = 'fixed';
    this._dropdown.style.width    = dropW + 'px';
    this._dropdown.style.left     = rect.left + 'px';

    if (below < dropH && above > dropH) {
      this._dropdown.style.bottom = (window.innerHeight - rect.top) + 'px';
      this._dropdown.style.top    = 'auto';
      this._host.classList.add('csel--up');
    } else {
      this._dropdown.style.top    = rect.bottom + 'px';
      this._dropdown.style.bottom = 'auto';
      this._host.classList.remove('csel--up');
    }
  }

  _close() {
    this._open = false;
    this._host.classList.remove('csel--open');
    this._trigger.setAttribute('aria-expanded', 'false');
  }

  _setDisabledState(bool) {
    this._host.classList.toggle('csel--disabled', bool);
    this._trigger.disabled = bool;
  }
}

// Local escaper so this file has no external dependency
function escHtmlCS(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
