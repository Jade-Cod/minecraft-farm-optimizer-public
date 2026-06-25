// Custom dark dropdown + number stepper that replace native <select> / spinner.
// Built to survive the calculator's frequent innerHTML re-renders: a single
// body-portaled menu plus event delegation, so no per-row JS instances exist.
//
// Trigger markup (rendered by app.js):
//   <button class="ui-select" aria-haspopup="listbox" aria-expanded="false"
//           data-value="3" data-onpick="dashSetPurity|cropId|v"
//           data-options='[["0","V0"],["1","V1"],["2","V2"],["3","V3"]]'>
//     <span class="ui-select-text">V3</span> <svg class="ui-select-caret">…</svg>
//   </button>
// On pick it calls window[fn](...args, value), e.g. dashSetPurity(cropId, 'v', '2').
//
// Stepper markup:
//   <div class="ui-stepper">
//     <button class="ui-step" data-dc-id="cropId" data-dc-delta="-0.5">−</button>
//     <input class="ui-step-input" onchange="dashSetDcs('cropId', this.value)">
//     <button class="ui-step" data-dc-id="cropId" data-dc-delta="0.5">+</button>
//   </div>
(function () {
  'use strict';

  const CHECK =
    '<svg class="ui-menu-check" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M2.5 6.5l2.4 2.4 4.6-5.3" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const GAP = 6;          // px between trigger and menu
  const EDGE = 8;         // viewport edge padding
  const STEP_EPS = 2;     // 0.5 stepping → round to nearest half

  let menu = null;        // the single portaled menu element
  let trigger = null;     // currently open trigger, or null
  let opts = [];          // [[value, label], …] for the open trigger
  let active = -1;        // keyboard-highlighted index

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'ui-menu';
    menu.setAttribute('role', 'listbox');
    menu.dataset.open = 'false';
    document.body.appendChild(menu);
    return menu;
  }

  function parseOpts(el) {
    try { return JSON.parse(el.dataset.options || '[]'); }
    catch (e) { return []; }
  }

  function renderItems(curVal) {
    menu.innerHTML = opts.map(([v, label], i) => {
      const sel = v === curVal;
      return `<button type="button" class="ui-menu-item${sel ? ' is-selected' : ''}" ` +
        `role="option" aria-selected="${sel}" data-val="${v}" data-i="${i}">` +
        `<span>${label}</span>${sel ? CHECK : ''}</button>`;
    }).join('');
  }

  // Fixed-position the menu at the trigger, flipping up / clamping to viewport.
  function position() {
    const r = trigger.getBoundingClientRect();
    menu.style.minWidth = r.width + 'px';
    menu.style.left = Math.round(r.left) + 'px';

    const mh = menu.offsetHeight;
    const below = window.innerHeight - r.bottom;
    if (below < mh + GAP + EDGE && r.top > mh + GAP) {
      menu.style.top = Math.round(r.top - mh - GAP) + 'px';
      menu.style.transformOrigin = 'bottom left';
    } else {
      menu.style.top = Math.round(r.bottom + GAP) + 'px';
      menu.style.transformOrigin = 'top left';
    }

    const mw = menu.offsetWidth;
    if (r.left + mw > window.innerWidth - EDGE) {
      menu.style.left = Math.round(window.innerWidth - mw - EDGE) + 'px';
    }
  }

  function open(el) {
    ensureMenu();
    if (trigger === el) { close(); return; }   // toggle
    if (trigger) close();
    trigger = el;
    opts = parseOpts(el);
    const cur = el.dataset.value;
    renderItems(cur);
    position();
    el.setAttribute('aria-expanded', 'true');
    active = Math.max(0, opts.findIndex((o) => o[0] === cur));
    syncActive();
    // Toggle the open state next frame so the scale-in transition runs.
    requestAnimationFrame(() => { if (menu) menu.dataset.open = 'true'; });
  }

  function close() {
    if (!trigger) return;
    trigger.setAttribute('aria-expanded', 'false');
    trigger = null;
    active = -1;
    if (menu) menu.dataset.open = 'false';
  }

  function syncActive() {
    if (!menu) return;
    const items = menu.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', i === active);
    }
    if (items[active]) items[active].scrollIntoView({ block: 'nearest' });
  }

  function pick(val) {
    const el = trigger;
    if (!el) return;
    const spec = (el.dataset.onpick || '').split('|');
    const fn = window[spec[0]];
    const args = spec.slice(1).concat(val);
    close();
    if (typeof fn === 'function') fn.apply(null, args);
  }

  // ── Number stepper ──────────────────────────────────────────────────────
  function doStep(btn) {
    const id = btn.dataset.dcId;
    const delta = parseFloat(btn.dataset.dcDelta) || 0;
    const input = btn.parentElement.querySelector('.ui-step-input');
    const cur = parseFloat(input && input.value) || 0;
    let next = Math.round((cur + delta) * STEP_EPS) / STEP_EPS;  // snap to 0.5
    if (next < 0) next = 0;
    if (typeof window.dashSetDcs === 'function') window.dashSetDcs(id, String(next));
  }

  // ── Delegation ──────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const item = menu && e.target.closest('.ui-menu-item');
    if (item && menu.contains(item)) { pick(item.dataset.val); return; }

    const trig = e.target.closest('.ui-select');
    if (trig) { e.preventDefault(); open(trig); return; }

    const step = e.target.closest('.ui-step');
    if (step) { e.preventDefault(); doStep(step); return; }

    if (trigger && !(menu && menu.contains(e.target))) close();
  });

  document.addEventListener('keydown', (e) => {
    if (!trigger) {
      const f = document.activeElement;
      if (f && f.classList && f.classList.contains('ui-select') &&
          (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
        e.preventDefault();
        open(f);
      }
      return;
    }
    switch (e.key) {
      case 'Escape':    { e.preventDefault(); const t = trigger; close(); t.focus(); break; }
      case 'ArrowDown': e.preventDefault(); active = Math.min(opts.length - 1, active + 1); syncActive(); break;
      case 'ArrowUp':   e.preventDefault(); active = Math.max(0, active - 1); syncActive(); break;
      case 'Home':      e.preventDefault(); active = 0; syncActive(); break;
      case 'End':       e.preventDefault(); active = opts.length - 1; syncActive(); break;
      case 'Enter':
      case ' ':         e.preventDefault(); if (active >= 0 && opts[active]) pick(opts[active][0]); break;
      case 'Tab':       close(); break;
    }
  });

  // Reposition is cheap to skip — just dismiss on scroll/resize.
  window.addEventListener('scroll', () => { if (trigger) close(); }, true);
  window.addEventListener('resize', () => { if (trigger) close(); });
})();
