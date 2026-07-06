// Searchable compound combobox — replaces the native <select> for picking a
// crop/compound. Shows icon + name + price + delta, type-to-filter, optional
// category grouping, full keyboard nav. Vanilla, no dependencies.
// Exposes window.createCompoundCombobox(opts) -> { getValue, setValue, focus }.
(function () {
  'use strict';

  const ICON_BASE = '/static/icons/';
  const ICON_VER = '?v=tp1';
  const GROUPS = [
    ['base', 'Raw Crops'],
    ['processed', 'Processed'],
    ['combo', 'Combos'],
  ];

  function fmtPrice(p) {
    return p == null ? '' : '$' + Number(p).toFixed(2);
  }

  function deltaInfo(item) {
    if (item.price == null || item.prevPrice == null) return null;
    const d = item.price - item.prevPrice;
    if (Math.abs(d) < 0.005) return null;
    return { up: d > 0, text: (d > 0 ? '+' : '') + d.toFixed(2) };
  }

  function rowHtml(item, idx) {
    const icon = item.icon
      ? `<img class="cbx-opt-icon" src="${ICON_BASE}${item.icon}${ICON_VER}" alt="" />`
      : `<span class="cbx-opt-icon cbx-opt-emoji">${item.emoji || ''}</span>`;
    const delta = deltaInfo(item);
    const deltaHtml = delta
      ? `<span class="cbx-opt-delta ${delta.up ? 'up' : 'down'}">${delta.text}</span>`
      : '';
    return `<li class="cbx-opt" role="option" id="cbx-opt-${idx}" data-id="${item.id}" aria-selected="false">`
      + icon
      + `<span class="cbx-opt-name">${item.name}</span>`
      + `<span class="cbx-opt-price">${fmtPrice(item.price)}</span>`
      + deltaHtml
      + `</li>`;
  }

  window.createCompoundCombobox = function (opts) {
    const mount = typeof opts.mount === 'string'
      ? document.querySelector(opts.mount) : opts.mount;
    if (!mount) return { getValue: () => '', setValue() {}, focus() {} };

    const items = opts.items || [];
    const grouped = !!opts.grouped;
    const placeholder = opts.placeholder || 'Search…';
    const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () {};

    let selectedId = '';
    let open = false;
    let activeIdx = -1; // index into `visible`, matching the .cbx-opt DOM order
    let visible = [];

    mount.classList.add('cbx');
    mount.innerHTML =
      '<div class="cbx-field">'
      + '<img class="cbx-field-icon" alt="" hidden />'
      + `<input class="cbx-input" type="text" role="combobox" aria-autocomplete="list" `
      + `aria-expanded="false" autocomplete="off" spellcheck="false" placeholder="${placeholder}" />`
      + '</div>'
      + '<ul class="cbx-list" role="listbox" hidden></ul>';

    const field = mount.querySelector('.cbx-field');
    const fieldIcon = mount.querySelector('.cbx-field-icon');
    const input = mount.querySelector('.cbx-input');
    const list = mount.querySelector('.cbx-list');

    const itemById = (id) => items.find((i) => i.id === id);

    function setFieldDisplay(id) {
      const it = id ? itemById(id) : null;
      if (it) {
        input.value = it.name;
        if (it.icon) { fieldIcon.src = ICON_BASE + it.icon + ICON_VER; fieldIcon.hidden = false; }
        else { fieldIcon.hidden = true; }
      } else {
        input.value = '';
        fieldIcon.hidden = true;
      }
    }

    function render(query) {
      const q = (query || '').trim().toLowerCase();
      const matched = items.filter((it) =>
        !q || it.name.toLowerCase().includes(q)
        || (it.minecraft_name && it.minecraft_name.toLowerCase().includes(q)));

      if (!matched.length) {
        visible = [];
        activeIdx = -1;
        list.innerHTML = '<li class="cbx-empty" aria-disabled="true">No matches</li>';
        return;
      }

      let html = '';
      let idx = 0;
      const ordered = [];
      if (grouped) {
        GROUPS.forEach(([cat, label]) => {
          const gitems = matched.filter((it) => it.category === cat);
          if (!gitems.length) return;
          html += `<li class="cbx-group" role="presentation">${label}</li>`;
          gitems.forEach((it) => { html += rowHtml(it, idx); idx++; ordered.push(it); });
        });
        const known = GROUPS.map((g) => g[0]);
        matched.filter((it) => !known.includes(it.category))
          .forEach((it) => { html += rowHtml(it, idx); idx++; ordered.push(it); });
      } else {
        matched.forEach((it) => { html += rowHtml(it, idx); idx++; ordered.push(it); });
      }
      visible = ordered;
      activeIdx = -1;
      list.innerHTML = html;
    }

    function positionList() {
      const rect = field.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const flip = spaceBelow < 160 && spaceAbove > spaceBelow;
      mount.classList.toggle('cbx-flip', flip);
      const available = (flip ? spaceAbove : spaceBelow) - 12;
      list.style.maxHeight = Math.max(120, Math.min(320, available)) + 'px';
    }

    function openList() {
      if (open) return;
      open = true;
      render(selectedId ? '' : input.value);
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      mount.classList.add('cbx-open');
      positionList();
    }

    function closeList(restore) {
      if (!open) return;
      open = false;
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      mount.classList.remove('cbx-open');
      activeIdx = -1;
      if (restore !== false) setFieldDisplay(selectedId);
    }

    function highlight(i) {
      const optEls = list.querySelectorAll('.cbx-opt');
      optEls.forEach((o) => o.classList.remove('cbx-active'));
      if (i < 0 || i >= optEls.length) {
        activeIdx = -1;
        input.removeAttribute('aria-activedescendant');
        return;
      }
      activeIdx = i;
      const el = optEls[i];
      el.classList.add('cbx-active');
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    }

    function choose(id) {
      selectedId = id;
      setFieldDisplay(id);
      closeList(false);
      onSelect(id);
    }

    field.addEventListener('mousedown', (e) => {
      if (e.target !== input) { e.preventDefault(); input.focus(); openList(); }
    });
    input.addEventListener('focus', openList);
    input.addEventListener('click', openList);
    input.addEventListener('input', () => { openList(); render(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) openList();
        highlight(Math.min(activeIdx + 1, visible.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight(Math.max(activeIdx - 1, 0));
      } else if (e.key === 'Enter') {
        if (open && activeIdx >= 0 && visible[activeIdx]) {
          e.preventDefault();
          choose(visible[activeIdx].id);
        }
      } else if (e.key === 'Escape') {
        if (open) { e.preventDefault(); closeList(true); }
      }
    });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('.cbx-opt');
      if (!li || !li.dataset.id) return;
      e.preventDefault();
      choose(li.dataset.id);
    });
    document.addEventListener('pointerdown', (e) => {
      if (open && !mount.contains(e.target)) closeList(true);
    });

    setFieldDisplay('');

    return {
      getValue: () => selectedId,
      setValue: (id) => { selectedId = id || ''; setFieldDisplay(selectedId); },
      focus: () => input.focus(),
    };
  };
})();
