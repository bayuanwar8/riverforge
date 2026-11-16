// economy.js — toko & upgrade antar malam, dibayar pakai power.
// Harga naik 50% tiap pembelian ulang. pipes2 & homes boleh dibeli
// ulang maks 3x; upgrade lain sekali saja.

export const UPGRADES = [
  {
    id: 'pipes2', name: '+2 Channels', cost: 15,
    desc: '+2 channel stock each day',
    repeatable: true, maxRepeat: 3,
    apply(state) { state.stockBonus = (state.stockBonus || 0) + 2; },
  },
  {
    id: 'homes', name: 'Reinforce Houses', cost: 20,
    desc: '+1 HP for every house',
    repeatable: true, maxRepeat: 3,
    apply(state) {
      state.houseBonus = (state.houseBonus || 0) + 1;
      if (state.grid) {
        for (const cell of state.grid.cells) {
          if (cell.house) cell.hp += 1;
        }
      }
    },
  },
  {
    id: 'copper', name: 'Copper Pipes', cost: 25,
    desc: 'Flow through mills +25%',
    apply(state) { state.flowBonus = (state.flowBonus || 0) + 0.25; },
  },
  {
    id: 'fastgate', name: 'Fast Gate', cost: 18,
    desc: 'Gate toggle cooldown halved',
    apply(state) { state.gateCooldown = (state.gateCooldown || 1) * 0.5; },
  },
  {
    id: 'spring2', name: 'Second Spring', cost: 40, minNight: 4,
    desc: 'A second water source on the valley side',
    apply(state) { state.secondSpring = true; },
  },
  {
    id: 'bellows', name: 'Forge Bellows', cost: 30,
    desc: 'Forge charge +20%',
    apply(state) { state.forgeBonus = (state.forgeBonus || 0) + 0.2; },
  },
];

export function findUpgrade(id) {
  return UPGRADES.find((u) => u.id === id) || null;
}

// Harga saat ini: naik 50% (dibulatkan ke atas) tiap pembelian ulang.
export function upgradeCost(state, id) {
  const def = findUpgrade(id);
  if (!def) return null;
  const bought = (state.boughtUpgrades && state.boughtUpgrades[id]) || 0;
  return Math.ceil(def.cost * Math.pow(1.5, bought));
}

// Beli upgrade. state: {power, night, boughtUpgrades: {id: count}, ...}.
// Mengembalikan {ok, reason} — ok false kalau gagal (alasan di reason).
export function buyUpgrade(state, id) {
  const def = findUpgrade(id);
  if (!def) return { ok: false, reason: 'Unknown upgrade.' };
  if (def.minNight && (state.night || 1) < def.minNight) {
    return { ok: false, reason: `Available from Night ${def.minNight}.` };
  }
  const bought = (state.boughtUpgrades && state.boughtUpgrades[id]) || 0;
  if (!def.repeatable && bought >= 1) {
    return { ok: false, reason: 'Already bought.' };
  }
  if (def.repeatable && def.maxRepeat && bought >= def.maxRepeat) {
    return { ok: false, reason: `Max ${def.maxRepeat}x purchases.` };
  }
  const cost = upgradeCost(state, id);
  if ((state.power || 0) < cost) {
    return { ok: false, reason: `Needs ${cost} power (you have ${state.power || 0}).` };
  }
  state.power -= cost;
  if (!state.boughtUpgrades) state.boughtUpgrades = {};
  state.boughtUpgrades[id] = bought + 1;
  def.apply(state);
  return { ok: true, reason: `${def.name} bought (${cost} power).` };
}

// Daftar upgrade yang masih bisa dibeli (untuk toko).
export function availableUpgrades(state) {
  return UPGRADES.map((u) => {
    const bought = (state.boughtUpgrades && state.boughtUpgrades[u.id]) || 0;
    const locked = u.minNight && (state.night || 1) < u.minNight;
    const maxed = (!u.repeatable && bought >= 1)
      || (u.repeatable && u.maxRepeat && bought >= u.maxRepeat);
    return {
      ...u,
      cost: upgradeCost(state, u.id),
      bought,
      locked: !!locked,
      maxed: !!maxed,
    };
  });
}
