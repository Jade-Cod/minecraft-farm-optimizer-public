// Chem-rank ladder data + pure cost calculations for the Ranks tab.
// Dual-environment: exposes window.RANKS in the browser and module.exports for
// plain `node` unit tests (frontend/ranks.test.js). No build step, no framework.
//
// The ladder is two interleaved tracks: 13 chem ranks (Junky -> Director) repeated
// across 12 prestige tiers (Prestige 0, Prestige 1-10, Master Prestige). Each value
// in a tier's `ranks` array is the cost of THAT SINGLE rankup (not cumulative); the
// first entry (Junky) is always 0 because it is the tier's entry rank. A tier's
// `total` equals the sum of its 13 rankups, and the sum across all tiers equals the
// in-game "Total for all rankups" — so there are NO separate prestige-up fees.
(function () {
  'use strict';

  // Junky(0) ... Director(12).
  const RANK_ORDER = [
    'Junky', 'Intern', 'Trainee', 'Assistant', 'Technician', 'Analyst',
    'Engineer', 'Bioengineer', 'Chemist', 'Biochemist', 'Alchemist',
    'Pharmacologist', 'Director',
  ];

  // Ladder walk order across prestige tiers.
  const PRESTIGE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'master'];

  // Per-tier { total, ranks[13] }. Each ranks[i] is the cost of the single rankup
  // INTO RANK_ORDER[i]; ranks[0] (Junky) is 0 (tier entry rank).
  const PRESTIGE_DATA = {
    '0':  { total: 8860000,  ranks: [0, 10000, 25000, 50000, 75000, 150000, 250000, 400000, 600000, 800000, 1500000, 2000000, 3000000] },
    '1':  { total: 10189000, ranks: [0, 11500, 28750, 57500, 86250, 172500, 287500, 460000, 690000, 920000, 1725000, 2300000, 3450000] },
    '2':  { total: 11518000, ranks: [0, 13000, 32500, 65000, 97500, 195000, 325000, 520000, 780000, 1040000, 1950000, 2600000, 3900000] },
    '3':  { total: 12847000, ranks: [0, 14500, 36250, 72500, 108750, 217500, 362500, 580000, 870000, 1160000, 2175000, 2900000, 4350000] },
    '4':  { total: 14176000, ranks: [0, 16000, 40000, 80000, 120000, 240000, 400000, 640000, 960000, 1280000, 2400000, 3200000, 4800000] },
    '5':  { total: 15505000, ranks: [0, 17500, 43750, 87500, 131250, 262500, 437500, 700000, 1050000, 1400000, 2625000, 3500000, 5250000] },
    '6':  { total: 16834000, ranks: [0, 19000, 47500, 95000, 142500, 285000, 475000, 760000, 1140000, 1520000, 2850000, 3800000, 5700000] },
    '7':  { total: 18163000, ranks: [0, 20500, 51250, 102500, 153750, 307500, 512500, 820000, 1230000, 1640000, 3075000, 4100000, 6150000] },
    '8':  { total: 19492000, ranks: [0, 22000, 55000, 110000, 165000, 330000, 550000, 880000, 1320000, 1760000, 3300000, 4400000, 6600000] },
    '9':  { total: 20821000, ranks: [0, 23500, 58750, 117500, 176250, 352500, 587500, 940000, 1410000, 1880000, 3525000, 4700000, 7050000] },
    '10': { total: 22150000, ranks: [0, 25000, 62500, 125000, 187500, 375000, 625000, 1000000, 1500000, 2000000, 3750000, 5000000, 7500000] },
    'master': { total: 44300000, ranks: [0, 50000, 125000, 250000, 375000, 750000, 1250000, 2000000, 3000000, 4000000, 7500000, 10000000, 15000000] },
  };

  const GRAND_TOTAL = 214855000;

  // What each chem rankup unlocks (baked from https://labs-mc.com/wiki/Ranks).
  // Keyed by chem rank name; perk text summarises the base unlock plus notable
  // prestige-tier extras. Static supporting content — the calculator never depends
  // on this; a missing/empty map degrades to a "couldn't load rewards" note.
  const REWARDS = {
    'Junky': '1 Auction House, 2 Homes, 1 Job Slot, Kit — the starting rank.',
    'Intern': 'Runner Duty + Kit. Earns an extra Home at each prestige tier.',
    'Trainee': 'Police Enroll ability and a 3rd Home, plus Chemtainer upgrades at higher prestiges.',
    'Assistant': 'Access to Smuggle Flights + Kit, with reduced cooldowns at higher prestiges.',
    'Technician': 'Auction House access (2 total) + Kit; perks scale with prestige.',
    'Analyst': '4 Homes and Lab Max Crafts increases.',
    'Engineer': '+1 Chemtainer Plot (4), +1 Auction House (3), new Lawyer, Kit (Tier II pack).',
    'Bioengineer': 'Unlocks /lab, 2x Chem Farm, Kit, and renting Super Rare+ items on /rent (Tier II pack).',
    'Chemist': 'Create Runner Jobs, +1 Chemtainer Plot (5), 1x Chem Farm (Tier II pack).',
    'Biochemist': 'Access to Bribes + Kit, +1 Runner Job (2), +1 Job Slot (2) (Tier II pack).',
    'Alchemist': 'Unlocks /craft, +1 Chemtainer Plot (6), +1 Runner Job (3) (Tier III pack).',
    'Pharmacologist': '+1 Chemtainer Plot (7), 1x Chem Farm, Kit, 1% Selling Bonus (Tier III pack).',
    'Director': 'Personal /mount, +1 Home (5), +1 Chemtainer Plot (8), Kit (Tier III pack) — the final rank.',
  };

  function prestigeLabel(key) {
    if (key === 'master') return 'Master Prestige';
    return 'Prestige ' + key;
  }

  // Flat, ordered ladder of every position (12 tiers x 13 ranks = 156). `cost` is
  // the price to REACH that position from the previous one. Returns a fresh array
  // on every call — never references the source dataset's arrays.
  function flatLadder() {
    const out = [];
    PRESTIGE_ORDER.forEach((prestige) => {
      const tier = PRESTIGE_DATA[prestige];
      if (!tier) return;
      RANK_ORDER.forEach((rankName, rankIndex) => {
        out.push({
          prestige,
          rankIndex,
          rankName,
          prestigeLabel: prestigeLabel(prestige),
          cost: tier.ranks[rankIndex],
        });
      });
    });
    return out;
  }

  // Flat index of (prestige, rankIndex), or -1 if the position is invalid.
  function positionIndex(prestige, rankIndex) {
    const p = PRESTIGE_ORDER.indexOf(String(prestige));
    const r = Number(rankIndex);
    if (p < 0 || !Number.isInteger(r) || r < 0 || r >= RANK_ORDER.length) return -1;
    return p * RANK_ORDER.length + r;
  }

  // Money still needed to go from (curP,curR) to (tgtP,tgtR): the sum of every
  // rankup strictly AFTER the current position, up to and including the target.
  // Pure — builds nothing on the dataset; coerces/guards all inputs.
  function moneyNeeded(curP, curR, tgtP, tgtR) {
    const ci = positionIndex(curP, curR);
    const ti = positionIndex(tgtP, tgtR);
    if (ci < 0 || ti < 0) {
      return { ok: false, needed: 0, error: 'Pick a valid current and target rank.' };
    }
    if (ti <= ci) {
      return { ok: false, needed: 0, error: 'Target must be ahead of your current rank.' };
    }
    const ladder = flatLadder();
    let needed = 0;
    for (let i = ci + 1; i <= ti; i++) needed += ladder[i].cost;
    return { ok: true, needed, error: null };
  }

  // Ordered list of every rankup between the current position and the target
  // (strictly after current, through target). Each step carries its cost and the
  // reward unlocked by reaching that rank — the cumulative "path to your goal".
  // Pure — reads the dataset, returns fresh objects.
  function rankupPath(curP, curR, tgtP, tgtR) {
    const ci = positionIndex(curP, curR);
    const ti = positionIndex(tgtP, tgtR);
    if (ci < 0 || ti < 0) {
      return { ok: false, steps: [], error: 'Pick a valid current and target rank.' };
    }
    if (ti <= ci) {
      return { ok: false, steps: [], error: 'Target must be ahead of your current rank.' };
    }
    const ladder = flatLadder();
    const steps = [];
    for (let i = ci + 1; i <= ti; i++) {
      const p = ladder[i];
      steps.push({
        prestige: p.prestige,
        prestigeLabel: p.prestigeLabel,
        rankName: p.rankName,
        rankIndex: p.rankIndex,
        cost: p.cost,
        reward: REWARDS[p.rankName] || null,
      });
    }
    return { ok: true, steps, error: null };
  }

  // Remaining money after a balance, plus progress toward the target (0-100).
  // Coerces balance; blank/NaN/negative is treated as 0.
  function progressToTarget(needed, balance) {
    const n = Math.max(0, Number(needed) || 0);
    const b = Math.max(0, Number(balance) || 0);
    const remaining = Math.max(0, n - b);
    const pct = n <= 0 ? 100 : Math.min(100, (b / n) * 100);
    return { remaining, pct };
  }

  const RANKS = {
    RANK_ORDER,
    PRESTIGE_ORDER,
    PRESTIGE_DATA,
    GRAND_TOTAL,
    REWARDS,
    prestigeLabel,
    flatLadder,
    positionIndex,
    moneyNeeded,
    rankupPath,
    progressToTarget,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RANKS;
  if (typeof window !== 'undefined') window.RANKS = RANKS;
})();
