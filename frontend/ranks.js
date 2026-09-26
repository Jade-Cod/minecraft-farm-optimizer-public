// Rank ladder data + pure calculations for the Ranks tab (Chem and Cop paths).
// Dual-environment: exposes window.RANKS in the browser and module.exports for
// plain `node` unit tests (frontend/ranks.test.js). No build step, no framework.
//
// A path is 13 ranks repeated across prestige tiers: tier 0 (no prestige),
// tiers 1..N, then Master Prestige as tier N+1. Each rankup has its own price; the
// first rank of a tier is reached by prestiging, which is free. Sources:
// https://labs-mc.com/wiki/Ranks and https://labs-mc.com/wiki/Kits
//
// Rewards depend on which tier the rankup happens in, so every rank has four
// reward columns: base (no prestige), odd tiers, even tiers and master. In the
// reward tokens a leading "!" marks a one-time unlock and a trailing "*" means
// "prestiges 1-3 only". "JS=3" raises the job slot cap to 3 (it isn't +3).
(function () {
  'use strict';

  const CHEM = {
    id: 'chem',
    ranks: ['Junky', 'Intern', 'Trainee', 'Assistant', 'Technician', 'Analyst', 'Engineer',
      'Bioengineer', 'Chemist', 'Biochemist', 'Alchemist', 'Pharmacologist', 'Director'],
    base: [0, 10000, 25000, 50000, 75000, 150000, 250000, 400000, 600000, 800000, 1500000, 2000000, 3000000],
    prestiges: 10,
    tierScale: (t) => 1 + 0.15 * t, // each prestige adds 15% of the base price
    unlockHint: 'sell your goal amount of one chem',
    perks: {
      base: [
        ['1 AH', '2 Homes', '1 JS'],
        ['!Runner Duty'],
        ['+1 Home', '!Police enroll'],
        ['!Smuggle Flights'],
        ['+1 AH'],
        ['+1 Home'],
        ['+1 CP', '+1 AH', 'New Lawyer'],
        ['+1 AH', '!/lab', '2x CF', '!Rent Super Rare+ on /rent'],
        ['+1 CP', '1x CF', '!Create Runner Jobs'],
        ['+1 RJ', '+1 JS', '!Bribes'],
        ['!/craft', '+1 CP', '+1 RJ', 'Bigger Chemtainer', 'Higher lab max crafts'],
        ['+1 CP', '1x CF', '1% Selling Bonus'],
        ['+1 Home', '+1 CP', '!Personal /mount'],
      ],
      odd: [null, ['+1 Home'], ['+1 AH', 'Bigger Chemtainer'], ['Shorter smuggle flight cooldown'], ['1x CF'],
        ['+1 RJ'], ['+1 CP'], ['New Lawyer'], ['1x CF'], ['Better bribes'], ['Less prison time'],
        ['1% Selling Bonus'], ['Faster mount']],
      even: [null, ['+1 Home'], ['+1 AH', 'Bigger Chemtainer'], ['Shorter smuggle flight cooldown'], [],
        ['Higher lab max crafts'], ['+1 CP'], ['New Lawyer'], ['1x CF'], ['Better bribes'],
        ['Shorter free lawyer cooldown'], ['1% Selling Bonus'], ['Faster mount']],
      master: [null, ['+1% Selling Bonus'], ['1x CF', '+1 AH', '+1 RJ', 'Bigger Chemtainer'],
        ['Shorter smuggle flight cooldown'], ['+1% Selling Bonus'], ['+1 Home', 'JS=3', 'Higher lab max crafts'],
        ['+1 CP'], ['New Lawyer', '1x Prestige Key', '+1 RJ'], ['1% Selling Bonus', '+1 Home', '+1 CP'],
        ['Better bribes', '1x Prestige Key'], ['+1% Selling Bonus', '+1 CP', '+1 RJ', '1x Prestige Key'],
        ['+1 CP', '+1 Home', '1x Prestige Key', '1% Selling Bonus'], ['1% Selling Bonus', '+1 CP', '+1 RJ', '2x Prestige Key']],
    },
    kitsAt(t, r) {
      if (t === 0) return r ? [['Farm', 'Scaffolding', 'Blocks', 'Caving', 'Boats', 'Fishing', 'Dyes', 'Chemist', 'Rockets', 'Water', 'Glass', 'AutoFarm'][r - 1]] : [];
      if (t === 11) return { 3: ['Poseidon'], 6: ['Brawl'], 12: ['BoatsAndHoes'] }[r] || [];
      if (r === 4) return [['Runner', 'Cannon', 'Food2', 'Boots', 'Tools', 'Fuel2', 'PvP', 'Spy', 'Buff', 'Farm3'][t - 1]];
      if (r === 8) return [['Fuel', 'Seeds2', 'Logs', 'Ladders', 'Blocks2', 'Farm2', 'Storage', 'Lights', 'Cannon2', 'Fuel3'][t - 1]];
      return [];
    },
  };

  const COP_EVEN_ODD = [null, ['1x AC*'], ['+1 Home', '+2 Locker Slots'], ['1x AC*'], ['+1 AH', '+1 CP'],
    ['1x AC*'], ['+3% Selling Bonus (pay raise)'], ['1x AC*'], ['+1 Home', '+2 Locker Slots'],
    ['1x AC*'], ['+1 CP'], ['1x AC*'], ['Faster mount']];

  const COP = {
    id: 'cop',
    ranks: ['Informant', 'Recruit', 'Cadet', 'Officer', 'Detective', 'Corporal', 'Sergeant',
      'Lieutenant', 'Colonel', 'Commander', 'Deputy Chief', 'Chief', 'Commissioner'],
    base: [0, 5000, 15000, 30000, 50000, 75000, 125000, 250000, 525000, 750000, 1000000, 1750000, 3000000],
    prestiges: 5,
    tierScale: () => 1, // Cop prices don't rise with prestige (in-game /copranks)
    unlockHint: 'collect 75 inventories of contraband',
    perks: {
      base: [
        ['!Police duty'],
        ['1x AC'],
        ['1x AC', '+1 AH'],
        ['+2 Locker Slots'],
        ['1x AC', '+1 Home'],
        ['1x AC', '+1 AH', '!Personal /mount'],
        ['+1 CP'],
        ['+1 AH'],
        ['1x AC', '+1 Home', 'JS=2', 'Faster mount'],
        ['1x AC', '+1 CP', '+2 Locker Slots'],
        ['1x AC', '+1 AH', '+1 CP'],
        ['+1 Home', '+1 CP'],
        ['1x AC', '+1 CP', 'Faster mount'],
      ],
      odd: COP_EVEN_ODD,
      even: COP_EVEN_ODD,
      master: [null, ['+1 Home', '+2 Locker Slots'], ['+1 CP'], ['+1 AH', 'Faster mount'], ['JS=3'],
        ['+1 CP'], ['+3% Selling Bonus (pay raise)', 'Faster mount'], ['+1 Home', '+2 Locker Slots'],
        ['+1 CP', '1x Prestige Key'], ['+1 AH', '1x Prestige Key', 'Faster mount'],
        ['+1 Home', '1x Prestige Key', '+1 CP'], ['+1 CP', '1x Prestige Key'],
        ['2x Prestige Key', 'Faster mount', '+1 CP']],
    },
    kitsAt(t, r) {
      const out = [];
      if (t === 0) {
        if (r) {
          out.push(['Caving', 'Boats', 'Fishing', 'Dyes', 'Chemist', 'Rockets', 'Water', 'Glass', 'Fuel', 'Cannon', 'Food2', 'Logs'][r - 1]);
          out.push(['Coffee', 'AppleJuice', 'RootBeer', 'Cappuccino', 'Seltzer', 'HerbalTea', 'BitterSeltzer',
            'WaterBottles', 'AgaveJuice', 'HoneyTea', 'Cola', 'BouncingBrew'][r - 1] + ' (brewing)');
        }
        return out;
      }
      if (t === 6) {
        const m = { 2: 'Cannon2', 4: 'Fuel3', 6: 'Poseidon', 9: 'Brawl', 12: 'BoatsAndHoes' }[r];
        return m ? [m] : [];
      }
      if (r === 5) out.push(['Boots', 'Tools', 'Fuel2', 'Storage', 'Lights'][t - 1]);
      if (r === 9 && t <= 4) out.push(['Ladders', 'Blocks2', 'PvP', 'Spy'][t - 1]);
      if (r === 3) out.push(['IcedCappuccino', 'MiningBrew', 'AppleCider', 'TonicWater', 'LifeforceBrew'][t - 1] + ' (brewing)');
      if (r === 7) out.push(['SeamanSlurp', 'WaterBottles2', 'GrapeJuice', 'WheatgrassJuice', 'GoldenAppleJuice'][t - 1] + ' (brewing)');
      return out;
    },
  };

  const TRACKS = { chem: CHEM, cop: COP };

  // Countable stats in display order: [token key, singular, plural].
  const STATS = [
    ['CP', 'Company Power', 'Company Power'], ['CF', 'chem formula', 'chem formulas'],
    ['AH', 'auction slot', 'auction slots'], ['Home', 'home', 'homes'],
    ['RJ', 'runner job listing', 'runner job listings'], ['JS', 'job slot', 'job slots'],
    ['AC', 'police ability credit', 'police ability credits'], ['Locker Slots', 'locker slot', 'locker slots'],
    ['Selling Bonus', 'selling bonus', 'selling bonus'], ['Prestige Key', 'prestige key', 'prestige keys'],
  ];
  const STAT_NAMES = Object.fromEntries(STATS.map(([k, one, many]) => [k, [one, many]]));
  const STAT_RE = /^(\+?)(\d+)(x|%)?\s+(AH|Homes?|CP|CF|RJ|JS|AC|Locker Slots|Selling Bonus|Prestige Key)\b/;

  function getTrack(id) {
    return TRACKS[id] || null;
  }

  const masterTier = (track) => track.prestiges + 1;
  const tierCount = (id) => { const tr = getTrack(id); return tr ? tr.prestiges + 2 : 0; };

  function tierLabel(id, t) {
    const track = getTrack(id);
    if (!track) return '';
    if (t === masterTier(track)) return 'Master Prestige';
    return t === 0 ? 'No prestige' : 'Prestige ' + t;
  }

  function rewardColumn(track, t) {
    if (t === 0) return 'base';
    if (t === masterTier(track)) return 'master';
    return t % 2 ? 'odd' : 'even';
  }

  // Price of the single rankup INTO rank r of tier t. Master is 5x the base price.
  function rankupCost(track, t, r) {
    if (r === 0) return 0;
    const scale = t === masterTier(track) ? 5 : track.tierScale(t);
    return Math.round(track.base[r] * scale);
  }

  // Raw reward tokens for reaching rank r of tier t (rank 0 at t > 0 = prestiging).
  function rewardTokens(track, t, r) {
    if (r === 0) return t === 1 ? ['1x Prestige Key', '!Museum bust'] : ['1x Prestige Key'];
    return track.perks[rewardColumn(track, t)][r]
      .filter((p) => !p.endsWith('*') || t <= 3)
      .map((p) => p.replace(/\*+$/, ''));
  }

  // Wiki token -> words a player reads ("+1 CP (4)" style shorthand spelled out).
  function perkLabel(token) {
    return String(token).replace(/^!/, '')
      .replace(/^(\+?\d+)x?\s+(AH|CP|CF|RJ|JS|AC|Homes?|Locker Slots)\b/, (m, n, k) =>
        n + ' ' + STAT_NAMES[k === 'Homes' ? 'Home' : k][Math.abs(+n) === 1 ? 0 : 1])
      .replace(/^(\+?\d+%) Selling Bonus/, '$1 selling bonus')
      .replace(/^(\d+)x Prestige Key/, (m, n) => n + ' ' + STAT_NAMES['Prestige Key'][n === '1' ? 0 : 1])
      .replace(/^JS=(\d+)$/, 'job slots up to $1');
  }

  // Tier/rank -> flat ladder index, or -1 if it isn't on this track.
  function positionIndex(track, t, r) {
    const tn = Number(t), rn = Number(r);
    if (!Number.isInteger(tn) || tn < 0 || tn > masterTier(track)) return -1;
    if (!Number.isInteger(rn) || rn < 0 || rn >= track.ranks.length) return -1;
    return tn * track.ranks.length + rn;
  }

  // Every step strictly after the current position through the goal. Pure: returns
  // fresh objects and never touches the dataset.
  function rankupPath(id, curT, curR, tgtT, tgtR) {
    const track = getTrack(id);
    if (!track) return { ok: false, steps: [], error: 'Pick Chem or Cop.' };
    const ci = positionIndex(track, curT, curR);
    const ti = positionIndex(track, tgtT, tgtR);
    if (ci < 0 || ti < 0) return { ok: false, steps: [], error: 'Pick where you are now and your goal.' };
    if (ti <= ci) return { ok: false, steps: [], error: "Pick a goal that's ahead of where you are now." };

    const size = track.ranks.length;
    const steps = [];
    for (let i = ci + 1; i <= ti; i++) {
      const t = Math.floor(i / size), r = i % size;
      const tokens = rewardTokens(track, t, r);
      steps.push({
        tier: t,
        tierLabel: tierLabel(id, t),
        rankIndex: r,
        rankName: track.ranks[r],
        cost: rankupCost(track, t, r),
        isPrestigeUp: r === 0,
        // After the first prestige each numbered prestige has to be unlocked first.
        needsUnlock: r === 0 && t >= 2 && t <= track.prestiges,
        tokens,
        perks: tokens.map(perkLabel),
        kits: track.kitsAt(t, r),
        isGoal: i === ti,
      });
    }
    return { ok: true, steps, error: null };
  }

  function moneyNeeded(id, curT, curR, tgtT, tgtR) {
    const path = rankupPath(id, curT, curR, tgtT, tgtR);
    if (!path.ok) return { ok: false, needed: 0, error: path.error };
    return { ok: true, needed: path.steps.reduce((sum, s) => sum + s.cost, 0), error: null };
  }

  // Roll a path's rewards up into what a player cares about: counted stats,
  // one-time unlocks, named kits, and everything else (deduped with a count).
  function summarizeGains(steps) {
    const totals = {};
    const unlocks = [];
    const other = new Map();
    let jobSlotCap = 0;
    (steps || []).forEach((s) => s.tokens.forEach((tok) => {
      if (tok.startsWith('!')) { unlocks.push(tok.slice(1)); return; }
      const cap = /^JS=(\d+)$/.exec(tok);
      if (cap) { jobSlotCap = Math.max(jobSlotCap, +cap[1]); return; }
      const m = STAT_RE.exec(tok);
      if (m && (m[1] || m[3])) {
        const key = m[4] === 'Homes' ? 'Home' : m[4];
        totals[key] = (totals[key] || 0) + Number(m[2]);
        return;
      }
      const label = perkLabel(tok);
      other.set(label, (other.get(label) || 0) + 1);
    }));

    const stats = STATS.filter(([k]) => totals[k] && !(k === 'JS' && jobSlotCap)).map(([k, one, many]) => ({
      key: k,
      value: '+' + totals[k] + (k === 'Selling Bonus' ? '%' : ''),
      label: totals[k] === 1 ? one : many,
    }));
    // A cap on the same path supersedes the +1s that led up to it.
    if (jobSlotCap) stats.push({ key: 'JS', value: String(jobSlotCap), label: 'job slots total' });

    return {
      stats,
      unlocks,
      kits: (steps || []).flatMap((s) => s.kits),
      other: [...other].map(([label, n]) => (n > 1 ? label + ' ×' + n : label)),
    };
  }

  // "750k", "2.5m", "$1,200,000" -> 750000 / 2500000 / 1200000. Anything else -> 0.
  function parseMoney(input) {
    const m = String(input == null ? '' : input).trim().toLowerCase().replace(/[$,\s]/g, '')
      .match(/^(\d*\.?\d+)([kmb])?$/);
    if (!m) return 0;
    return Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1);
  }

  // Remaining money after a balance, plus progress toward the goal (0-100).
  function progressToTarget(needed, balance) {
    const n = Math.max(0, Number(needed) || 0);
    const b = Math.max(0, Number(balance) || 0);
    const remaining = Math.max(0, n - b);
    const pct = n <= 0 ? 100 : Math.min(100, (b / n) * 100);
    return { remaining, pct };
  }

  const RANKS = {
    TRACKS,
    getTrack,
    tierCount,
    tierLabel,
    perkLabel,
    rankupPath,
    moneyNeeded,
    summarizeGains,
    parseMoney,
    progressToTarget,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RANKS;
  if (typeof window !== 'undefined') window.RANKS = RANKS;
})();
