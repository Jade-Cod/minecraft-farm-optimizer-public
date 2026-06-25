const API = '';
window.authUser = null;  // null = guest, object = logged-in user

let allCrops = [];       // always the FULL unfiltered crop list
let fullPriceMap = {};   // name → current_price for all crops
let priceTabCategory = 'all';
let calcStackSize = 1;
let mainChartInstance = null;
let sparklineInstances = {};
let graphsInitialized = false;
let graphHistory = null;
let progressData = null;        // { snapshots:[ms], objectives:[...], inventory_size }
let progChartInstance = null;
let progDropWired = false;
const INV_SIZE = 2304;          // items per inventory (mirrors backend INVENTORY_SIZE)

// ── Auth ──────────────────────────────────────────────────────────────────────

function apiFetch(path, opts = {}) {
  return fetch(path, { credentials: 'include', ...opts });
}

async function fetchAuthState() {
  try {
    const res = await apiFetch('/auth/me');
    window.authUser = res.ok ? await res.json() : null;
  } catch (_) { window.authUser = null; }
  if (window.authUser && !window.authUser.guest) {
    document.body.classList.add('authenticated');
  } else {
    document.body.classList.remove('authenticated');
  }
  renderAuthUI();
}

function renderAuthUI() {
  const menu   = document.getElementById('user-menu');
  const btn    = document.getElementById('auth-btn');
  const avatar = document.getElementById('user-avatar');
  const name   = document.getElementById('user-name');
  if (!menu || !btn) return;
  if (window.authUser && !window.authUser.guest) {
    menu.classList.remove('hidden');
    btn.classList.add('hidden');
    if (avatar && window.authUser.avatar_url) {
      avatar.src = window.authUser.avatar_url;
      avatar.alt = window.authUser.username;
    }
    if (name) name.textContent = window.authUser.username;
  } else {
    menu.classList.add('hidden');
    btn.classList.remove('hidden');
  }
}

async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
  location.reload();
}

const DISCORD_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.102 18.08.114 18.1.128 18.11a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>`;

const UNLOCK_BENEFITS = [
  { icon: '🔁', text: 'Vote timers sync across all your devices' },
  { icon: '🔔', text: 'Get notified the moment every site resets' },
  { icon: '📈', text: 'Track prestige progress across sessions' },
  { icon: '🔐', text: 'Your data, tied to your Discord' },
];

let _unlockPanelVisible = false;

function showUnlockPanel(page) {
  if (_unlockPanelVisible) return;
  _unlockPanelVisible = true;
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  const label = page === 'vote' ? 'Vote Tracking' : 'Prestige Progress';
  const panel = document.createElement('div');
  panel.className = 'unlock-panel';
  panel.id = 'unlock-panel';
  panel.innerHTML = `
    <div class="unlock-card">
      <div class="unlock-lock">🔒</div>
      <div class="unlock-title">${label}</div>
      <ul class="unlock-benefits">
        ${UNLOCK_BENEFITS.map(b => `
          <li class="unlock-benefit">
            <span class="unlock-benefit-icon">${b.icon}</span>
            <span>${b.text}</span>
          </li>`).join('')}
      </ul>
      <a href="/auth/discord/login" class="unlock-discord-btn">
        ${DISCORD_SVG} Login with Discord
      </a>
      <button class="unlock-guest-link" onclick="dismissUnlockPanel()">Continue as guest</button>
    </div>`;
  pageEl.innerHTML = '';
  pageEl.appendChild(panel);
}

function dismissUnlockPanel() {
  _unlockPanelVisible = false;
  const panel = document.getElementById('unlock-panel');
  if (panel) panel.remove();
  location.hash = '#home';
}

const _FIRST_VISIT_KEY = 'mclabs_seen_locked_tabs';

function maybeShowFirstVisitPulse() {
  if (localStorage.getItem(_FIRST_VISIT_KEY)) return;
  if (window.authUser && !window.authUser.guest) return;
  localStorage.setItem(_FIRST_VISIT_KEY, '1');
  setTimeout(() => {
    document.querySelectorAll('.nav-tab[data-gated]').forEach(tab => {
      tab.classList.add('first-visit-pulse');
      tab.addEventListener('animationend', () => tab.classList.remove('first-visit-pulse'), { once: true });
    });
  }, 600);
}

// ── Routing ──────────────────────────────────────────────────────────────────

function getPage() {
  const hash = location.hash.replace('#', '') || 'home';
  return ['home', 'prices', 'calculator', 'ranks', 'graphs', 'prestige', 'progress', 'sushi', 'vote'].includes(hash) ? hash : 'home';
}

const GATED_PAGES = new Set(['vote', 'prestige']);

function navigate() {
  const page = getPage();
  // The Progress tab was merged into Prestige — alias the old route/bookmarks.
  if (page === 'progress') { location.hash = '#prestige'; return; }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('href') === '#' + page);
  });
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');

  // Gate vote/prestige: activate the page so the panel has a container, then show it.
  if (GATED_PAGES.has(page) && (!window.authUser || window.authUser.guest)) {
    showUnlockPanel(page);
    return;
  }
  dismissUnlockPanel();

  if (page === 'graphs' && !graphsInitialized) {
    initGraphs();
  }
  if (page === 'calculator') {
    renderDash();
  }
  if (page === 'sushi') {
    renderSushi();
  }
  if (page === 'vote') {
    renderVoting();
  }
  if (page === 'prestige') {
    renderPrestige();
  }
  if (page === 'ranks' && !ranksInitialized) {
    initRanks();
  }
}

window.addEventListener('hashchange', navigate);

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  await fetchAuthState();
  maybeShowFirstVisitPulse();
  navigate();
  await loadCrops();           // sets allCrops (full), fullPriceMap, contributionMap
  await loadTopStats();
  loadDashState();
  populateDashSelect();
  renderPrestige();
  if (window.authUser && !window.authUser.guest) {
    await loadVoteState();       // server-backed vote timestamps (cross-device)
    scheduleVoteNotification();  // reschedule any pending vote notification
  }
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadCrops() {
  const sort = document.getElementById('sort-select')?.value || 'price';
  // Always fetch the full dataset — category filter is applied locally
  const url = `${API}/api/crops?sort=${sort}`;
  try {
    const res = await apiFetch(url);
    allCrops = await res.json();
    fullPriceMap = Object.fromEntries(allCrops.map(c => [c.name, c.current_price]));
    renderTableFiltered();
    renderHomeTopPrices();
    renderHomeTopCrafts();
    initTableTooltip();
    buildContributionMap();
  } catch (e) {
    const tb = document.getElementById('table-body');
    if (tb) tb.innerHTML = `<tr><td colspan="9" class="loading">Failed to load — is the server running?</td></tr>`;
  }
}

function renderTableFiltered() {
  const display = priceTabCategory === 'all'
    ? allCrops
    : allCrops.filter(c => c.category === priceTabCategory);
  renderTable(display);
}

async function loadTopStats() {
  try {
    const res = await apiFetch(`${API}/api/crops/top`);
    const data = await res.json();

    document.getElementById('stat-best-name').textContent = data.best_price.emoji + ' ' + data.best_price.name;
    document.getElementById('stat-best-price').textContent = '$' + data.best_price.current_price.toFixed(2) + ' per unit';

    document.getElementById('stat-dph-name').textContent = data.best_base_dph.emoji + ' ' + data.best_base_dph.name;
    document.getElementById('stat-dph-val').textContent = '$' + data.best_base_dph.dph.toFixed(2) + '/hr per plant';

    if (data.best_craft_profit) {
      const p = data.best_craft_profit;
      document.getElementById('stat-profit-name').textContent = p.emoji + ' ' + p.name;
      document.getElementById('stat-profit-val').textContent =
        '+$' + p.craft_profit.toFixed(2) + ' per craft (' + p.output_qty + 'x out)';
    }

    if (data.trending_up[0]) {
      document.getElementById('stat-up').textContent = data.trending_up[0].emoji + ' ' + data.trending_up[0].name;
      document.getElementById('stat-up-pct').textContent = '+' + data.trending_up[0].change_pct + '% this week';
    }
  } catch (_) {}
}

// ── Home page helpers ─────────────────────────────────────────────────────────

function renderHomeTopPrices() {
  const sorted = [...allCrops]
    .filter(c => c.current_price != null)
    .sort((a, b) => b.current_price - a.current_price)
    .slice(0, 5);

  const tbody = document.getElementById('home-top-price-body');
  if (!tbody) return;

  const rankSymbols = ['🥇', '🥈', '🥉', '4', '5'];
  tbody.innerHTML = sorted.map((c, i) => {
    const changeClass = (c.change || 0) > 0 ? 'change-pos' : (c.change || 0) < 0 ? 'change-neg' : 'change-neu';
    const changeStr = c.change_pct != null
      ? `<span class="${changeClass}">${c.change_pct > 0 ? '+' : ''}${c.change_pct}%</span>`
      : '<span class="dph-na">—</span>';
    const icon = c.icon
      ? `<img src="/static/icons/${c.icon}?v=tp1" class="table-icon" alt="${c.minecraft_name}" />`
      : `<span class="compound-emoji">${c.emoji}</span>`;
    return `<tr>
      <td class="rank">${rankSymbols[i]}</td>
      <td>${icon}<span class="compound-name">${c.name}</span></td>
      <td class="price">$${c.current_price.toFixed(2)}</td>
      <td>${changeStr}</td>
    </tr>`;
  }).join('');
}

function renderHomeTopCrafts() {
  const sorted = [...allCrops]
    .filter(c => c.craft_profit != null)
    .sort((a, b) => b.craft_profit - a.craft_profit)
    .slice(0, 5);

  const tbody = document.getElementById('home-top-craft-body');
  if (!tbody) return;

  const rankSymbols = ['🥇', '🥈', '🥉', '4', '5'];
  tbody.innerHTML = sorted.map((c, i) => {
    const cls = c.craft_profit > 0 ? 'change-pos' : c.craft_profit < 0 ? 'change-neg' : 'change-neu';
    const sign = c.craft_profit > 0 ? '+' : '';
    const recipeShort = c.recipe
      ? Object.entries(c.recipe).map(([n, q]) => `${q > 1 ? q + '× ' : ''}${n}`).join(' + ')
      : '—';
    const icon = c.icon
      ? `<img src="/static/icons/${c.icon}?v=tp1" class="table-icon" alt="${c.minecraft_name}" />`
      : `<span class="compound-emoji">${c.emoji}</span>`;
    return `<tr>
      <td class="rank">${rankSymbols[i]}</td>
      <td>${icon}<span class="compound-name">${c.name}</span></td>
      <td class="ingredients">${recipeShort}</td>
      <td class="${cls}">${sign}$${c.craft_profit.toFixed(2)}</td>
    </tr>`;
  }).join('');
}

// ── Price table helpers ───────────────────────────────────────────────────────

function formatRecipe(c) {
  if (c.recipe_type === 'raw') {
    return `<span class="ing-raw">${c.minecraft_name}</span>`;
  }
  if (c.recipe_type === 'smelted' && c.recipe) {
    const [name] = Object.keys(c.recipe);
    return `<span class="ing-proc">${name} (smelted)</span>`;
  }
  if (!c.recipe) return '<span class="ing-unknown">Recipe unknown</span>';
  const parts = Object.entries(c.recipe).map(([name, qty]) =>
    `${qty > 1 ? `<b>${qty}x</b> ` : ''}${name}`
  );
  return parts.join(' + ');
}

function renderTable(crops) {
  const searchEl = document.getElementById('search');
  const search = searchEl ? searchEl.value.toLowerCase() : '';
  const filtered = search
    ? crops.filter(c =>
        c.name.toLowerCase().includes(search) ||
        (c.minecraft_name || '').toLowerCase().includes(search) ||
        (c.recipe ? Object.keys(c.recipe).join(' ').toLowerCase().includes(search) : false)
      )
    : crops;

  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading">No results</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((c, i) => {
    const rank = i + 1;
    const rankSymbol = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;

    const changeClass = (c.change || 0) > 0 ? 'change-pos' : (c.change || 0) < 0 ? 'change-neg' : 'change-neu';
    const changeStr = c.change != null
      ? `${c.change > 0 ? '+' : ''}$${Math.abs(c.change).toFixed(2)}`
      : '<span class="dph-na">—</span>';
    const changePctStr = c.change_pct != null
      ? `${c.change_pct > 0 ? '+' : ''}${c.change_pct}%`
      : '<span class="dph-na">—</span>';

    const catClass = c.category === 'base' ? 'badge-base'
      : c.category === 'processed' ? 'badge-proc'
      : 'badge-combo';
    const catLabel = c.category === 'base' ? 'RAW'
      : c.category === 'processed' ? 'PROC'
      : 'COMBO';

    const recipe = formatRecipe(c);
    const outQty = c.output_qty ? `<span class="out-qty">${c.output_qty}x</span>` : '<span class="dph-na">—</span>';
    const price = c.current_price != null ? `$${c.current_price.toFixed(2)}` : '<span class="dph-na">—</span>';

    const dphCell = c.dph != null
      ? `<span class="dph">$${c.dph.toFixed(2)}</span>`
      : `<span class="dph-na">—</span>`;

    let profitCell = '<span class="dph-na">—</span>';
    if (c.craft_profit != null) {
      const cls = c.craft_profit > 0 ? 'change-pos' : c.craft_profit < 0 ? 'change-neg' : 'change-neu';
      const sign = c.craft_profit > 0 ? '+' : '';
      profitCell = `<span class="${cls}">${sign}$${c.craft_profit.toFixed(2)}</span>`;
    }

    const iconHtml = c.icon
      ? `<img src="/static/icons/${c.icon}?v=tp1" class="table-icon" alt="${c.minecraft_name}" />`
      : `<span class="compound-emoji">${c.emoji}</span>`;
    const nameExtra = c.minecraft_name ? `<span class="mc-name">${c.minecraft_name}</span>` : '';

    return `<tr data-id="${c.id}">
      <td class="rank">${rankSymbol}</td>
      <td>
        ${iconHtml}
        <span class="compound-name">${c.name}</span>
        <span class="badge-cat ${catClass}">${catLabel}</span>
        ${nameExtra}
      </td>
      <td class="ingredients">${recipe}</td>
      <td>${outQty}</td>
      <td class="price">${price}</td>
      <td class="${changeClass}">${changeStr}</td>
      <td class="${changeClass}">${changePctStr}</td>
      <td>${dphCell}</td>
      <td>${profitCell}</td>
    </tr>`;
  }).join('');
}

function setPriceTab(tab, el) {
  priceTabCategory = tab;
  document.querySelectorAll('#page-prices .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderTableFiltered();
}

function filterTable() { renderTableFiltered(); }
function reloadTable() { loadCrops(); }

// ── Sync ──────────────────────────────────────────────────────────────────────

async function syncPrices() {
  const btn = document.getElementById('sync-btn');
  const status = document.getElementById('sync-status');
  btn.disabled = true;
  btn.classList.add('syncing');
  const syncLabel = document.getElementById('sync-label');
  if (syncLabel) syncLabel.textContent = 'Syncing…';
  status.textContent = '';
  try {
    const res = await apiFetch(`${API}/api/sync`, { method: 'POST' });
    const data = await res.json();
    status.textContent = `Updated ${data.updated} prices · ${data.synced_at}`;
    await loadCrops();
    await loadTopStats();
    // Refresh graphs if they've been initialized
    if (graphsInitialized) {
      graphHistory = null;
      graphsInitialized = false;
      sparklineInstances = {};
      if (mainChartInstance) { mainChartInstance.destroy(); mainChartInstance = null; }
      initGraphs();
    }
  } catch (e) {
    status.textContent = 'Sync failed';
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.classList.remove('syncing');
    if (syncLabel) syncLabel.textContent = 'Sync Prices';
  }
}

// ── Revenue dashboard calculator ──────────────────────────────────────────────

let dashItems       = [];
let dashCombo       = null;
let graphCombo      = null;
let serverBooster   = false;
let personalBooster = false;
let priceDemand     = 1.0;   // dealer Sell rate (from /rates), applied before boosters
let prestigeDemand  = 1.0;   // dealer Prestige rate
let scoreDemand     = 1.0;   // dealer Score rate
let dealerId        = 'custom';
const DASH_DC = 54 * 64; // 3456 items per double chest

// Chemical purity multipliers — Value/Progress/Score branches, level 0–3 (wiki: Companies#Purity).
const PURITY_MULT = [1.00, 1.15, 1.30, 1.50];

// Dealer rates from the wiki (Dealers). Each dealer has separate sell/prestige/score
// multipliers; "—" on the wiki defaults to 1.0. Rates are dynamic in-game — presets are
// snapshots and stay editable after selection.
const DEALERS = [
  { id: 'custom',         name: 'Custom / from /rates', sell: 1.00, prestige: 1.00, score: 1.00 },
  { id: 'white_commune',  name: 'White (Commune)',      sell: 0.50, prestige: 1.00, score: 1.00 },
  { id: 'white_starter',  name: 'White (Starter)',      sell: 0.75, prestige: 0.75, score: 0.75 },
  { id: 'traveling',      name: 'Traveling',            sell: 1.20, prestige: 1.00, score: 1.00 },
  { id: 'loyalty',        name: 'Loyalty',              sell: 1.00, prestige: 1.00, score: 1.00 },
  { id: 'smuggler',       name: 'Smuggler',             sell: 1.50, prestige: 0.75, score: 0.75 },
];

const DEMAND_MIN = 0.5, DEMAND_MAX = 2.0;

function getDashMult() {
  return (serverBooster ? 2.0 : 1.0) * (personalBooster ? 1.1 : 1.0);
}

// Compact number: 1.2K above a thousand, rounded integer below.
function abbrevNum(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : Math.round(n).toString();
}

function loadDashState() {
  try {
    dashItems       = JSON.parse(localStorage.getItem('dash_items') || '[]');
    serverBooster   = localStorage.getItem('dash_server')    === 'true';
    personalBooster = localStorage.getItem('dash_personal')  === 'true';
    priceDemand     = parseFloat(localStorage.getItem('dash_price_demand'))    || 1.0;
    prestigeDemand  = parseFloat(localStorage.getItem('dash_prestige_demand')) || 1.0;
    scoreDemand     = parseFloat(localStorage.getItem('dash_score_demand'))    || 1.0;
    dealerId        = localStorage.getItem('dash_dealer') || 'custom';
    // Normalise item shape, preserving purity levels (migration drops old mult fields)
    dashItems = dashItems.map(({ id, dcs, pv = 0, pp = 0, ps = 0 }) => ({ id, dcs, pv, pp, ps }));
  } catch { dashItems = []; }
}

function saveDashState() {
  localStorage.setItem('dash_items',           JSON.stringify(dashItems));
  localStorage.setItem('dash_server',          serverBooster);
  localStorage.setItem('dash_personal',        personalBooster);
  localStorage.setItem('dash_price_demand',    priceDemand);
  localStorage.setItem('dash_prestige_demand', prestigeDemand);
  localStorage.setItem('dash_score_demand',    scoreDemand);
  localStorage.setItem('dash_dealer',          dealerId);
}

function setDemand(type, val) {
  const v = Math.min(DEMAND_MAX, Math.max(DEMAND_MIN, parseFloat(val) || 1.0));
  if (type === 'price')    priceDemand    = v;
  if (type === 'prestige') prestigeDemand = v;
  if (type === 'score')    scoreDemand    = v;
  // Editing a rate by hand means it no longer matches a preset dealer
  dealerId = 'custom';
  const dealerEl = document.getElementById('dash-dealer');
  if (dealerEl) setDealerTrigger(dealerEl);
  // Clamp the input itself in case it was out of range
  const el = document.getElementById(`dash-demand-${type}`);
  if (el) el.value = v.toFixed(2);
  saveDashState();
  renderDash();
}

// Pick a dealer preset → pre-fill the three (still-editable) rate fields.
function setDealer(id) {
  const dealer = DEALERS.find(d => d.id === id);
  if (!dealer) return;
  dealerId = id;
  if (id !== 'custom') {
    priceDemand    = dealer.sell;
    prestigeDemand = dealer.prestige;
    scoreDemand    = dealer.score;
  }
  saveDashState();
  renderDash();
}

function toggleServerBooster()   { serverBooster   = !serverBooster;   saveDashState(); renderDash(); }
function togglePersonalBooster() { personalBooster = !personalBooster; saveDashState(); renderDash(); }

// Build the lightweight item shape the searchable combobox consumes.
function comboItems(filterFn) {
  return allCrops
    .filter(c => c.current_price != null && (!filterFn || filterFn(c)))
    .map(c => ({
      id: c.id, name: c.name, minecraft_name: c.minecraft_name,
      price: c.current_price, prevPrice: c.previous_price,
      icon: c.icon, emoji: c.emoji, category: c.category,
    }));
}

function populateDashSelect() {
  const mount = document.getElementById('dash-item-select');
  if (!mount || !allCrops.length || dashCombo) return;
  dashCombo = createCompoundCombobox({
    mount,
    grouped: true,
    placeholder: 'Add a crop or compound…',
    items: comboItems(),
    onSelect: (id) => { addDashItem(id); dashCombo.setValue(''); },
  });
}

// Down-caret used inside every custom .ui-select trigger (see dropdown.js).
const UI_CARET = '<svg class="ui-select-caret" viewBox="0 0 10 6" fill="none" aria-hidden="true">' +
  '<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Sync the dealer .ui-select trigger's stored value + visible label to dealerId.
function setDealerTrigger(el) {
  const d = DEALERS.find(x => x.id === dealerId) || DEALERS[0];
  el.dataset.value = dealerId;
  const label = el.querySelector('.ui-select-text');
  if (label) label.textContent = d.name;
}

// Seed the dealer dropdown's options once from the DEALERS table.
function populateDealerSelect() {
  const el = document.getElementById('dash-dealer');
  if (!el || el.dataset.options) return;
  el.dataset.options = JSON.stringify(DEALERS.map(d => [d.id, d.name]));
  setDealerTrigger(el);
}

function addDashItem(id) {
  if (!id) return;
  if (!dashItems.find(i => i.id === id)) {
    dashItems = [...dashItems, { id, dcs: '', pv: 0, pp: 0, ps: 0 }];
  }
  saveDashState();
  renderDash();
}

// The "+ Add" button — adds whatever is currently selected in the combobox.
function dashAddItem() {
  if (!dashCombo) return;
  addDashItem(dashCombo.getValue());
  dashCombo.setValue('');
}


function dashRemoveItem(id) {
  dashItems = dashItems.filter(i => i.id !== id);
  saveDashState();
  renderDash();
}

function dashSetDcs(id, val) {
  const item = dashItems.find(i => i.id === id);
  if (item) item.dcs = val;
  saveDashState();
  renderDash();
}

// branch is 'v' | 'p' | 's'; level is 0–3 (chemical purity, compounds only)
function dashSetPurity(id, branch, val) {
  const item = dashItems.find(i => i.id === id);
  if (item) item['p' + branch] = Math.min(3, Math.max(0, parseInt(val, 10) || 0));
  saveDashState();
  renderDash();
}

function renderDash() {
  const mult = getDashMult();

  // Sync dealer-rate inputs (only if not focused — don't interrupt typing)
  populateDealerSelect();
  initPurityTips();
  const pdEl  = document.getElementById('dash-demand-price');
  const prdEl = document.getElementById('dash-demand-prestige');
  const scdEl = document.getElementById('dash-demand-score');
  const dlEl  = document.getElementById('dash-dealer');
  if (pdEl  && document.activeElement !== pdEl)  pdEl.value  = priceDemand.toFixed(2);
  if (prdEl && document.activeElement !== prdEl) prdEl.value = prestigeDemand.toFixed(2);
  if (scdEl && document.activeElement !== scdEl) scdEl.value = scoreDemand.toFixed(2);
  if (dlEl) setDealerTrigger(dlEl);

  // Booster UI
  document.getElementById('server-booster-btn')?.classList.toggle('active', serverBooster);
  document.getElementById('personal-booster-btn')?.classList.toggle('active', personalBooster);
  const sbPill = document.getElementById('server-booster-pill');
  const pbPill = document.getElementById('personal-booster-pill');
  if (sbPill) sbPill.textContent = serverBooster   ? 'ON' : 'OFF';
  if (pbPill) pbPill.textContent = personalBooster ? 'ON' : 'OFF';
  const multEl = document.getElementById('dash-mult-val');
  if (multEl) multEl.textContent = mult.toFixed(2) + '×';

  const container  = document.getElementById('dash-items');
  const totalPanel = document.getElementById('dash-total-panel');
  if (!container) return;

  if (!dashItems.length) {
    container.innerHTML = '<div class="loading" style="color:var(--muted)">No items yet — use the selector above to build your sell list.</div>';
    if (totalPanel) totalPanel.style.display = 'none';
    return;
  }

  const idToCrop = Object.fromEntries(allCrops.map(c => [c.id, c]));
  let grandTotal = 0, grandBase = 0;

  container.innerHTML = dashItems.map(item => {
    const crop = idToCrop[item.id];
    if (!crop) return '';

    const dcs         = parseFloat(item.dcs) || 0;
    const totalItems  = dcs * DASH_DC;
    const basePrice   = crop.current_price ?? 0;

    // Chemical purity applies to compounds only — raw crops are sold as-is.
    const isRaw = crop.category === 'base';
    const pv = isRaw ? 0 : (item.pv || 0);
    const pp = isRaw ? 0 : (item.pp || 0);
    const ps = isRaw ? 0 : (item.ps || 0);

    const effPrice    = basePrice * PURITY_MULT[pv] * priceDemand * mult; // purity → dealer → boosters
    const revenue     = totalItems * effPrice;
    const baseRevenue = totalItems * basePrice;
    grandTotal += revenue;
    grandBase  += baseRevenue;

    const iconHtml = crop.icon
      ? `<img src="/static/icons/${crop.icon}?v=tp1" class="dash-item-icon" alt="" />`
      : `<span style="font-size:22px">${crop.emoji}</span>`;

    const catCls   = crop.category === 'base' ? 'badge-base' : crop.category === 'processed' ? 'badge-proc' : 'badge-combo';
    const catLabel = crop.category === 'base' ? 'Raw' : crop.category === 'processed' ? 'Proc' : 'Combo';

    // Prestige per DC (boosters don't affect prestige; progress purity & dealer rate do)
    const contribs = contributionMap[item.id] || {};
    const prestigeChips = Object.entries(contribs).map(([baseId, perSell]) => {
      const base = idToCrop[baseId];
      if (!base || !dcs) return '';
      const total = totalItems * perSell * PURITY_MULT[pp] * prestigeDemand;
      const icon  = base.icon ? `<img src="/static/icons/${base.icon}?v=tp1" class="dash-prestige-icon" alt="" />` : base.emoji;
      return `<span class="dash-prestige-chip">${icon} ${abbrevNum(total)}</span>`;
    }).filter(Boolean).join('');

    // Score is an approximation: no per-chem score data exists, so we proxy off base price.
    const score = totalItems * basePrice * PURITY_MULT[ps] * scoreDemand;

    const revenueSection = dcs > 0 ? `
      <div class="dash-revenue-section">
        <div class="dash-rev-main">
          <span class="dash-rev-items">${dcs} DC${dcs !== 1 ? 's' : ''} · ${totalItems.toLocaleString()} items</span>
          <span class="dash-rev-val">$${revenue.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
          ${mult !== 1 ? `<span class="dash-rev-base">base $${baseRevenue.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>` : ''}
        </div>
        ${prestigeChips ? `<div class="dash-prestige-row"><span class="dash-prestige-label">Prestige</span><div class="dash-prestige-chips">${prestigeChips}</div></div>` : ''}
        <div class="dash-score-row"><span class="dash-score-label">Score <span class="dash-score-approx">(approx)</span></span><span class="dash-score-val">${abbrevNum(score)}</span></div>
      </div>` : '';

    return `<div class="card dash-item-card">
      <div class="dash-item-top">
        <div class="dash-item-left">
          ${iconHtml}
          <div class="dash-item-info">
            <span class="dash-item-name">${crop.name}</span>
            <span class="badge-cat ${catCls}">${catLabel}</span>
          </div>
        </div>
        <div class="dash-item-mid">
          <span class="dash-base-price">$${basePrice.toFixed(2)}</span>
          ${effPrice !== basePrice ? `<span class="dash-arrow">→</span><span class="dash-eff-price">$${effPrice.toFixed(2)}</span>` : ''}
        </div>
        ${isRaw
          ? `<div class="dash-purity-wrap dash-purity-na" title="Raw crops have no purity — sold as-is.">no purity</div>`
          : `<div class="dash-purity-wrap" title="Chemical purity — Value · Progress · Score (level 0–3)">
              <span class="dash-purity-code">${pv}-${pp}-${ps}</span>
              ${['v', 'p', 's'].map(b => {
                const lvl = b === 'v' ? pv : b === 'p' ? pp : ps;
                const L = b.toUpperCase();
                const opts = JSON.stringify([0, 1, 2, 3].map(n => [String(n), String(n)]));
                return `<button type="button" class="ui-select dash-purity-select"
                  aria-haspopup="listbox" aria-expanded="false" aria-label="${L} purity"
                  data-tip="${b}" data-value="${lvl}" data-onpick="dashSetPurity|${crop.id}|${b}" data-options='${opts}'>
                  <span class="ui-select-text">${lvl}</span>${UI_CARET}</button>`;
              }).join('')}
            </div>`}
        <div class="dash-dc-wrap">
          <div class="ui-stepper">
            <button type="button" class="ui-step" tabindex="-1" aria-label="Decrease double chests"
              data-dc-id="${crop.id}" data-dc-delta="-0.5">−</button>
            <input type="number" min="0" step="0.5" class="ui-step-input" inputmode="decimal"
              value="${item.dcs}" placeholder="0" aria-label="Double chests"
              onchange="dashSetDcs('${crop.id}', this.value)" />
            <button type="button" class="ui-step" tabindex="-1" aria-label="Increase double chests"
              data-dc-id="${crop.id}" data-dc-delta="0.5">+</button>
          </div>
          <span class="dash-dc-unit">DCs</span>
        </div>
        <button class="dash-remove-btn" onclick="dashRemoveItem('${crop.id}')">×</button>
      </div>
      ${revenueSection}
    </div>`;
  }).join('');

  if (totalPanel) {
    totalPanel.style.display = grandTotal > 0 ? '' : 'none';
    const totalEl = document.getElementById('dash-total-val');
    const baseEl  = document.getElementById('dash-base-val');
    const baseBlk = document.getElementById('dash-base-block');
    if (totalEl) totalEl.textContent = '$' + grandTotal.toLocaleString(undefined, {maximumFractionDigits: 0});
    if (baseEl)  baseEl.textContent  = '$' + grandBase.toLocaleString(undefined, {maximumFractionDigits: 0});
    if (baseBlk) baseBlk.style.display = mult !== 1 && grandBase > 0 ? '' : 'none';
  }
}

// ── Old calculator page (removed) ─────────────────────────────────────────────

function populateCalcDropdown() {
  const sel = document.getElementById('calc-compound');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select a compound...</option>' +
    allCrops
      .filter(c => c.current_price != null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => `<option value="${c.id}">${c.emoji} ${c.name}</option>`)
      .join('');
}

function populateBatchInputs() {
  const container = document.getElementById('batch-inputs');
  if (!container) return;
  const baseCrops = allCrops.filter(c => c.category === 'base' && c.current_price != null);
  container.innerHTML = baseCrops.map(c => {
    const icon = c.icon
      ? `<img src="/static/icons/${c.icon}?v=tp1" class="table-icon" alt="${c.minecraft_name}" />`
      : `<span class="compound-emoji">${c.emoji}</span>`;
    return `<div class="batch-input-row">
      <label>${icon}${c.name}</label>
      <input type="number" min="0" value="0" id="batch-${c.id}" placeholder="0" />
    </div>`;
  }).join('');
}

function setStack(n) {
  calcStackSize = n;
  document.getElementById('stack-1-btn').classList.toggle('active', n === 1);
  document.getElementById('stack-64-btn').classList.toggle('active', n === 64);
  calcUpdate();
}

// PURITY_MULT is declared once near the live calculator (top of dashboard section).

function getPurity() {
  const v = parseInt(document.getElementById('purity-value')?.value || 0);
  const p = parseInt(document.getElementById('purity-progress')?.value || 0);
  const s = parseInt(document.getElementById('purity-score')?.value || 0);
  return { v, p, s, vm: PURITY_MULT[v], pm: PURITY_MULT[p], sm: PURITY_MULT[s] };
}

function calcUpdate() {
  const sel = document.getElementById('calc-compound');
  if (!sel) return;

  const id = sel.value;
  const crop = allCrops.find(c => c.id === id);
  const puritySection = document.getElementById('purity-section');
  const purityCode = document.getElementById('purity-code');
  const purityHint = document.getElementById('purity-hint');
  const isRaw = !crop || crop.recipe_type === 'raw';

  // Disable purity for raw crops
  ['purity-value','purity-progress','purity-score'].forEach(pid => {
    const el = document.getElementById(pid);
    if (el) el.disabled = isRaw;
  });
  if (isRaw) {
    ['purity-value','purity-progress','purity-score'].forEach(pid => {
      const el = document.getElementById(pid);
      if (el) el.value = '0';
    });
  }

  const pur = getPurity();
  if (purityCode) purityCode.textContent = isRaw ? 'N/A' : `${pur.v}-${pur.p}-${pur.s}`;
  if (purityHint) purityHint.textContent = isRaw ? 'Raw crops have no purity — sold as-is.' : '';

  if (!crop || crop.current_price == null) {
    ['r-unit','r-one','r-stack','r-inv','r-chest','r-progress','r-score'].forEach(rid => {
      const el = document.getElementById(rid);
      if (el) el.textContent = '—';
    });
    hideCalcExtras();
    return;
  }

  const base = crop.current_price;
  const sellPrice  = base * (isRaw ? 1 : pur.vm);
  const progValue  = base * (isRaw ? 1 : pur.pm);
  const scoreValue = base * (isRaw ? 1 : pur.sm);
  const slots = calcStackSize;

  document.getElementById('r-unit').textContent    = `$${sellPrice.toFixed(2)}`;
  document.getElementById('r-one').textContent     = `$${(sellPrice * slots).toFixed(2)}`;
  document.getElementById('r-stack').textContent   = `$${(sellPrice * 64).toFixed(2)}`;
  document.getElementById('r-inv').textContent     = `$${(sellPrice * slots * 36).toFixed(2)}`;
  document.getElementById('r-chest').textContent   = `$${(sellPrice * slots * 54).toFixed(2)}`;
  document.getElementById('r-progress').textContent = `$${progValue.toFixed(2)}`;
  document.getElementById('r-score').textContent    = `$${scoreValue.toFixed(2)}`;

  // Combo recipe details
  if (crop.craft_input_cost != null) {
    const ingCost   = crop.craft_input_cost;
    const outputVal = (crop.output_qty || 1) * sellPrice;
    const netProfit = outputVal - ingCost;

    // Break-even: find the minimum value purity level where crafting is profitable
    let beLevel = null;
    for (let lvl = 0; lvl <= 3; lvl++) {
      if ((crop.output_qty || 1) * base * PURITY_MULT[lvl] >= ingCost) {
        beLevel = lvl;
        break;
      }
    }

    document.getElementById('calc-recipe-divider').style.display = '';
    showCalcExtra('calc-ing-row', 'r-ing', `$${ingCost.toFixed(2)}`);
    const profitEl = document.getElementById('r-profit');
    if (profitEl) {
      profitEl.textContent = `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`;
      profitEl.style.color = netProfit >= 0 ? 'var(--green)' : 'var(--red)';
    }
    document.getElementById('calc-profit-row').style.display = '';

    if (beLevel !== null) {
      const beEl = document.getElementById('r-breakeven');
      if (beEl) {
        beEl.textContent = beLevel === 0 ? 'Always profitable' : `Value purity ≥ ${beLevel} (${PURITY_MULT[beLevel]}×)`;
        beEl.style.color = pur.v >= beLevel ? 'var(--green)' : 'var(--red)';
      }
      document.getElementById('calc-breakeven-row').style.display = '';
    } else {
      document.getElementById('calc-breakeven-row').style.display = 'none';
    }
  } else {
    hideCalcExtras();
  }
}

function showCalcExtra(rowId, valId, text) {
  const row = document.getElementById(rowId);
  const val = document.getElementById(valId);
  if (row) row.style.display = '';
  if (val) val.textContent = text;
}

function hideCalcExtras() {
  ['calc-recipe-divider', 'calc-ing-row', 'calc-profit-row', 'calc-breakeven-row'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function calcBatch() {
  const baseCrops = allCrops.filter(c => c.category === 'base' && c.current_price != null);
  const inventory = {};
  baseCrops.forEach(c => {
    const el = document.getElementById('batch-' + c.id);
    inventory[c.name] = el ? parseInt(el.value) || 0 : 0;
  });

  // Find combos that can be crafted
  const combos = allCrops.filter(c =>
    c.recipe && c.output_qty && c.current_price != null &&
    (c.category === 'combo' || c.category === 'processed')
  );

  const results = [];
  for (const combo of combos) {
    // Check how many times we can craft this
    let maxCrafts = Infinity;
    let possible = true;
    for (const [ingName, qty] of Object.entries(combo.recipe)) {
      const have = inventory[ingName] || 0;
      if (have === 0 && qty > 0) { possible = false; break; }
      maxCrafts = Math.min(maxCrafts, Math.floor(have / qty));
    }
    if (!possible || maxCrafts <= 0 || maxCrafts === Infinity) continue;

    const totalOutput = maxCrafts * combo.output_qty;
    const totalValue = totalOutput * combo.current_price;
    results.push({ combo, maxCrafts, totalOutput, totalValue });
  }

  results.sort((a, b) => b.totalValue - a.totalValue);

  const container = document.getElementById('batch-results');
  if (!results.length) {
    container.innerHTML = '<p class="calc-hint">No combos can be crafted with current amounts.</p>';
    return;
  }

  container.innerHTML = results.map(r => {
    const detail = `${r.maxCrafts}× craft → ${r.totalOutput} units`;
    return `<div class="batch-result-item">
      <div>
        <div class="batch-result-name">${r.combo.emoji} ${r.combo.name}</div>
        <div class="batch-result-detail">${detail}</div>
      </div>
      <div class="batch-result-val">$${r.totalValue.toFixed(2)}</div>
    </div>`;
  }).join('');
}

// ── Graphs page ───────────────────────────────────────────────────────────────

// Theme palette (mirrors CSS custom properties)
const GP = { green: '#3fb950', red: '#c0392b', blue: '#54acd2', yellow: '#e3b341', muted: '#8a8790', grid: 'rgba(255,255,255,0.07)' };

// Compute history-derived stats for one compound.
function histStats(id) {
  const entries = (graphHistory && graphHistory[id] ? graphHistory[id] : [])
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  if (entries.length < 1) return { entries: [], high: null, low: null, rangePct: 0, trendUp: true };
  const prices = entries.map(e => e.price);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const rangePct = low > 0 ? ((high - low) / low) * 100 : 0;
  const trendUp = prices[prices.length - 1] >= prices[0];
  return { entries, high, low, rangePct, trendUp };
}

function iconMarkup(crop) {
  return crop.icon
    ? `<img src="/static/icons/${crop.icon}?v=tp1" class="inline-icon" alt="" />`
    : (crop.emoji || '');
}

async function initGraphs() {
  // Set Chart.js global defaults for dark theme
  Chart.defaults.color = GP.muted;
  Chart.defaults.borderColor = GP.grid;

  // Populate compound combobox
  const mount = document.getElementById('graph-compound-select');
  if (mount && allCrops.length) {
    if (!graphCombo) {
      const sorted = comboItems().sort((a, b) => a.name.localeCompare(b.name));
      graphCombo = createCompoundCombobox({
        mount,
        grouped: false,
        placeholder: 'Search compound…',
        items: sorted,
        onSelect: () => renderMainChart(),
      });
    }
    // Default to the biggest mover so the chart opens on something interesting
    const movers = allCrops.filter(c => c.current_price != null && c.change_pct != null)
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
    const topCrop = movers[0] || allCrops.filter(c => c.current_price != null).sort((a, b) => b.current_price - a.current_price)[0];
    if (topCrop) graphCombo.setValue(topCrop.id);
  }

  // Fetch history
  try {
    const res = await apiFetch(`${API}/api/history`);
    graphHistory = await res.json();
  } catch (e) {
    graphHistory = {};
  }

  renderGraphKPIs();
  renderMovers();
  renderMainChart();
  renderSparklines();
  graphsInitialized = true;
}

// Load a compound into the main chart and scroll to it. Used by movers/sparklines.
function focusCompound(id) {
  if (graphCombo) { graphCombo.setValue(id); renderMainChart(); }
  document.getElementById('main-chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Market pulse KPIs ──
function renderGraphKPIs() {
  const priced = allCrops.filter(c => c.current_price != null && c.change_pct != null);

  const up = priced.filter(c => c.change_pct > 0).length;
  const down = priced.filter(c => c.change_pct < 0).length;
  const flat = priced.filter(c => c.change_pct === 0).length;
  const breadthEl = document.getElementById('kpi-breadth');
  if (breadthEl) {
    breadthEl.innerHTML = `<span style="color:${GP.green}">${up}&#9650;</span> / <span style="color:${GP.red}">${down}&#9660;</span>`;
    const net = up - down;
    const sub = document.getElementById('kpi-breadth-sub');
    if (sub) sub.textContent = `${net > 0 ? '+' : ''}${net} net · ${flat} flat`;
  }

  const setMover = (cropList, valId, subId, pick) => {
    const c = pick(cropList);
    const v = document.getElementById(valId), s = document.getElementById(subId);
    if (!c) { if (v) v.textContent = '—'; if (s) s.textContent = '—'; return; }
    if (v) v.innerHTML = `${iconMarkup(c)} ${c.name}`;
    if (s) {
      const col = c.change_pct > 0 ? GP.green : c.change_pct < 0 ? GP.red : GP.muted;
      s.innerHTML = `<span style="color:${col}">${c.change_pct > 0 ? '+' : ''}${c.change_pct}%</span> · $${c.current_price.toFixed(2)}`;
    }
  };
  setMover(priced, 'kpi-gainer', 'kpi-gainer-sub', list => list.slice().sort((a, b) => b.change_pct - a.change_pct)[0]);
  setMover(priced, 'kpi-loser', 'kpi-loser-sub', list => list.slice().sort((a, b) => a.change_pct - b.change_pct)[0]);

  // Most volatile by historical high-low range
  let best = null, bestRange = -1;
  allCrops.filter(c => c.current_price != null).forEach(c => {
    const st = histStats(c.id);
    if (st.entries.length >= 2 && st.rangePct > bestRange) { bestRange = st.rangePct; best = c; }
  });
  const volEl = document.getElementById('kpi-volatile'), volSub = document.getElementById('kpi-volatile-sub');
  if (best) {
    if (volEl) volEl.innerHTML = `${iconMarkup(best)} ${best.name}`;
    if (volSub) volSub.innerHTML = `<span style="color:${GP.yellow}">${bestRange.toFixed(1)}% range</span>`;
  } else if (volEl) {
    volEl.textContent = '—';
  }
}

// ── Movers lists ──
function renderMovers() {
  const priced = allCrops.filter(c => c.current_price != null && c.change_pct != null && c.change_pct !== 0);
  const gainers = priced.filter(c => c.change_pct > 0).sort((a, b) => b.change_pct - a.change_pct).slice(0, 6);
  const losers = priced.filter(c => c.change_pct < 0).sort((a, b) => a.change_pct - b.change_pct).slice(0, 6);

  const row = (c, positive) => {
    const col = positive ? GP.green : GP.red;
    return `<button class="mover-item" onclick="focusCompound('${c.id}')">
      <span class="mover-name">${iconMarkup(c)} ${c.name}</span>
      <span class="mover-price">$${c.current_price.toFixed(2)}</span>
      <span class="mover-change" style="color:${col}">${c.change_pct > 0 ? '+' : ''}${c.change_pct}%</span>
    </button>`;
  };

  const upEl = document.getElementById('movers-up');
  const downEl = document.getElementById('movers-down');
  if (upEl) upEl.innerHTML = gainers.length ? gainers.map(c => row(c, true)).join('') : '<div class="mover-empty">No gainers this snapshot</div>';
  if (downEl) downEl.innerHTML = losers.length ? losers.map(c => row(c, false)).join('') : '<div class="mover-empty">No losers this snapshot</div>';
}

function renderMainChart() {
  if (!graphCombo || !graphHistory) return;
  const id = graphCombo.getValue();
  const crop = allCrops.find(c => c.id === id);
  const st = histStats(id);
  const entries = st.entries;

  // Update readout strip
  const setRO = (elId, html) => { const el = document.getElementById(elId); if (el) el.innerHTML = html; };
  if (crop && entries.length) {
    setRO('ro-current', `$${crop.current_price.toFixed(2)}`);
    if (crop.change_pct != null) {
      const col = crop.change_pct > 0 ? GP.green : crop.change_pct < 0 ? GP.red : GP.muted;
      setRO('ro-change', `<span style="color:${col}">${crop.change_pct > 0 ? '+' : ''}${crop.change_pct}%</span>`);
    } else setRO('ro-change', '—');
    setRO('ro-high', `$${st.high.toFixed(2)}`);
    setRO('ro-low', `$${st.low.toFixed(2)}`);
  } else {
    ['ro-current', 'ro-change', 'ro-high', 'ro-low'].forEach(i => setRO(i, '—'));
  }

  const canvas = document.getElementById('main-chart');
  if (!canvas) return;
  if (mainChartInstance) mainChartInstance.destroy();
  if (!id || !entries.length) return;

  const labels = entries.map(e => e.date);
  const data = entries.map(e => e.price);
  const lineColor = st.trendUp ? GP.green : GP.red;

  mainChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: crop ? crop.name : id,
        data,
        borderColor: lineColor,
        backgroundColor: st.trendUp ? 'rgba(63,185,80,0.10)' : 'rgba(192,57,43,0.10)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: lineColor,
        pointRadius: 4,
        pointHoverRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(24,23,26,0.95)',
          borderColor: GP.grid,
          borderWidth: 1,
          titleColor: '#fff',
          bodyColor: GP.muted,
          padding: 10,
          callbacks: { label: ctx => `$${ctx.parsed.y.toFixed(2)}` }
        }
      },
      scales: {
        x: { grid: { color: GP.grid }, ticks: { color: GP.muted, maxRotation: 0 } },
        y: { grid: { color: GP.grid }, ticks: { color: GP.muted, callback: v => '$' + v.toFixed(2) } }
      }
    }
  });
}

function renderSparklines() {
  if (!graphHistory) return;
  const grid = document.getElementById('sparkline-grid');
  if (!grid) return;

  const query = (document.getElementById('spark-search')?.value || '').trim().toLowerCase();
  const sortBy = document.getElementById('spark-sort')?.value || 'change';

  let crops = allCrops.filter(c => c.current_price != null);
  if (query) crops = crops.filter(c => c.name.toLowerCase().includes(query) || c.id.toLowerCase().includes(query));

  crops = crops.slice().sort((a, b) => {
    if (sortBy === 'price') return (b.current_price || 0) - (a.current_price || 0);
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'volatility') return histStats(b.id).rangePct - histStats(a.id).rangePct;
    return Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0); // biggest move
  });

  grid.innerHTML = '';
  if (!crops.length) { grid.innerHTML = '<div class="mover-empty">No compounds match.</div>'; return; }

  crops.forEach(crop => {
    const st = histStats(crop.id);
    const entries = st.entries;

    const card = document.createElement('div');
    card.className = 'sparkline-card';
    card.onclick = () => focusCompound(crop.id);

    const changeStr = crop.change_pct != null
      ? `<span style="color:${crop.change_pct > 0 ? 'var(--green)' : crop.change_pct < 0 ? 'var(--red)' : 'var(--muted)'}">${crop.change_pct > 0 ? '+' : ''}${crop.change_pct}%</span>`
      : '';

    const rangeStr = (st.high != null && st.low != null && entries.length >= 2)
      ? `<div class="sparkline-range">L $${st.low.toFixed(2)} · H $${st.high.toFixed(2)}</div>`
      : '';

    const sparkIcon = crop.icon
      ? `<img src="/static/icons/${crop.icon}?v=tp1" class="spark-icon" alt="" />`
      : crop.emoji;
    card.innerHTML = `
      <div class="sparkline-name">${sparkIcon} ${crop.name}</div>
      <div class="sparkline-price">$${crop.current_price.toFixed(2)} ${changeStr}</div>
      <div class="sparkline-canvas-wrap"><canvas id="spark-${crop.id}"></canvas></div>
      ${rangeStr}
    `;
    grid.appendChild(card);

    // Draw sparkline after DOM insertion
    requestAnimationFrame(() => {
      const cvs = document.getElementById('spark-' + crop.id);
      if (!cvs || entries.length < 2) return;
      if (sparklineInstances[crop.id]) sparklineInstances[crop.id].destroy();

      sparklineInstances[crop.id] = new Chart(cvs, {
        type: 'line',
        data: {
          labels: entries.map(e => e.date),
          datasets: [{
            data: entries.map(e => e.price),
            borderColor: st.trendUp ? GP.green : GP.red,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1.5,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false }, y: { display: false } }
        }
      });
    });
  });
}

// ── Prestige page ─────────────────────────────────────────────────────────────

// ── Prestige: ingredient resolver ────────────────────────────────────────────

let prestigeData = [];
// contributionMap[compound_id] = { base_crop_id: qty_per_sell }
// e.g. wheasugrinide → { sugrium: 1.5, wheatium: 0.5 }
let contributionMap = {};
// livePrestigeProgress[base_crop_id] = { current, goal, takenAt } from the latest
// uploaded prestige dump (Progress tab). null when no upload exists.
let livePrestigeProgress = null;
let usePrestigeLiveData = (localStorage.getItem('prestige_use_live') !== 'false');

function buildContributionMap() {
  const baseIds = new Set(allCrops.filter(c => c.recipe_type === 'raw').map(c => c.id));
  const nameToId = Object.fromEntries(allCrops.map(c => [c.name, c.id]));
  const idToCrop = Object.fromEntries(allCrops.map(c => [c.id, c]));

  // Returns { base_crop_id: qty } representing how much of each base crop
  // is represented per 1 unit of compound `id`, multiplied by `mult`.
  function resolve(id, mult, seen) {
    if (seen.has(id)) return {};
    const crop = idToCrop[id];
    if (!crop) return {};
    if (baseIds.has(id)) return { [id]: mult };
    if (!crop.recipe || !crop.output_qty) return {};

    const result = {};
    const seenNext = new Set(seen);
    seenNext.add(id);
    for (const [ingName, qty] of Object.entries(crop.recipe)) {
      const ingId = nameToId[ingName];
      if (!ingId) continue;
      const sub = resolve(ingId, mult * qty / crop.output_qty, seenNext);
      for (const [baseId, val] of Object.entries(sub)) {
        result[baseId] = (result[baseId] || 0) + val;
      }
    }
    return result;
  }

  contributionMap = {};
  for (const crop of allCrops) {
    const contribs = resolve(crop.id, 1.0, new Set());
    if (Object.keys(contribs).length) contributionMap[crop.id] = contribs;
  }
}

function getSells(id) {
  return parseInt(localStorage.getItem('sells_' + id) || '0');
}

function calcAllProgress() {
  // Returns { base_crop_id: total_progress }.
  // When live data from an uploaded dump is active, use the real item counts.
  if (usePrestigeLiveData && livePrestigeProgress) {
    const progress = {};
    for (const [cropId, v] of Object.entries(livePrestigeProgress)) {
      progress[cropId] = v.current;
    }
    return progress;
  }
  // Otherwise derive fractional progress from manually-entered sell counts.
  const progress = {};
  for (const [compoundId, contribs] of Object.entries(contributionMap)) {
    const sells = getSells(compoundId);
    if (!sells) continue;
    for (const [baseId, perSell] of Object.entries(contribs)) {
      progress[baseId] = (progress[baseId] || 0) + sells * perSell;
    }
  }
  return progress;
}

// Build livePrestigeProgress from the latest point of each uploaded objective
// that maps to a base crop (Chems objectives carry a crop_id; Police do not).
function buildLivePrestigeProgress() {
  livePrestigeProgress = null;
  if (!progressData || !Array.isArray(progressData.objectives)) return;
  const map = {};
  for (const o of progressData.objectives) {
    if (!o.crop_id) continue;
    const hist = (o.history || []).slice().sort((a, b) => a.t - b.t);
    if (!hist.length) continue;
    const last = hist[hist.length - 1];
    map[o.crop_id] = { current: last.current, goal: o.goal, takenAt: last.t };
  }
  if (Object.keys(map).length) livePrestigeProgress = map;
}

// ── Prestige: rendering ───────────────────────────────────────────────────────

async function renderPrestige() {
  const grid = document.getElementById('prestige-grid');
  if (!grid) return;
  if (!allCrops.length) return;   // bootstrap calls this again after crops load

  try {
    const res = await apiFetch(`${API}/api/prestige`);
    prestigeData = await res.json();
  } catch (e) {
    grid.innerHTML = '<div class="loading">Failed to load prestige data.</div>';
    return;
  }

  await loadProgressData();        // one load shared by calculator + tracker views
  buildContributionMap();
  buildLivePrestigeProgress();
  renderPrestigeLiveBanner();

  // History-backed views (KPIs, chart, snapshots) appear only once an upload exists.
  const hasHist = (progressData?.objectives || []).length > 0;
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('prog-kpis', hasHist);
  show('prog-chart-card', hasHist);
  show('prog-snaps-card', hasHist);
  if (hasHist) {
    renderProgressKPIs();
    populateProgObjectiveSelect();
    renderProgressChart();
    renderProgressSnapshots();
  }

  renderMergedObjectives();        // merged crop cards + Police status cards
  renderPrestigeTracker();         // self-hides when live data is active
  wireProgressUpload();            // guarded by progDropWired
}

// Banner above the cards: shows whether the calculator is running on real
// uploaded data or the manual tracker, with a toggle to switch.
function renderPrestigeLiveBanner() {
  const el = document.getElementById('prestige-live-banner');
  if (!el) return;
  const trackerCard = document.getElementById('prestige-tracker-card');

  if (!livePrestigeProgress) {
    el.innerHTML = `<div class="prestige-live-banner empty">
      <span class="plb-icon">📡</span>
      <span class="plb-text">No uploaded data yet. Upload a prestige dump above to auto-fill this calculator with your real progress.</span>
    </div>`;
    if (trackerCard) trackerCard.style.display = '';
    return;
  }

  const on = usePrestigeLiveData;
  const snaps = progressData.snapshots || [];
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const when = latest
    ? new Date(latest).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const n = Object.keys(livePrestigeProgress).length;

  el.innerHTML = `<div class="prestige-live-banner ${on ? 'on' : 'off'}">
    <span class="plb-dot"></span>
    <span class="plb-text">${on
      ? `Live data from your upload &middot; <strong>${when}</strong> &middot; ${n} crops synced`
      : `Live data available from <strong>${when}</strong> — calculator is using the manual tracker`}</span>
    <button class="plb-toggle" onclick="togglePrestigeLiveData()">${on ? 'Switch to manual' : 'Use live data'}</button>
  </div>`;

  // When live data drives the calculator, the manual Sell Tracker is moot.
  if (trackerCard) trackerCard.style.display = on ? 'none' : '';
}

function togglePrestigeLiveData() {
  usePrestigeLiveData = !usePrestigeLiveData;
  localStorage.setItem('prestige_use_live', usePrestigeLiveData ? 'true' : 'false');
  renderPrestigeLiveBanner();
  renderPrestigeCards();
  renderPrestigeTracker();
}

function buildReverseMap() {
  // reverseMap[base_crop_id] = [{compound, perSell}, ...] sorted best first
  const idToCrop = Object.fromEntries(allCrops.map(c => [c.id, c]));
  const map = {};
  for (const [compoundId, contribs] of Object.entries(contributionMap)) {
    const compound = idToCrop[compoundId];
    if (!compound) continue;
    for (const [baseId, perSell] of Object.entries(contribs)) {
      if (!map[baseId]) map[baseId] = [];
      map[baseId].push({ compound, perSell });
    }
  }
  // Sort each list: highest perSell first (fewest sells needed)
  for (const list of Object.values(map)) {
    list.sort((a, b) => b.perSell - a.perSell);
  }
  return map;
}

// Merged objective rendering: crop cards (progress + sell calculator) plus the
// status-only Police cards — both driven by the same uploaded snapshot data.
function renderMergedObjectives() {
  renderPrestigeCards();   // crop cards → #prestige-grid
  renderPoliceCards();     // police cards → #prog-objectives
}

function renderPrestigeCards() {
  const grid = document.getElementById('prestige-grid');
  if (!grid || !prestigeData.length) return;
  const progress = calcAllProgress();
  const reverseMap = buildReverseMap();
  const DC = 54 * 64; // 3456 items per double chest

  // crop_id → uploaded objective, for rate / ETA / status badge / chart focus.
  const objByCrop = {};
  for (const o of (progressData?.objectives || [])) {
    if (o.crop_id) objByCrop[o.crop_id] = o;
  }

  grid.innerHTML = prestigeData.map(p => {
    const sold = progress[p.id] || 0;
    const live = (usePrestigeLiveData && livePrestigeProgress && livePrestigeProgress[p.id]) || null;
    const req = live ? live.goal : p.requirement;   // dump's goal is authoritative
    const pct = Math.min(100, (sold / req) * 100);
    const remaining = Math.max(0, req - sold);
    const complete = sold >= req;

    // History-derived status (rate / ETA / badge) from the matching objective.
    const obj = objByCrop[p.id] || null;
    const ostat = obj ? progStats(obj) : null;
    const rateStr = ostat && ostat.rate != null ? `${invFmt(ostat.rate)} inv/day` : '—';
    const etaStr = ostat && ostat.etaDate
      ? new Date(ostat.etaDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '—';
    const doneStr = (complete && ostat && ostat.completedAt)
      ? new Date(ostat.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    const badgeCls = complete ? 'done' : (ostat && ostat.rate ? 'active' : 'idle');
    const badgeTxt = complete ? 'Complete' : (ostat && ostat.rate ? 'On track' : (ostat ? 'No rate yet' : ''));
    const badgeHtml = badgeTxt ? `<span class="prog-badge ${badgeCls}">${badgeTxt}</span>` : '';

    const iconHtml = p.icon
      ? `<img src="/static/icons/${p.icon}?v=tp1" class="prestige-icon" alt="${p.minecraft_name}" />`
      : `<span class="prestige-emoji">${p.emoji}</span>`;

    // Per-compound breakdown table
    const contributors = reverseMap[p.id] || [];
    const compoundRows = contributors.map(({ compound, perSell }) => {
      const sellsNeeded = complete ? 0 : Math.ceil(remaining / perSell);
      const dcNeeded = complete ? 0 : Math.ceil(sellsNeeded / DC);
      const perSellStr = Number.isInteger(perSell)
        ? `+${perSell}`
        : `+${perSell.toFixed(2).replace(/\.?0+$/, '')}`;
      const compIcon = compound.icon
        ? `<img src="/static/icons/${compound.icon}?v=tp1" class="table-icon" alt="" />`
        : compound.emoji;
      return `<tr>
        <td class="pc-name">${compIcon} ${compound.name}</td>
        <td class="pc-per">${perSellStr}</td>
        <td class="pc-sells">${complete ? '✓' : sellsNeeded.toLocaleString()}</td>
        <td class="pc-dc">${complete ? '—' : dcNeeded.toLocaleString()}</td>
      </tr>`;
    }).join('');

    // Whole card focuses the chart when an uploaded objective backs it.
    const clickAttr = obj ? ` clickable" onclick="focusProgObjective('${obj.objective_id}')` : '';
    return `<div class="prestige-card${clickAttr}" id="pcard-${p.id}">
      <div class="prestige-card-header">
        ${iconHtml}
        <div class="prestige-title">
          <span class="prestige-name">${p.name}</span>
          <span class="prestige-mcname">${p.minecraft_name || ''}</span>
        </div>
        ${badgeHtml}
        <div class="prestige-pct${complete ? ' complete' : ''}" id="ppct-${p.id}">${pct.toFixed(1)}%</div>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill${complete ? ' complete' : ''}" id="pbar-${p.id}"
          style="width:${pct.toFixed(2)}%"></div>
      </div>
      <div class="prestige-stats">
        <div class="prestige-stat">
          <span class="label">Progress</span>
          <span class="val">${fmtProgress(sold)} / ${fmtProgress(req)}</span>
        </div>
        <div class="prestige-stat">
          <span class="label">Remaining</span>
          <span class="val ${complete ? 'change-pos' : 'change-neg'}">
            ${complete ? '✓ Done!' : fmtProgress(remaining)}
          </span>
        </div>
        ${complete
          ? `<div class="prestige-stat wide">
              <span class="label">Completed</span>
              <span class="val change-pos">${doneStr ? `✓ ${doneStr}` : '✓ Done'}</span>
            </div>`
          : `<div class="prestige-stat">
              <span class="label">Rate</span>
              <span class="val">${rateStr}</span>
            </div>
            <div class="prestige-stat">
              <span class="label">Est. finish</span>
              <span class="val">${etaStr}</span>
            </div>`}
      </div>
      <div class="pc-table-wrap">
        <table class="pc-table">
          <thead><tr>
            <th>Compound</th><th>/ sell</th><th>Sells</th><th>DCs</th>
          </tr></thead>
          <tbody>${compoundRows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// Police prestige objectives have no crop recipe, so they stay status-only.
function renderPoliceCards() {
  const wrap = document.getElementById('prog-objectives');
  if (!wrap) return;
  const objs = (progressData?.objectives || []).filter(o => o.category === 'Police');
  if (!objs.length) { wrap.innerHTML = ''; return; }

  const cards = objs
    .map(o => ({ o, s: progStats(o) }))
    .sort((a, b) => (a.s.complete - b.s.complete) || (b.s.pct - a.s.pct))
    .map(({ o, s }) => {
      const etaStr = s.complete ? '✓ Done'
        : (s.etaDate ? new Date(s.etaDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                     : '—');
      const rateStr = s.rate != null ? `${invFmt(s.rate)} inv/day` : '—';
      const statusCls = s.complete ? 'done' : (s.rate ? 'active' : 'idle');
      const statusTxt = s.complete ? 'Complete' : (s.rate ? 'On track' : 'No rate yet');
      return `<div class="prog-card" onclick="focusProgObjective('${o.objective_id}')">
        <div class="prog-card-head">
          ${progObjIcon(o, 'prog-card-icon')}
          <div class="prog-card-title">
            <span class="prog-card-name">${o.label}</span>
            <span class="prog-card-goal">${o.goal_text || ''}</span>
          </div>
          <span class="prog-badge ${statusCls}">${statusTxt}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill${s.complete ? ' complete' : ''}" style="width:${s.pct.toFixed(2)}%"></div>
        </div>
        <div class="prog-card-stats">
          <div class="prog-stat"><span class="prog-stat-label">Progress</span><span class="prog-stat-val">${invFmt(s.cur)} / ${invFmt(s.goal)} inv</span></div>
          <div class="prog-stat"><span class="prog-stat-label">Complete</span><span class="prog-stat-val">${s.pct.toFixed(1)}%</span></div>
          <div class="prog-stat"><span class="prog-stat-label">Rate</span><span class="prog-stat-val">${rateStr}</span></div>
          <div class="prog-stat"><span class="prog-stat-label">Est. finish</span><span class="prog-stat-val">${etaStr}</span></div>
        </div>
      </div>`;
    }).join('');

  wrap.innerHTML = `<div class="prog-cat">
    <div class="prog-cat-title">🚔 Police Prestige <span class="prog-cat-count">${objs.length}</span></div>
    <div class="prog-grid">${cards}</div>
  </div>`;
}

function renderPrestigeTracker() {
  const tracker = document.getElementById('prestige-tracker');
  if (!tracker) return;

  // Build lookup: base crop id → prestige entry
  const prestigeById = Object.fromEntries(prestigeData.map(p => [p.id, p]));

  // Group compounds by category for display
  const categories = [
    { label: 'Raw Crops', filter: c => c.recipe_type === 'raw' },
    { label: 'Processed', filter: c => c.recipe_type === 'smelted' || c.recipe_type === 'crafted' },
    { label: 'Combos', filter: c => c.category === 'combo' },
  ];

  let html = '';
  for (const cat of categories) {
    const compounds = allCrops.filter(c => cat.filter(c) && contributionMap[c.id] && Object.keys(contributionMap[c.id]).length);
    if (!compounds.length) continue;

    html += `<div class="tracker-section">
      <div class="tracker-section-title">${cat.label}</div>
      <table class="tracker-table">
        <thead><tr><th>Compound</th><th>Progress per sell</th><th>Units Sold</th></tr></thead>
        <tbody>`;

    for (const c of compounds) {
      const contribs = contributionMap[c.id] || {};
      const sells = getSells(c.id);

      const badgesHtml = Object.entries(contribs).map(([baseId, qty]) => {
        const p = prestigeById[baseId];
        if (!p) return '';
        const iconEl = p.icon
          ? `<img src="/static/icons/${p.icon}?v=tp1" class="tracker-crop-icon" alt="${p.minecraft_name}" />`
          : `<span class="tracker-crop-badge-emoji">${p.emoji}</span>`;
        const qtyStr = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2).replace(/\.?0+$/, '');
        return `<span class="tracker-crop-badge" title="${p.name}: +${qtyStr} per sell">${iconEl}<span class="tracker-qty">+${qtyStr}</span></span>`;
      }).join('');

      html += `<tr>
        <td class="tracker-compound">
          <span class="compound-emoji">${c.emoji}</span>
          <span>${c.name}</span>
        </td>
        <td class="tracker-crops">${badgesHtml}</td>
        <td class="tracker-input-cell">
          <input type="number" min="0" value="${sells}" class="tracker-input"
            oninput="onSellInput('${c.id}', this.value)" />
        </td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
  }

  tracker.innerHTML = html || '<p class="calc-hint">No compounds with known recipes found.</p>';
}

function onSellInput(compoundId, value) {
  const sells = Math.max(0, parseInt(value) || 0);
  localStorage.setItem('sells_' + compoundId, sells);
  // Re-render just the cards (fast, no full rebuild)
  renderPrestigeCards();
}

function resetPrestigeSells() {
  if (!confirm('Reset all sell counts?')) return;
  for (const c of allCrops) {
    localStorage.removeItem('sells_' + c.id);
    localStorage.removeItem('prestige_' + c.id); // clear old format too
  }
  renderPrestigeCards();
  renderPrestigeTracker();
}

function fmtProgress(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  // Show 1 decimal if fractional, else integer
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}

function formatDollar(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

// ── Prestige Progress Tracker ──────────────────────────────────────────────────

function invFmt(items) {
  // items → "85.7" inventories (1 decimal, comma-grouped above 1k)
  const inv = items / INV_SIZE;
  return inv >= 100 ? inv.toLocaleString(undefined, { maximumFractionDigits: 0 })
                    : inv.toFixed(1);
}

function progObjIcon(o, cls) {
  return o.icon
    ? `<img src="/static/icons/${o.icon}?v=tp1" class="${cls}" alt="" />`
    : `<span class="prog-emoji">${o.emoji || '📦'}</span>`;
}

function progShortDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Derive per-objective stats from its history series.
function progStats(o) {
  const hist = (o.history || []).slice().sort((a, b) => a.t - b.t);
  const goal = o.goal;
  const cur = hist.length ? hist[hist.length - 1].current : 0;
  const pct = goal > 0 ? Math.min(100, (cur / goal) * 100) : 0;
  const remaining = Math.max(0, goal - cur);
  const complete = cur >= goal;

  // Sell rate (items/day). Prefer the most recent interval; fall back to overall.
  const ratePerDay = (a, b) => {
    if (!a || !b) return null;
    const days = (b.t - a.t) / 86400000;
    if (days <= 0) return null;
    const d = b.current - a.current;
    return d > 0 ? d / days : 0;
  };
  let rateRecent = null, rateOverall = null;
  if (hist.length >= 2) {
    rateRecent = ratePerDay(hist[hist.length - 2], hist[hist.length - 1]);
    rateOverall = ratePerDay(hist[0], hist[hist.length - 1]);
  }
  const rate = (rateRecent != null && rateRecent > 0) ? rateRecent
             : (rateOverall != null ? rateOverall : null);

  let etaDays = null, etaDate = null;
  if (!complete && rate && rate > 0) {
    etaDays = remaining / rate;
    etaDate = Date.now() + etaDays * 86400000;
  }

  // When done, the completion date is the first snapshot that reached the goal
  // (fall back to the latest snapshot if history starts already-complete).
  let completedAt = null;
  if (complete && hist.length) {
    const hit = hist.find(h => h.current >= goal);
    completedAt = hit ? hit.t : hist[hist.length - 1].t;
  }

  return { hist, cur, goal, pct, remaining, complete, rate, rateRecent, rateOverall, etaDays, etaDate, completedAt };
}

async function loadProgressData() {
  try {
    const res = await apiFetch(`${API}/api/prestige/progress`);
    progressData = await res.json();
  } catch (e) {
    progressData = { snapshots: [], objectives: [], inventory_size: INV_SIZE };
  }
}

// The Progress tab was merged into Prestige. Snapshot delete/clear and upload
// handlers still call renderProgress() — re-run the unified render instead.
function renderProgress() { return renderPrestige(); }

function renderProgressKPIs() {
  const objs = progressData.objectives;
  const stats = objs.map(o => ({ o, s: progStats(o) }));

  const earned = stats.filter(x => x.s.complete).length;
  document.getElementById('prog-kpi-earned').textContent = `${earned} / ${objs.length}`;

  const avg = stats.reduce((a, x) => a + x.s.pct, 0) / stats.length;
  document.getElementById('prog-kpi-avg').textContent = `${avg.toFixed(1)}%`;

  const incomplete = stats.filter(x => !x.s.complete);
  const closest = incomplete.slice().sort((a, b) => b.s.pct - a.s.pct)[0];
  const closeEl = document.getElementById('prog-kpi-close');
  const closeSub = document.getElementById('prog-kpi-close-sub');
  if (closest) {
    closeEl.innerHTML = `${progObjIcon(closest.o, 'inline-icon')} ${closest.o.label}`;
    closeSub.textContent = `${closest.s.pct.toFixed(1)}% · ${invFmt(closest.s.remaining)} inv left`;
  } else {
    closeEl.textContent = 'All complete 🎉';
    closeSub.textContent = '';
  }

  const fastest = stats.filter(x => x.s.rate && x.s.rate > 0)
    .sort((a, b) => b.s.rate - a.s.rate)[0];
  const fastEl = document.getElementById('prog-kpi-fast');
  const fastSub = document.getElementById('prog-kpi-fast-sub');
  if (fastest) {
    fastEl.innerHTML = `${progObjIcon(fastest.o, 'inline-icon')} ${fastest.o.label}`;
    fastSub.textContent = `${invFmt(fastest.s.rate)} inv/day`;
  } else {
    fastEl.textContent = '—';
    fastSub.textContent = 'need 2+ snapshots';
  }
}

function populateProgObjectiveSelect() {
  const sel = document.getElementById('prog-objective-select');
  if (!sel) return;
  const prev = sel.value;
  const ordered = progressData.objectives.slice().sort((a, b) =>
    a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  sel.innerHTML = ordered.map(o =>
    `<option value="${o.objective_id}">${o.category}: ${o.label}</option>`).join('');
  // Default to the closest-to-done incomplete objective
  if (prev && ordered.some(o => o.objective_id === prev)) {
    sel.value = prev;
  } else {
    const stats = ordered.map(o => ({ o, s: progStats(o) }));
    const target = stats.filter(x => !x.s.complete).sort((a, b) => b.s.pct - a.s.pct)[0]
                || stats[0];
    if (target) sel.value = target.o.objective_id;
  }
}

function renderProgressChart() {
  const sel = document.getElementById('prog-objective-select');
  if (!sel || !progressData) return;
  const o = progressData.objectives.find(x => x.objective_id === sel.value);
  const canvas = document.getElementById('prog-chart');
  if (!o || !canvas) return;
  const s = progStats(o);

  // Readout
  const setRO = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  setRO('prog-ro-cur', `${invFmt(s.cur)} / ${invFmt(s.goal)} inv`);
  setRO('prog-ro-pct', `<span style="color:${s.complete ? GP.yellow : GP.green}">${s.pct.toFixed(1)}%</span>`);
  setRO('prog-ro-rate', s.rate != null ? `${invFmt(s.rate)} inv/day` : '<span style="color:var(--muted)">—</span>');
  setRO('prog-ro-eta', s.complete ? '<span style="color:'+GP.yellow+'">✓ Complete</span>'
        : (s.etaDate ? new Date(s.etaDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                     : '<span style="color:var(--muted)">—</span>'));

  if (progChartInstance) progChartInstance.destroy();
  const hist = s.hist;
  if (!hist.length) return;

  const labels = hist.map(h => progShortDate(h.t));
  const dataInv = hist.map(h => h.current / INV_SIZE);
  const goalInv = s.goal / INV_SIZE;
  const lineColor = s.complete ? GP.yellow : GP.green;

  progChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Inventories sold',
          data: dataInv,
          borderColor: lineColor,
          backgroundColor: s.complete ? 'rgba(227,179,65,0.10)' : 'rgba(63,185,80,0.10)',
          fill: true, tension: 0.25,
          pointBackgroundColor: lineColor, pointRadius: 4, pointHoverRadius: 6,
        },
        {
          label: 'Goal',
          data: hist.map(() => goalInv),
          borderColor: 'rgba(255,255,255,0.25)',
          borderDash: [6, 6], borderWidth: 1.5,
          pointRadius: 0, fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(24,23,26,0.95)', borderColor: GP.grid, borderWidth: 1,
          titleColor: '#fff', bodyColor: GP.muted, padding: 10,
          callbacks: {
            label: ctx => ctx.datasetIndex === 1
              ? `Goal: ${goalInv.toFixed(0)} inv`
              : `${ctx.parsed.y.toFixed(1)} inv (${(ctx.parsed.y / goalInv * 100).toFixed(1)}%)`,
          },
        },
      },
      scales: {
        x: { grid: { color: GP.grid }, ticks: { color: GP.muted, maxRotation: 0 } },
        y: { grid: { color: GP.grid }, ticks: { color: GP.muted, callback: v => v + ' inv' },
             beginAtZero: true, suggestedMax: goalInv },
      },
    },
  });
}


function focusProgObjective(id) {
  const sel = document.getElementById('prog-objective-select');
  if (sel) { sel.value = id; renderProgressChart(); }
  document.getElementById('prog-chart-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderProgressSnapshots() {
  const el = document.getElementById('prog-snaps');
  if (!el) return;
  const snaps = (progressData.snapshots || []).slice().sort((a, b) => b - a);
  if (!snaps.length) { el.innerHTML = ''; return; }
  el.innerHTML = snaps.map((t, i) => {
    const when = new Date(t).toLocaleString(undefined,
      { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const tag = i === 0 ? '<span class="prog-snap-latest">latest</span>' : '';
    return `<div class="prog-snap-row">
      <span class="prog-snap-when">${when} ${tag}</span>
      <button class="prog-snap-del" title="Delete this snapshot" onclick="deletePrestigeSnapshot(${t})">✕</button>
    </div>`;
  }).join('');
}

async function deletePrestigeSnapshot(t) {
  try {
    await apiFetch(`${API}/api/prestige/progress?taken_at=${t}`, { method: 'DELETE' });
  } catch (e) { /* ignore */ }
  renderProgress();
}

async function clearPrestigeProgress() {
  if (!confirm('Delete ALL prestige snapshots? This cannot be undone.')) return;
  try {
    await apiFetch(`${API}/api/prestige/progress`, { method: 'DELETE' });
  } catch (e) { /* ignore */ }
  renderProgress();
}

// ── Upload handling ────────────────────────────────────────────────────────────

function wireProgressUpload() {
  if (progDropWired) return;
  const drop = document.getElementById('prog-drop');
  const file = document.getElementById('prog-file');
  if (!drop || !file) return;
  progDropWired = true;

  file.addEventListener('change', () => {
    if (file.files && file.files[0]) readProgressFile(file.files[0]);
  });
  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f) readProgressFile(f);
  });
}

function readProgressFile(f) {
  const reader = new FileReader();
  reader.onload = () => submitPrestigeJSON(reader.result, f.name);
  reader.readAsText(f);
}

function submitPrestigePaste() {
  const txt = document.getElementById('prog-paste')?.value || '';
  if (!txt.trim()) { setProgStatus('Paste your prestige JSON first.', 'err'); return; }
  submitPrestigeJSON(txt, 'pasted');
}

function setProgStatus(msg, kind) {
  const el = document.getElementById('prog-upload-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'prog-upload-status' + (kind ? ' ' + kind : '');
}

async function submitPrestigeJSON(text, source) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    setProgStatus('That is not valid JSON — check the paste.', 'err');
    return;
  }
  setProgStatus('Parsing…', '');
  try {
    const res = await apiFetch(`${API}/api/prestige/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setProgStatus(err.detail || `Upload failed (${res.status}).`, 'err');
      return;
    }
    const data = await res.json();
    setProgStatus(
      data.inserted
        ? `✓ Saved snapshot — ${data.count} objectives parsed.`
        : `No change since last snapshot (${data.count} objectives).`,
      'ok');
    const paste = document.getElementById('prog-paste');
    if (paste) paste.value = '';
    const file = document.getElementById('prog-file');
    if (file) file.value = '';
    renderProgress();
  } catch (e) {
    setProgStatus('Upload failed — is the server running?', 'err');
  }
}

// ── Price table tooltip ───────────────────────────────────────────────────────

let _priceTooltip = null;
let _tooltipActive = false;

function getPriceTooltip() {
  if (!_priceTooltip) {
    _priceTooltip = document.createElement('div');
    _priceTooltip.className = 'price-tooltip';
    document.body.appendChild(_priceTooltip);
  }
  return _priceTooltip;
}

function buildTooltipHtml(crop) {
  const priceMap = fullPriceMap;
  const iconHtml = crop.icon
    ? `<img src="/static/icons/${crop.icon}?v=tp1" class="pt-icon" alt="" />`
    : `<span class="pt-emoji">${crop.emoji}</span>`;

  // Raw crop
  if (crop.recipe_type === 'raw') {
    const dphRow = crop.dph != null
      ? `<div class="pt-row"><span class="pt-label">$/hr</span><span class="pt-val pt-yellow">$${crop.dph.toFixed(2)}</span></div>` : '';
    const growRow = crop.grow_time_min != null
      ? `<div class="pt-row"><span class="pt-label">Grow time</span><span class="pt-val">${crop.grow_time_min}m</span></div>` : '';
    return `<div class="pt-header">${iconHtml}<div><div class="pt-name">${crop.name}</div><div class="pt-sub">${crop.minecraft_name || 'Raw crop'}</div></div></div>
      <div class="pt-divider"></div>
      <div class="pt-row"><span class="pt-label">Sell price</span><span class="pt-val pt-green">$${crop.current_price?.toFixed(2) ?? '—'}</span></div>
      ${growRow}${dphRow}`;
  }

  // No recipe known
  if (!crop.recipe) {
    return `<div class="pt-header">${iconHtml}<div class="pt-name">${crop.name}</div></div>
      <div class="pt-divider"></div>
      <div class="pt-muted">Recipe not yet known</div>`;
  }

  // Crafted / smelted / combo
  let inputCost = 0;
  let allKnown = true;
  const ings = Object.entries(crop.recipe).map(([name, qty]) => {
    const unit = priceMap[name] ?? null;
    const total = unit != null ? qty * unit : null;
    if (total != null) inputCost += total; else allKnown = false;
    return { name, qty, unit, total };
  });

  const outputQty   = crop.output_qty ?? 1;
  const outputPrice = crop.current_price;
  const outputVal   = outputPrice != null ? outputQty * outputPrice : null;
  const profit      = (allKnown && outputVal != null) ? outputVal - inputCost : null;
  const profitCls   = profit == null ? '' : profit > 0 ? 'pt-green' : profit < 0 ? 'pt-red' : '';
  const profitSign  = profit != null && profit > 0 ? '+' : '';

  const typeLabel = crop.recipe_type === 'smelted' ? 'Smelted' : crop.recipe_type === 'crafted' ? 'Crafted' : 'Combo';

  const ingRows = ings.map(ing => `
    <div class="pt-ing-row">
      <span class="pt-ing-qty">${ing.qty}×</span>
      <span class="pt-ing-name">${ing.name}</span>
      <span class="pt-ing-unit">${ing.unit != null ? `$${ing.unit.toFixed(2)}` : '—'}</span>
      <span class="pt-ing-total">${ing.total != null ? `$${ing.total.toFixed(2)}` : '—'}</span>
    </div>`).join('');

  return `<div class="pt-header">${iconHtml}<div><div class="pt-name">${crop.name}</div><div class="pt-sub">${typeLabel} · ${outputQty}× output</div></div></div>
    <div class="pt-divider"></div>
    <div class="pt-ing-head"><span>Ingredient</span><span>Unit</span><span>Total</span></div>
    ${ingRows}
    <div class="pt-divider"></div>
    <div class="pt-row"><span class="pt-label">Input cost</span><span class="pt-val pt-red">$${inputCost.toFixed(2)}</span></div>
    <div class="pt-row"><span class="pt-label">Output value</span><span class="pt-val">${outputVal != null ? `$${outputVal.toFixed(2)}` : '—'}</span></div>
    <div class="pt-divider"></div>
    <div class="pt-row pt-profit-row"><span class="pt-label">Craft profit</span><span class="pt-val ${profitCls}">${profit != null ? `${profitSign}$${profit.toFixed(2)}` : '—'}</span></div>`;
}

function initTableTooltip() {
  const tbody = document.getElementById('table-body');
  if (!tbody || tbody._tooltipBound) return;
  tbody._tooltipBound = true;

  const tip = getPriceTooltip();

  tbody.addEventListener('mouseover', e => {
    const row = e.target.closest('tr[data-id]');
    if (!row) { tip.classList.remove('visible'); return; }
    const crop = allCrops.find(c => c.id === row.dataset.id);
    if (!crop) return;
    tip.innerHTML = buildTooltipHtml(crop);
    tip.classList.add('visible');
  });

  tbody.addEventListener('mouseleave', () => tip.classList.remove('visible'));

  document.addEventListener('mousemove', e => {
    if (!tip.classList.contains('visible')) return;
    const gap = 18;
    let x = e.clientX + gap;
    let y = e.clientY + gap;
    if (x + tip.offsetWidth  > window.innerWidth  - 8) x = e.clientX - tip.offsetWidth  - gap;
    if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - gap;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  });
}

// ── Purity axis hover tooltips (Value / Progress / Score) ──────────────────────
// Reuses the price-table tooltip chrome, tinted per axis to echo the in-game tips.
const PURITY_TIPS = {
  v: { title: 'Value',    color: '#5ce65c', body: 'Increases the dollar amount the chem sells for.' },
  p: { title: 'Progress', color: '#ff6ec7', body: 'Increases the prestige progress earned when sold.' },
  s: { title: 'Score',    color: '#4fd6e6', body: 'Increases the event, leaderboard and mission score when sold.' },
};

let _infoTip = null;
function getInfoTip() {
  if (!_infoTip) {
    _infoTip = document.createElement('div');
    _infoTip.className = 'price-tooltip info-tip';
    document.body.appendChild(_infoTip);
  }
  return _infoTip;
}

function initPurityTips() {
  if (document._purityTipsBound) return;
  document._purityTipsBound = true;
  const tip = getInfoTip();

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const t = PURITY_TIPS[el.dataset.tip];
    if (!t) return;
    tip.style.setProperty('--tip-accent', t.color);
    tip.innerHTML = `<div class="info-tip-title">${t.title}</div><div class="info-tip-body">${t.body}</div>`;
    tip.classList.add('visible');
  });

  document.addEventListener('mouseout', e => {
    const el = e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) tip.classList.remove('visible');
  });

  document.addEventListener('mousemove', e => {
    if (!tip.classList.contains('visible')) return;
    const gap = 16;
    let x = e.clientX + gap;
    let y = e.clientY + gap;
    if (x + tip.offsetWidth  > window.innerWidth  - 8) x = e.clientX - tip.offsetWidth  - gap;
    if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - gap;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  });
}

// ── Sushi calculator ──────────────────────────────────────────────────────────

const SUSHI_FISH = [
  { id: 'cod',        name: 'Cod',          icon: 'cod.png',          sashimi:  30.75, nigiri:   82.84, maki:  32.72 },
  { id: 'salmon',     name: 'Salmon',       icon: 'salmon.png',       sashimi:  73.80, nigiri:  138.39, maki:  39.97 },
  { id: 'pufferfish', name: 'Pufferfish',   icon: 'pufferfish.png',   sashimi: 141.96, nigiri:  226.33, maki:  51.44 },
  { id: 'tropical',   name: 'Tropical Fish',icon: 'tropical_fish.png',sashimi: 922.50, nigiri: 1233.42, maki: 182.80 },
];

// Crafted sushi rice: 1 vinegar ($25) + 4 rice ($10ea) → 4 sushi rice = $16.25 each
const SUSHI_RICE_CRAFT = (25 + 4 * 10) / 4;
const SUSHI_RICE_BUY   = 21.33;
const SUSHI_NORI_COST  = 14.80;

let sushiRiceMode = 'craft';
let sushiNoriMode = 'farm';

function getSushiRiceCost() {
  return sushiRiceMode === 'craft' ? SUSHI_RICE_CRAFT : SUSHI_RICE_BUY;
}

function getSushiNoriCost() {
  return sushiNoriMode === 'farm' ? 0 : SUSHI_NORI_COST;
}

function calcSushiRoutes(fish) {
  const rice = getSushiRiceCost();

  // Sashimi: 1 fish → 1 sashimi
  const sashimiRev  = fish.sashimi * 1;
  const sashimiCost = 0;

  // Nigiri: 1 fish → 3 sliced → 1.5 nigiri (2 sliced + 2 rice → 1 nigiri; optimal at 2 fish/batch)
  const nigiriRev  = fish.nigiri * 1.5;
  const nigiriCost = 3 * rice;            // 1.5 nigiri × 2 rice each

  // Maki: 1 fish → 3 sliced → 3 batches (1 sliced + 3 rice + 3 nori → 4 maki)
  const nori     = getSushiNoriCost();
  const makiRev  = fish.maki * 12;        // 3 batches × 4 maki
  const makiCost = 9 * rice + 9 * nori;  // 3 batches × (3 rice + 3 nori)

  return [
    { label: 'Sashimi', rev: sashimiRev, cost: sashimiCost, net: sashimiRev - sashimiCost,
      detail: '1 fish → 1 sashimi' },
    { label: 'Nigiri',  rev: nigiriRev,  cost: nigiriCost,  net: nigiriRev  - nigiriCost,
      detail: '1 fish → 3 sliced → 1.5 nigiri + 3 sushi rice' },
    { label: 'Maki',    rev: makiRev,    cost: makiCost,    net: makiRev    - makiCost,
      detail: '1 fish → 3 sliced → 3 batches of 4 maki (9 rice + 9 nori)' },
  ];
}

function setSushiRiceMode(mode) {
  sushiRiceMode = mode;
  document.querySelectorAll('.sushi-rice-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  renderSushi();
}

function setSushiNoriMode(mode) {
  sushiNoriMode = mode;
  document.querySelectorAll('.sushi-nori-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  renderSushi();
}

function renderSushi() {
  const el = document.getElementById('sushi-results');
  if (!el) return;

  let html = '<div class="sushi-grid">';

  for (const fish of SUSHI_FISH) {
    const qty     = parseInt(document.getElementById(`sushi-qty-${fish.id}`)?.value) || 0;
    const routes  = calcSushiRoutes(fish).sort((a, b) => b.net - a.net);
    const best    = routes[0];
    const showQty = qty > 0;

    const pctDiff = (r) => {
      if (r === best) return '';
      const diff = ((r.net - best.net) / best.net * 100).toFixed(0);
      return `<span class="sushi-pct-diff">${diff}%</span>`;
    };

    html += `<div class="sushi-card card">
      <div class="sushi-card-header">
        <img src="/static/icons/${fish.icon}?v=tp1" class="sushi-fish-icon" alt="${fish.name}" />
        <span class="sushi-fish-name">${fish.name}</span>
        <span class="sushi-best-tag">Best: ${best.label}</span>
      </div>
      <table class="sushi-table">
        <thead><tr>
          <th>Route</th>
          <th>Revenue / fish</th>
          <th>Ingredient cost</th>
          <th>Net / fish</th>
          ${showQty ? `<th>×${qty.toLocaleString()} total</th>` : ''}
        </tr></thead>
        <tbody>`;

    for (const r of routes) {
      const isBest = r === best;
      html += `<tr class="${isBest ? 'sushi-best-row' : ''}">
        <td class="sushi-route-label" title="${r.detail}">${isBest ? '★ ' : ''}${r.label}</td>
        <td class="sushi-num">$${r.rev.toFixed(2)}</td>
        <td class="sushi-num sushi-cost-col">${r.cost > 0 ? `−$${r.cost.toFixed(2)}` : '—'}</td>
        <td class="sushi-num ${isBest ? 'sushi-net-best' : 'sushi-net-dim'}">$${r.net.toFixed(2)}${pctDiff(r)}</td>
        ${showQty ? `<td class="sushi-num sushi-total-val">$${(r.net * qty).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>` : ''}
      </tr>`;
    }

    html += `</tbody></table>`;

    if (showQty) {
      // Materials needed for maki (always show since it's usually best)
      const makiRoute   = routes.find(r => r.label === 'Maki');
      const totalSushiRice = qty * 9;
      const riceBatches    = Math.ceil(totalSushiRice / 4);
      const rawRiceNeeded  = riceBatches * 4;
      const vinegarNeeded  = riceBatches;
      const noriNeeded     = qty * 9;
      const noriTag = sushiNoriMode === 'farm'
        ? `<span class="sushi-mat-sub sushi-mat-farmed">farmed</span>`
        : '';

      const riceStats = sushiRiceMode === 'craft'
        ? `<div class="sushi-mat-stat">
             <span class="sushi-mat-n">${vinegarNeeded.toLocaleString()}</span>
             <span class="sushi-mat-l">Vinegar</span>
           </div>
           <div class="sushi-mat-div"></div>
           <div class="sushi-mat-stat">
             <span class="sushi-mat-n">${rawRiceNeeded.toLocaleString()}</span>
             <span class="sushi-mat-l">Raw Rice</span>
           </div>`
        : `<div class="sushi-mat-stat">
             <span class="sushi-mat-n">${totalSushiRice.toLocaleString()}</span>
             <span class="sushi-mat-l">Sushi Rice</span>
           </div>`;

      html += `<div class="sushi-card-footer">
        <div class="sushi-footer-result">
          ${qty.toLocaleString()} fish → <strong>$${(best.net * qty).toLocaleString(undefined, {maximumFractionDigits: 0})}</strong> net via ${best.label}
        </div>
        <div class="sushi-footer-mats">
          <span class="sushi-mats-label">Maki needs</span>
          <div class="sushi-materials">
            <div class="sushi-mat-stat">
              <span class="sushi-mat-n">${noriNeeded.toLocaleString()}</span>
              <span class="sushi-mat-l">Nori ${noriTag}</span>
            </div>
            <div class="sushi-mat-div"></div>
            ${riceStats}
          </div>
        </div>
      </div>`;
    }

    html += `</div>`;
  }

  html += '</div>';
  el.innerHTML = html;
}

// ── Vote tracker ──────────────────────────────────────────────────────────────

// Two reset models:
//   resetHourPT: fixed daily reset at this Pacific-time hour (24h clock)
//   cooldown:    rolling N hours measured from the moment you voted
const VOTE_SITES = [
  { id: 'msl',   name: 'Minecraft Server List', short: 'MSL',  icon: 'vote-msl.png',   url: 'https://minecraft-server-list.com/server/324751/vote/', color: '#4a9eff', resetHourPT: 16 },
  { id: 'buzz',  name: 'Minecraft Buzz',         short: 'BUZZ', icon: 'vote-buzz.png',  url: 'https://minecraft.buzz/vote/19921',                    color: '#f5a623', cooldown: 24 },
  { id: 'mp',    name: 'Minecraft MP',            short: 'MP',   icon: 'vote-mp.png',    url: 'https://minecraft-mp.com/server/66047/vote/',          color: '#3fb950', resetHourPT: 21 },
  { id: 'topg',  name: 'TopG.org',                short: 'TOPG', icon: 'vote-topg.png',  url: 'https://topg.org/minecraft-servers/server-650819',    color: '#9b59b6', resetHourPT: 19 },
  { id: 'msorg', name: 'MinecraftServers.org',    short: 'MSO',  icon: 'vote-msorg.png', url: 'https://minecraftservers.org/vote/186213',             color: '#e74c3c', resetHourPT: 17 },
  { id: 'pmc',   name: 'Planet Minecraft',        short: 'PMC',  icon: 'vote-pmc.png',   url: 'https://www.planetminecraft.com/server/mclabs-chems-cops-and-factions/vote/', color: '#1abc9c', resetHourPT: 21 },
  { id: 'tms',   name: 'Top MC Servers',          short: 'TMS',  icon: 'vote-tms.png',   url: 'https://topminecraftservers.org/vote/1861',            color: '#e67e22', resetHourPT: 21 },
];

let voteTickInterval = null;
let voteState = {};          // { site_id: voted_at_ms } loaded from server
let voteStateLoaded = false;

const PT_TZ = 'America/Los_Angeles';
const _ptFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: PT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

function _ptParts(date) {
  const o = _ptFmt.formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  let hh = parseInt(o.hour); if (hh === 24) hh = 0;
  return { y: +o.year, m: +o.month, d: +o.day, h: hh, min: +o.minute, s: +o.second };
}

// Epoch ms at which Pacific wall-clock reads y-m-d hourPT:00:00 (DST-aware).
function _ptWallToEpoch(y, m, d, hourPT) {
  let guess = Date.UTC(y, m - 1, d, hourPT, 0, 0);
  for (let i = 0; i < 2; i++) {
    const p = _ptParts(new Date(guess));
    const asIfUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    const offset = asIfUTC - guess;          // how far Pacific leads UTC (negative)
    guess = Date.UTC(y, m - 1, d, hourPT, 0, 0) - offset;
  }
  return guess;
}

// Next time Pacific clock hits hourPT:00, strictly after afterMs.
function nextPacificReset(afterMs, hourPT) {
  for (let addDay = 0; addDay <= 2; addDay++) {
    const base  = _ptParts(new Date(afterMs + addDay * 86400000));
    const epoch = _ptWallToEpoch(base.y, base.m, base.d, hourPT);
    if (epoch > afterMs) return epoch;
  }
  return afterMs + 86400000;
}

// Epoch ms when a site becomes votable again after a vote at votedAt.
function voteReadyAt(site, votedAt) {
  if (site.resetHourPT != null) return nextPacificReset(votedAt, site.resetHourPT);
  return votedAt + (site.cooldown || 24) * 3600000;
}

async function loadVoteState() {
  try {
    const res = await apiFetch(`${API}/api/votes`);
    voteState = await res.json();
  } catch (_) {
    voteState = {};
  }
  voteStateLoaded = true;
}

function isVoteReady(site) {
  const voted = voteState[site.id] || 0;
  return !voted || Date.now() >= voteReadyAt(site, voted);
}

function msUntilReady(site) {
  const voted = voteState[site.id] || 0;
  if (!voted) return 0;
  return Math.max(0, voteReadyAt(site, voted) - Date.now());
}

function voteResetLabel(site) {
  if (site.resetHourPT != null) {
    const h = site.resetHourPT;
    const h12 = ((h + 11) % 12) + 1;
    const ap  = h < 12 ? 'AM' : 'PM';
    return `Resets ${h12}${ap} PT`;
  }
  return `${site.cooldown || 24}h after vote`;
}

function formatVoteTimer(ms) {
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

async function recordVote(id) {
  const site = VOTE_SITES.find(s => s.id === id);
  if (!site) return;
  window.open(site.url, '_blank');
  // Optimistically update locally, then persist to server
  voteState[id] = Date.now();
  renderVoting();
  scheduleVoteNotification();
  try {
    const res = await apiFetch(`${API}/api/votes/${id}`, { method: 'POST' });
    const data = await res.json();
    voteState[id] = data.voted_at;   // use server timestamp as source of truth
  } catch (_) { /* keep optimistic value if offline */ }
}

function scheduleVoteNotification() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (window._voteNotifTimeout) clearTimeout(window._voteNotifTimeout);
  const lastMs = Math.max(...VOTE_SITES.map(s => msUntilReady(s)));
  if (lastMs > 0) {
    window._voteNotifTimeout = setTimeout(() => {
      new Notification('MCLabs — Vote Ready!', {
        body: 'All 7 vote sites have reset. Vote now to earn in-game rewards!',
        icon: 'https://labs-mc.com/data/assets/logo/mclabsc.png',
      });
    }, lastMs + 500);
  }
}

function requestVoteNotifications() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(perm => {
    renderVoting();
    if (perm === 'granted') scheduleVoteNotification();
  });
}

function updateVoteSummary() {
  const el = document.getElementById('vote-summary');
  if (!el) return;
  const readyCount = VOTE_SITES.filter(s => isVoteReady(s)).length;
  const votedCount = VOTE_SITES.length - readyCount;
  const nextMs = VOTE_SITES.reduce((min, s) => {
    const ms = msUntilReady(s);
    return ms > 0 && ms < min ? ms : min;
  }, Infinity);

  el.innerHTML = `
    <div class="vote-sum-inner">
      <div class="vote-sum-stat">
        <span class="vote-sum-n${readyCount === VOTE_SITES.length ? ' vote-sum-all-ready' : ''}">${readyCount}</span>
        <span class="vote-sum-l">Ready to Vote</span>
      </div>
      <div class="vote-sum-div"></div>
      <div class="vote-sum-stat">
        <span class="vote-sum-n">${votedCount}</span>
        <span class="vote-sum-l">Voted Today</span>
      </div>
      ${nextMs < Infinity ? `
      <div class="vote-sum-div"></div>
      <div class="vote-sum-stat">
        <span class="vote-sum-n vote-sum-timer" id="vote-sum-next">${formatVoteTimer(nextMs)}</span>
        <span class="vote-sum-l">Next Site Resets</span>
      </div>` : ''}
      <div class="vote-sum-bar-wrap">
        <div class="vote-sum-bar-fill" style="width:${(votedCount / VOTE_SITES.length * 100).toFixed(1)}%"></div>
      </div>
    </div>`;
}

function tickVoteTimers() {
  let anyExpired = false;

  for (const site of VOTE_SITES) {
    const ms    = msUntilReady(site);
    const cardEl  = document.getElementById('vote-card-'  + site.id);
    const btnEl   = document.getElementById('vote-btn-'   + site.id);
    const timerEl = document.getElementById('vote-timer-' + site.id);
    if (!timerEl) continue;

    if (ms <= 0) {
      if (btnEl && btnEl.disabled) anyExpired = true;  // just flipped to ready
      timerEl.textContent = '';
      cardEl?.classList.remove('vote-card-voted');
      if (btnEl) { btnEl.textContent = 'Vote Now'; btnEl.disabled = false; btnEl.classList.remove('vote-btn-voted'); }
    } else {
      timerEl.textContent = formatVoteTimer(ms);
    }
  }

  // Update summary "Next Site Resets" timer in-place
  const nextEl = document.getElementById('vote-sum-next');
  if (nextEl) {
    const nextMs = VOTE_SITES.reduce((min, s) => {
      const ms = msUntilReady(s);
      return ms > 0 && ms < min ? ms : min;
    }, Infinity);
    nextEl.textContent = nextMs < Infinity ? formatVoteTimer(nextMs) : '';
  }

  if (anyExpired) {
    updateVoteSummary();
    if (VOTE_SITES.every(s => isVoteReady(s)) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('MCLabs — Vote Ready!', {
        body: 'All 7 vote sites have reset. Vote now to earn in-game rewards!',
        icon: 'https://labs-mc.com/data/assets/logo/mclabsc.png',
      });
    }
  }
}

// ── Phone push (ntfy) ─────────────────────────────────────────────────────────

let ntfyConfig = { topic: '', server: 'https://ntfy.sh', enabled: false };
let ntfyConfigLoaded = false;

async function loadNtfyConfig() {
  try {
    const res = await apiFetch(`${API}/api/vote-config`);
    ntfyConfig = await res.json();
  } catch (_) { /* keep defaults */ }
  ntfyConfigLoaded = true;
}

function genNtfyTopic() {
  const rnd = Math.random().toString(36).slice(2, 10);
  const el = document.getElementById('ntfy-topic');
  if (el) { el.value = 'mclabs-vote-' + rnd; el.focus(); }
}

async function saveNtfyConfig() {
  const topic   = document.getElementById('ntfy-topic')?.value.trim() || '';
  const enabled = document.getElementById('ntfy-enabled')?.checked || false;
  const status  = document.getElementById('ntfy-status');
  if (status) status.textContent = 'Saving...';
  try {
    const res = await apiFetch(`${API}/api/vote-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, enabled }),
    });
    ntfyConfig = await res.json();
    if (status) status.textContent = 'Saved ✓';
  } catch (e) {
    if (status) status.textContent = 'Save failed';
  }
}

async function testNtfyPush() {
  const status = document.getElementById('ntfy-status');
  const topic  = document.getElementById('ntfy-topic')?.value.trim() || '';
  if (!topic) { if (status) status.textContent = 'Enter a topic first'; return; }
  if (status) status.textContent = 'Sending test...';
  await saveNtfyConfig();   // persist latest topic before testing
  try {
    const res = await apiFetch(`${API}/api/vote-test-push`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).detail || 'failed');
    if (status) status.textContent = 'Test sent — check your phone 📱';
  } catch (e) {
    if (status) status.textContent = 'Test failed: ' + e.message;
  }
}

function renderNtfyCard() {
  const el = document.getElementById('vote-ntfy');
  if (!el) return;
  const topic  = ntfyConfig.topic || '';
  const server = (ntfyConfig.server || 'https://ntfy.sh').replace(/\/$/, '');
  const subUrl = topic ? `${server}/${topic}` : '';

  el.innerHTML = `
    <div class="ntfy-head">
      <span class="ntfy-icon">📱</span>
      <div class="ntfy-head-text">
        <span class="ntfy-title">Phone Notifications (ntfy)</span>
        <span class="ntfy-sub">Get a push on your iPhone when all 7 sites are ready — even with the app closed.</span>
      </div>
      <label class="ntfy-toggle">
        <input type="checkbox" id="ntfy-enabled" ${ntfyConfig.enabled ? 'checked' : ''} onchange="saveNtfyConfig()" />
        <span>Enabled</span>
      </label>
    </div>
    <div class="ntfy-row">
      <input type="text" id="ntfy-topic" class="ntfy-input" placeholder="your-secret-topic-name"
             value="${topic}" spellcheck="false" autocapitalize="off" />
      <button class="btn btn-secondary" onclick="genNtfyTopic()">Generate</button>
      <button class="btn btn-primary" onclick="saveNtfyConfig()">Save</button>
      <button class="btn btn-secondary" onclick="testNtfyPush()">Send Test</button>
    </div>
    <div class="ntfy-status" id="ntfy-status"></div>
    <ol class="ntfy-steps">
      <li>Install the <strong>ntfy</strong> app from the App Store.</li>
      <li>Pick a hard-to-guess topic name above (topics on ntfy.sh are public), then hit <strong>Save</strong>.</li>
      <li>In the ntfy app, tap ＋ and subscribe to that exact topic on server <code>ntfy.sh</code>.</li>
      <li>Tap <strong>Send Test</strong> to confirm it reaches your phone.</li>
    </ol>
    ${subUrl ? `<a class="ntfy-link" href="${subUrl}" target="_blank">Open ${subUrl} ↗</a>` : ''}`;
}

async function renderVoting() {
  const grid = document.getElementById('vote-grid');
  if (!grid) return;

  if (!voteStateLoaded) {
    grid.innerHTML = '<div class="loading">Loading vote status...</div>';
    await loadVoteState();
  }
  if (!ntfyConfigLoaded) await loadNtfyConfig();
  renderNtfyCard();

  // Notification permission bar
  const notifBar = document.getElementById('vote-notif-bar');
  if (notifBar) {
    if (!('Notification' in window) || Notification.permission === 'denied') {
      notifBar.innerHTML = '';
    } else if (Notification.permission === 'default') {
      notifBar.innerHTML = `
        <div class="vote-notif-prompt">
          <span class="vote-notif-icon">🔔</span>
          <span class="vote-notif-text">Get notified when all vote sites reset</span>
          <button class="btn btn-primary" onclick="requestVoteNotifications()">Enable Notifications</button>
        </div>`;
    } else {
      notifBar.innerHTML = `<div class="vote-notif-on">🔔 Notifications on — you'll be alerted when all 7 sites reset</div>`;
    }
  }

  updateVoteSummary();

  grid.innerHTML = VOTE_SITES.map(site => {
    const ready = isVoteReady(site);
    const ms    = msUntilReady(site);
    const iconInner = site.icon
      ? `<img src="/static/icons/${site.icon}?v=tp1" class="vote-badge-icon" alt="${site.name}"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
         <span class="vote-badge-text" style="display:none">${site.short}</span>`
      : `<span class="vote-badge-text">${site.short}</span>`;

    return `<div class="vote-card${ready ? '' : ' vote-card-voted'}" id="vote-card-${site.id}">
      <div class="vote-badge" style="box-shadow: 0 6px 22px ${site.color}33, 0 1px 0 rgba(255,255,255,0.12) inset; border-color: ${site.color}55;">
        ${iconInner}
      </div>
      <div class="vote-site-name">${site.name}</div>
      <div class="vote-reset-label">${voteResetLabel(site)}</div>
      <button class="vote-btn${ready ? '' : ' vote-btn-voted'}"
              id="vote-btn-${site.id}"
              onclick="recordVote('${site.id}')"
              ${ready ? '' : 'disabled'}>
        ${ready ? 'Vote Now' : '✓ Voted'}
      </button>
      <div class="vote-timer" id="vote-timer-${site.id}">${ready ? '' : formatVoteTimer(ms)}</div>
    </div>`;
  }).join('');

  if (!voteTickInterval) {
    voteTickInterval = setInterval(tickVoteTimers, 1000);
  }
}

// ── Ranks page ────────────────────────────────────────────────────────────────
// "How much more money to reach a target rank?" All rank/cost data and the pure
// math live in window.RANKS (ranks.js); this section is only wiring + display.

let ranksInitialized = false;
let ranksCombos = null; // { curP, curR, tgtP, tgtR } combobox handles

const RANKS_COUNTUP_MS = 320; // motion budget — stays under the project's ~320ms cap

function ranksFmtMoney(n) {
  return '$' + Math.round(Math.max(0, n)).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function ranksFmtPct(p) {
  const v = Math.max(0, Math.min(100, p));
  if (v === 0 || v === 100) return Math.round(v) + '%';
  if (v < 1) return v.toFixed(2) + '%';
  if (v < 10) return v.toFixed(1) + '%';
  return Math.round(v) + '%';
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Animated count-up from the element's last numeric value to `to`. `fmt` renders
// each frame. Cancels any in-flight tween on the same element. Snaps instantly when
// reduced motion is requested or animation is suppressed (`animate === false`).
function countUp(el, to, fmt, animate) {
  if (!el) return;
  const from = Number(el.dataset.val) || 0;
  el.dataset.val = String(to);
  if (el._raf) { cancelAnimationFrame(el._raf); el._raf = null; }
  if (animate === false || prefersReducedMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / RANKS_COUNTUP_MS);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = fmt(from + (to - from) * eased);
    if (t < 1) { el._raf = requestAnimationFrame(step); }
    else { el._raf = null; el.textContent = fmt(to); }
  };
  el._raf = requestAnimationFrame(step);
}

function ranksEscape(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// The cumulative "rewards along the way": every rankup from the current position
// to the target, grouped by prestige tier, each with its step cost and unlock.
function renderRanksPath(curP, curR, tgtP, tgtR) {
  const mount = document.getElementById('ranks-rewards');
  const chip = document.getElementById('ranks-rewards-rank');
  if (!mount) return;
  const R = window.RANKS;

  if (chip) {
    const tname = (tgtR !== '' && R) ? R.RANK_ORDER[Number(tgtR)] : '';
    chip.textContent = tname ? '→ ' + tname : '';
  }

  const path = R ? R.rankupPath(curP, curR, tgtP, tgtR) : { ok: false };
  if (!path.ok || !path.steps.length) {
    mount.innerHTML = '<p class="ranks-rewards-note">Pick a target ahead of your current rank to see everything you’ll unlock on the way.</p>';
    return;
  }

  // Group consecutive steps by prestige tier (preserves ladder order).
  const groups = [];
  path.steps.forEach((s) => {
    let g = groups[groups.length - 1];
    if (!g || g.prestige !== s.prestige) {
      g = { prestige: s.prestige, label: s.prestigeLabel, steps: [], sum: 0 };
      groups.push(g);
    }
    g.steps.push(s);
    g.sum += s.cost;
  });

  let stepNo = 0; // global index, for capped stagger delay
  const STAGGER_CAP = 10;
  let html = '<div class="ranks-path">';
  groups.forEach((g) => {
    html += '<div class="ranks-path-group">'
      + '<div class="ranks-path-group-head">'
      + '<span class="ranks-path-tier">' + ranksEscape(g.label) + '</span>'
      + '<span class="ranks-path-tier-sum">' + ranksFmtMoney(g.sum) + '</span>'
      + '</div>';
    const paid = g.steps.filter((s) => s.cost > 0);
    if (!paid.length) {
      html += '<p class="ranks-path-note">Prestige up — no rankup cost.</p>';
    } else {
      html += '<ol class="ranks-path-steps">';
      paid.forEach((s, idx) => {
        const isTarget = s.rankName === (R.RANK_ORDER[Number(tgtR)]) && s.prestige === String(tgtP);
        const delay = Math.min(stepNo, STAGGER_CAP) * 35;
        stepNo++;
        const lastInGroup = idx === paid.length - 1;
        html += '<li class="ranks-path-step' + (isTarget ? ' is-target' : '')
          + (lastInGroup ? ' is-last' : '') + '" style="--d:' + delay + 'ms">'
          + '<span class="ranks-path-dot"></span>'
          + '<div class="ranks-path-body">'
          + '<div class="ranks-path-line">'
          + '<span class="ranks-path-rank">' + ranksEscape(s.rankName) + '</span>'
          + '<span class="ranks-path-cost">' + ranksFmtMoney(s.cost) + '</span>'
          + '</div>'
          + (s.reward
            ? '<div class="ranks-path-perk">' + ranksEscape(s.reward) + '</div>'
            : '')
          + '</div>'
          + '</li>';
      });
      html += '</ol>';
    }
    html += '</div>';
  });
  html += '</div>';
  mount.innerHTML = html;
}

function ranksInvalid(message) {
  const msg = document.getElementById('ranks-msg');
  if (msg) { msg.textContent = message; msg.hidden = false; }
  ['ranks-kpi-needed', 'ranks-kpi-remaining', 'ranks-kpi-pct'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '—'; el.dataset.val = '0'; }
  });
  const fill = document.getElementById('ranks-progress-fill');
  const bar = document.getElementById('ranks-progress');
  const pctLabel = document.getElementById('ranks-progress-pct');
  if (fill) fill.style.transform = 'scaleX(0)';
  if (bar) bar.setAttribute('aria-valuenow', '0');
  if (pctLabel) pctLabel.textContent = '—';
}

function recompute(animate, renderPath) {
  const R = window.RANKS;
  if (!R || !ranksCombos) return;
  const curP = ranksCombos.curP.getValue();
  const curR = ranksCombos.curR.getValue();
  const tgtP = ranksCombos.tgtP.getValue();
  const tgtR = ranksCombos.tgtR.getValue();

  // The path only changes when the position changes — skip it on balance keystrokes.
  if (renderPath) renderRanksPath(curP, curR, tgtP, tgtR);

  if (curP === '' || curR === '' || tgtP === '' || tgtR === '') {
    ranksInvalid('Pick your current and target rank to see the cost.');
    return;
  }

  const res = R.moneyNeeded(curP, curR, tgtP, tgtR);
  if (!res.ok) { ranksInvalid(res.error); return; }

  const msg = document.getElementById('ranks-msg');
  if (msg) { msg.hidden = true; msg.textContent = ''; }

  const balanceEl = document.getElementById('ranks-balance');
  const balance = balanceEl ? Number(balanceEl.value) : 0;
  const prog = R.progressToTarget(res.needed, balance);

  countUp(document.getElementById('ranks-kpi-needed'), res.needed, ranksFmtMoney, animate);
  countUp(document.getElementById('ranks-kpi-remaining'), prog.remaining, ranksFmtMoney, animate);
  countUp(document.getElementById('ranks-kpi-pct'), prog.pct, ranksFmtPct, animate);

  const fill = document.getElementById('ranks-progress-fill');
  const bar = document.getElementById('ranks-progress');
  const pctLabel = document.getElementById('ranks-progress-pct');
  if (fill) fill.style.transform = 'scaleX(' + (prog.pct / 100) + ')';
  if (bar) bar.setAttribute('aria-valuenow', String(Math.round(prog.pct)));
  if (pctLabel) pctLabel.textContent = ranksFmtPct(prog.pct);
}

function buildRankCombo(mountId, items, placeholder) {
  return createCompoundCombobox({
    mount: document.getElementById(mountId),
    grouped: false,
    placeholder,
    items,
    onSelect: () => recompute(true, true), // selection is occasional — animate + redraw path
  });
}

function initRanks() {
  const R = window.RANKS;
  const mount = document.getElementById('ranks-cur-prestige');
  if (!R || !mount || ranksInitialized) return;

  const prestigeItems = R.PRESTIGE_ORDER.map(k => ({ id: k, name: R.prestigeLabel(k) }));
  const rankItems = R.RANK_ORDER.map((name, i) => ({ id: String(i), name }));

  ranksCombos = {
    curP: buildRankCombo('ranks-cur-prestige', prestigeItems, 'Current prestige…'),
    curR: buildRankCombo('ranks-cur-rank', rankItems, 'Current rank…'),
    tgtP: buildRankCombo('ranks-tgt-prestige', prestigeItems, 'Target prestige…'),
    tgtR: buildRankCombo('ranks-tgt-rank', rankItems, 'Target rank…'),
  };

  // Defaults: current = Prestige 0 / Junky, target = Prestige 0 / Director.
  ranksCombos.curP.setValue('0');
  ranksCombos.curR.setValue('0');
  ranksCombos.tgtP.setValue('0');
  ranksCombos.tgtR.setValue('12');

  // Balance is a high-frequency keyboard path — update without count-up animation.
  const balanceEl = document.getElementById('ranks-balance');
  if (balanceEl) balanceEl.addEventListener('input', () => recompute(false, false));

  ranksInitialized = true;
  recompute(true, true); // initial entrance count-up + path render
}

// ── Init ──────────────────────────────────────────────────────────────────────

init();
