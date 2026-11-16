// main.js — boot + loop + state machine RIVERFORGE.
// Semua logika game di sini; render di render.js, HUD di ui.js,
// input di input.js, suara di audio.js. Modul simulasi (grid, pieces,
// water, mills, waves, economy, save, rng) ditulis Builder A.

import { draw } from './render.js';
import { drawTitle, drawBuildHUD, drawNightHUD, drawResults, drawHowTo } from './ui.js';
import { bindInput } from './input.js';
import { initAudio, sfx, startAmbience, setMuted } from './audio.js';
import { mulberry32, randRange } from './rng.js';
import { createGrid, cellAt, inBounds } from './grid.js';
import { PIECES } from './pieces.js';
import { createFlowState, stepFlow } from './water.js';
import { MILL_TYPES, canPlaceMill } from './mills.js';
import { nightProfile, applyEvent } from './waves.js';
import { buyUpgrade as economyBuy } from './economy.js';
import { loadHighScore, saveHighScore } from './save.js';

const COLS = 12, ROWS = 9;
const LAYOUT = { gridX: 36, gridY: 92, cell: 60, cols: COLS, rows: ROWS };
const BUILD_SECONDS = 60;
const FORGE_TARGET = 100;

const HOUSE_CELLS = [
  { x: 2, y: 6 }, { x: 3, y: 7 }, { x: 4, y: 6 }, { x: 6, y: 7 }, { x: 10, y: 6 },
];

function freshState(seed) {
  const rng = mulberry32(seed);
  const state = {
    phase: 'title',
    night: 1,
    score: 0,
    combo: 1,
    flawlessStreak: 0,
    power: 0,
    forgeCharge: 0,
    villageHP: 5,
    maxVillageHP: 5,
    grid: null,
    flowState: null,
    stock: { timber: 18, stone: 8 },
    piecesLeft: 10,
    upgrades: {},
    stockBonus: 0,
    flowBonus: 0,
    gateCooldown: 0,
    secondSpring: false,
    forgeBonus: 0,
    weather: 'clear',
    weatherLabel: 'Clear dusk',
    eventLabel: '',
    surges: [],
    surgeTimer: 0,
    surgeActive: false,
    surgeBoost: 0,
    surgesLeft: 0,
    nextSurgeIn: null,
    muted: false,
    seed,
    rng,
    clock: 0,
    layout: LAYOUT,
    // UI / presentasi
    selectedPiece: 'straight',
    selectedMill: null,
    selectedCell: null,
    hoverCell: null,
    hoverButton: null,
    rot: 0,
    buildTimer: BUILD_SECONDS,
    nightTimer: 0,
    nightElapsed: 0,
    paused: false,
    shake: 0,
    lightning: 0,
    particles: [],
    floaters: [],
    rain: [],
    stars: [],
    springs: [{ x: 5, y: 0 }],
    forgeCell: { x: 11, y: 8 },
    powerThisNight: 0,
    damageThisNight: 0,
    damageAcc: 0,
    lastFlow: 0,
    nightsSurvived: 0,
    breakdown: { powerScore: 0, nightsScore: 0, flawlessBonus: 0, forgeBonusScore: 0 },
    highScore: 0,
    showHowTo: false,
    showShop: false,
    shopMsg: '',
    buildMsg: '',
    buttons: [],
  };
  // Bintang untuk langit malam (posisi di-seed, deterministik).
  for (let i = 0; i < 70; i++) {
    state.stars.push({
      x: randRange(rng, 0, 1280), y: randRange(rng, 0, 300),
      r: randRange(rng, 1, 2.4), tw: randRange(rng, 0.5, 2), ph: randRange(rng, 0, 6),
    });
  }
  for (let i = 0; i < 80; i++) {
    state.rain.push({ x: randRange(rng, 0, 1280), y: randRange(rng, 0, 720), v: randRange(rng, 380, 620) });
  }
  return state;
}

function setupLevel(state) {
  // grid.cells Builder A berbentuk flat (cols*rows) — JANGAN diubah ke 2D,
  // karena water.js & economy.js mengiterasi grid.cells sebagai array flat.
  state.grid = createGrid(COLS, ROWS);
  // Desa: rumah-rumah berlentera.
  for (const h of HOUSE_CELLS) {
    const c = cellAt(state.grid, h.x, h.y);
    if (c) { c.house = true; c.hp = 2; }
  }
  // Tempaan menempati sel pojok kanan bawah (blocked untuk saluran).
  const f = cellAt(state.grid, state.forgeCell.x, state.forgeCell.y);
  if (f) { f.blocked = true; f.forge = true; }
  // Tandai mata air (water.js memperlakukan sel source sebagai sumber).
  for (const s of state.springs) {
    const c = cellAt(state.grid, s.x, s.y);
    if (c) c.source = true;
  }
  state.flowState = null;
}

// Pasang satu piece tanpa biaya (untuk staging screenshot & setup awal).
function stagePiece(state, x, y, type, rot, open) {
  if (!inBounds(state.grid, x, y)) return;
  const c = cellAt(state.grid, x, y);
  if (!c || c.blocked || c.house) return;
  c.piece = { type, rot: rot || 0, open: open !== false };
}

function stageDemoChannels(state) {
  // Jalur contoh (rotasi diverifikasi terhadap ports N/E/S/W Builder A):
  // mata air (5,0) -> turun -> belok kanan -> tee ke kincir kayu ->
  // turun -> belok kiri -> lurus ke kincir batu di samping tempaan.
  stagePiece(state, 5, 1, 'straight', 0); // N-S
  stagePiece(state, 5, 2, 'gate', 0, true); // N-S, pintu terbuka
  stagePiece(state, 5, 3, 'straight', 0); // N-S
  stagePiece(state, 5, 4, 'bend', 0); // N-E
  stagePiece(state, 6, 4, 'straight', 1); // E-W
  stagePiece(state, 7, 4, 'tee', 1); // E-S-W: cabang selatan ke kincir
  const millCell = cellAt(state.grid, 7, 5);
  if (millCell) millCell.mill = { type: 'wood' };
  stagePiece(state, 8, 4, 'bend', 2); // S-W
  stagePiece(state, 8, 5, 'straight', 0); // N-S
  stagePiece(state, 8, 6, 'straight', 0); // N-S
  stagePiece(state, 8, 7, 'bend', 0); // N-E: dari utara, belok ke timur
  stagePiece(state, 9, 7, 'straight', 1); // E-W
  stagePiece(state, 10, 7, 'bend', 2); // S-W
  const mill2 = cellAt(state.grid, 10, 8);
  if (mill2 && !mill2.blocked) mill2.mill = { type: 'stone' };
}

// ---- Biaya: dukung cost angka (timber) atau objek {timber,stone,power} ----
function canAfford(state, cost) {
  if (cost == null) return true;
  if (typeof cost === 'number') return (state.stock.timber || 0) >= cost;
  if ((cost.timber || 0) > (state.stock.timber || 0)) return false;
  if ((cost.stone || 0) > (state.stock.stone || 0)) return false;
  if ((cost.power || 0) > (state.power || 0)) return false;
  return true;
}

function payCost(state, cost) {
  if (cost == null) return;
  if (typeof cost === 'number') { state.stock.timber -= cost; return; }
  state.stock.timber -= cost.timber || 0;
  state.stock.stone -= cost.stone || 0;
  state.power -= cost.power || 0;
}

// ---- Aksi (dipakai input.js) ----
function makeActions(state, refs) {
  return {
    placePiece(x, y) {
      if (state.phase !== 'build' || state.paused) return;
      const def = PIECES[state.selectedPiece];
      if (!def) { state.buildMsg = 'Pick a channel first (1-5).'; return; }
      if ((state.piecesLeft || 0) <= 0) { state.buildMsg = 'No pieces left today — buy more in the shop.'; sfx('click'); return; }
      if (!inBounds(state.grid, x, y)) return;
      const c = cellAt(state.grid, x, y);
      if (!c || c.blocked || c.house || c.piece || c.mill || c.debris) {
        state.buildMsg = 'Can\'t build there.'; return;
      }
      if (!canAfford(state, def.cost)) { state.buildMsg = 'Not enough timber / stone.'; sfx('click'); return; }
      payCost(state, def.cost);
      c.piece = { type: def.id, rot: state.rot || 0, open: true };
      state.piecesLeft -= 1;
      state.buildMsg = '';
      sfx('place');
      spawnSplash(state, x, y, 4);
    },

    placeMill(x, y, type) {
      if (state.phase !== 'build' || state.paused) return;
      const def = MILL_TYPES[type];
      if (!def) return;
      if (!inBounds(state.grid, x, y)) return;
      let ok = true;
      try { ok = canPlaceMill(state.grid, x, y, type); } catch (_e) { ok = true; }
      const c = cellAt(state.grid, x, y);
      if (!ok || !c || c.blocked || c.house || c.piece || c.mill) {
        state.buildMsg = 'Mill can\'t go there.'; return;
      }
      if (!canAfford(state, def.cost)) { state.buildMsg = 'Not enough resources for that mill.'; return; }
      payCost(state, def.cost);
      c.mill = { type };
      state.selectedMill = null;
      sfx('mill');
    },

    selectGate(x, y) {
      if ((state.phase !== 'build' && state.phase !== 'night') || state.paused) return;
      if (state.gateCooldown > 0) return;
      if (!inBounds(state.grid, x, y)) return;
      const c = cellAt(state.grid, x, y);
      if (!c || !c.piece || c.piece.type !== 'gate') return;
      c.piece.open = c.piece.open === false ? true : false;
      const fast = state.boughtUpgrades && state.boughtUpgrades['fastgate'];
      state.gateCooldown = fast ? 0.5 : 1.0;
      sfx('gate');
    },

    rotatePiece(x, y) {
      if (state.phase !== 'build') return;
      if (!inBounds(state.grid, x, y)) return;
      const c = cellAt(state.grid, x, y);
      if (c && c.piece) {
        c.piece.rot = ((c.piece.rot || 0) + 1) % 4;
        sfx('click');
      }
    },

    clearDebris(x, y) {
      if (!inBounds(state.grid, x, y)) return;
      const c = cellAt(state.grid, x, y);
      if (c && c.debris) {
        c.debris = false;
        c.blocked = false; // puing dibersihkan -> sel bisa dialiri lagi
        sfx('place');
        spawnSplash(state, x, y, 3);
      }
    },

    startGame() {
      initAudio();
      startAmbience();
      sfx('click');
      const seed = state.seed;
      const fresh = freshState(seed);
      Object.assign(state, fresh);
      setupLevel(state);
      state.phase = 'build';
      state.buildTimer = BUILD_SECONDS;
    },

    startNight() {
      if (state.phase !== 'build') return;
      state.showShop = false;
      state.phase = 'night';
      state.powerThisNight = 0;
      state.damageThisNight = 0;
      state.damageAcc = 0;
      state.nightElapsed = 0;
      state.nightTimer = 60 + state.night * 5;
      state.surgeActive = false;
      state.surgeBoost = 0;
      // Profil malam dari waves.js (seeded).
      let profile = null;
      try { profile = nightProfile(state.night, state.rng); } catch (_e) { profile = null; }
      state.surges = (profile && profile.surges) || [{ delaySec: 15, volume: 2, speed: 1 }];
      state.surgesLeft = state.surges.length;
      state.surgeTimer = state.surges.length ? state.surges[0].delaySec : 999;
      state.nextSurgeIn = state.surgeTimer;
      state.weather = (profile && profile.weather) || 'clear';
      // Label cuaca Bahasa Inggris untuk HUD (WEATHER_DESC Builder A berbahasa Indonesia).
      const WEATHER_EN = {
        clear: 'Clear dusk', rain: 'Rain — extra flow',
        drought: 'Drought — spring halved', storm: 'Storm — lightning strikes',
      };
      state.weatherLabel = WEATHER_EN[state.weather] || state.weather;
      const ev = profile && profile.event;
      state.eventLabel = ev ? (ev.desc || ev.type || '') : '';
      // Event malam diterapkan oleh waves.js (beaver/debris/storm).
      if (ev) {
        let applied = null;
        try { applied = applyEvent(state.grid, ev, state.rng); } catch (_e) { applied = null; }
        if (applied) sfx('break');
      }
      if (state.secondSpring && !state.springs.some((s) => s.x === 8)) state.springs.push({ x: 8, y: 0 });
      try { state.flowState = createFlowState(state.grid); } catch (_e) { state.flowState = null; }
      sfx('alarm');
    },

    openShop() {
      if (state.phase !== 'build') return;
      state.showShop = !state.showShop;
      state.shopMsg = '';
      sfx('click');
    },

    buyUpgrade(id) {
      let res = { ok: false, reason: 'Shop unavailable.' };
      try { res = economyBuy(state, id); } catch (_e) { res = { ok: false, reason: 'Shop error.' }; }
      if (res && res.ok) {
        state.upgrades[id] = true;
        state.shopMsg = '';
        sfx('bell');
      } else {
        state.shopMsg = (res && res.reason) || 'Can\'t buy that.';
        sfx('click');
      }
    },

    restart() {
      refs.restart();
    },

    toTitle() {
      state.phase = 'title';
      state.showShop = false;
      state.showHowTo = false;
      state.paused = false;
      sfx('click');
    },

    toggleMute() {
      state.muted = !state.muted;
      setMuted(state.muted);
      if (!state.muted) sfx('click');
    },

    togglePause() {
      if (state.phase === 'build' || state.phase === 'night') {
        state.paused = !state.paused;
        sfx('click');
      }
    },
  };
}

function spawnSplash(state, x, y, n) {
  const L = state.layout;
  const cx = L.gridX + x * L.cell + L.cell / 2;
  const cy = L.gridY + y * L.cell + L.cell / 2;
  for (let i = 0; i < (n || 4); i++) {
    state.particles.push({
      x: cx + randRange(state.rng, -14, 14),
      y: cy + randRange(state.rng, -14, 14),
      vx: randRange(state.rng, -30, 30),
      vy: randRange(state.rng, -50, -10),
      life: randRange(state.rng, 0.4, 0.9),
      color: 'rgba(120,210,255,0.85)',
    });
  }
}

function sourceRate(state) {
  // Laju dasar mata air = 1. Pengali cuaca & flowBonus diterapkan
  // di dalam water.js (opts.weather / opts.flowBonus) — jangan ganda.
  return 1.0;
}

function updateNight(state, dt) {
  state.nightElapsed += dt;
  state.nightTimer -= dt;
  if (state.gateCooldown > 0) state.gateCooldown -= dt;

  // Surge berikutnya.
  if (state.surgesLeft > 0 && !state.surgeActive) {
    state.surgeTimer -= dt;
    state.nextSurgeIn = Math.max(0, state.surgeTimer);
    if (state.surgeTimer <= 0) {
      const surge = state.surges[state.surges.length - state.surgesLeft];
      state.surgeActive = true;
      state.surgeBoost = (surge && surge.volume) || 2;
      state.surgeTimer = 8; // durasi surge aktif
      state.surgesLeft -= 1;
      sfx('alarm');
    }
  } else if (state.surgeActive) {
    state.surgeTimer -= dt;
    if (state.surgeTimer <= 0) {
      state.surgeActive = false;
      state.surgeBoost = 0;
      if (state.surgesLeft > 0) {
        const next = state.surges[state.surges.length - state.surgesLeft];
        state.surgeTimer = (next && next.delaySec) || 15;
        state.nextSurgeIn = state.surgeTimer;
      } else {
        state.nextSurgeIn = null;
      }
    }
  }

  // Petir saat badai.
  if (state.weather === 'storm' && state.lightning <= 0) {
    if (state.rng() < 0.004) state.lightning = 0.7;
  }
  if (state.lightning > 0) state.lightning -= dt;

  // Simulasi aliran. stepFlow mengembalikan housesHit sebagai ARRAY
  // indeks sel rumah yang kena air, dan forgeCharge dari kincir tempa.
  // Damage HP rumah sudah diterapkan water.js ke cell.hp — di sini
  // villageHP dihitung ulang dari jumlah rumah yang masih hidup.
  const sources = state.springs.map((s) => ({ x: s.x, y: s.y, rate: sourceRate(state) }));
  if (state.surgeActive) sources.push({ x: 6, y: 0, rate: state.surgeBoost });
  let res = { totalFlow: 0, powerGenerated: 0, forgeCharge: 0, housesHit: [] };
  try {
    res = stepFlow(state.grid, state.flowState, dt, {
      sourceCells: sources,
      weather: state.weather,
      rng: state.rng,
      flowBonus: state.flowBonus || 0,
      forgeBonus: state.forgeBonus || 0,
    }) || res;
  } catch (_e) { /* sim gagal: lanjutkan render */ }
  state.lastFlow = res.totalFlow || 0;
  const gained = res.powerGenerated || 0;
  state.power += gained;
  state.powerThisNight += gained;
  state.score += gained;
  state.breakdown.powerScore += gained;
  // Forge charge: dari kincir tempa + rembesan kecil dari power biasa.
  state.forgeCharge = Math.min(FORGE_TARGET,
    state.forgeCharge + (res.forgeCharge || 0) + gained * 0.08 * (1 + (state.forgeBonus || 0)));
  if (state.forgeCharge >= 50 && !state._bell50) { state._bell50 = true; sfx('bell'); }
  if (state.forgeCharge >= 90 && !state._bell90) { state._bell90 = true; sfx('bell'); }

  // Rumah kena air: shake + suara (dibatasi tiap 0,5 dtk).
  const hits = res.housesHit || [];
  if (hits.length > 0) {
    state.damageThisNight += hits.length;
    state.shake = 6;
    state._splashT = (state._splashT || 0) - dt;
    if (state._splashT <= 0) {
      state._splashT = 0.5;
      sfx('splash');
    }
  }
  // Village HP = jumlah rumah dengan hp > 0 (water.js yang mengurangi hp).
  let alive = 0;
  for (const h of HOUSE_CELLS) {
    const c = cellAt(state.grid, h.x, h.y);
    if (c && c.house && c.hp > 0) alive += 1;
  }
  state.villageHP = alive;

  // Cipratan di kincir yang berputar.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = cellAt(state.grid, x, y);
      if (c && c.mill && state.rng() < 0.06) spawnSplash(state, x, y, 1);
    }
  }

  // Kalah / malam selesai.
  if (state.villageHP <= 0) { endGame(state, false); return; }
  if (state.nightTimer <= 0) endNight(state);
}

function endNight(state) {
  state.nightsSurvived += 1;
  state.score += 100;
  state.breakdown.nightsScore += 100;
  const flawless = state.damageThisNight === 0;
  if (flawless) {
    state.flawlessStreak += 1;
    state.combo = state.flawlessStreak + 1;
    const bonus = 150 + 50 * state.flawlessStreak;
    state.score += bonus;
    state.breakdown.flawlessBonus += bonus;
    state.floaters.push({ x: 640, y: 300, text: 'FLAWLESS NIGHT! +' + bonus, life: 2 });
    sfx('bell');
  } else {
    state.flawlessStreak = 0;
    state.combo = 1;
  }
  state.breakdown.forgeBonusScore = Math.floor(state.forgeCharge);

  if (state.night >= 7) {
    endGame(state, state.forgeCharge >= FORGE_TARGET);
    return;
  }
  // Istirahat antar malam: stok baru, kembali ke build.
  state.night += 1;
  state.stock.timber += 6 + (state.stockBonus || 0);
  state.stock.stone += 3;
  state.piecesLeft = 10 + (state.stockBonus || 0);
  state.buildTimer = BUILD_SECONDS;
  state.phase = 'build';
  state.showShop = true;
  state._bell50 = false;
  state._bell90 = false;
  sfx('win');
}

function endGame(state, win) {
  state.phase = win ? 'win' : 'loss';
  state.showShop = false;
  if (win) state.score += Math.floor(state.forgeCharge);
  try {
    const hs = loadHighScore() || 0;
    if (Math.floor(state.score) > hs) {
      saveHighScore(Math.floor(state.score));
      state.highScore = Math.floor(state.score);
    } else {
      state.highScore = hs;
    }
  } catch (_e) { /* localStorage tidak tersedia */ }
  sfx(win ? 'win' : 'lose');
}

function updateParticles(state, dt) {
  for (const p of state.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 60 * dt;
    p.life -= dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const f of state.floaters) {
    f.y -= 24 * dt;
    f.life -= dt;
  }
  state.floaters = state.floaters.filter((f) => f.life > 0);
  if (state.weather === 'rain' || state.weather === 'storm') {
    for (const r of state.rain) {
      r.y += r.v * dt;
      if (r.y > 720) { r.y = -12; r.x = randRange(state.rng, 0, 1280); }
    }
  }
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 14);
}

function update(state, dt) {
  state.clock += dt;
  if (state.paused) return;
  updateParticles(state, dt);
  if (state.phase === 'build') {
    state.buildTimer -= dt;
    if (state.gateCooldown > 0) state.gateCooldown -= dt;
    if (state.buildTimer <= 0) {
      // Waktu habis: malam dimulai otomatis.
      state._actions.startNight();
    }
  } else if (state.phase === 'night') {
    updateNight(state, dt);
  }
}

// ---- Staging deterministik untuk ?shot= ----
function stageShot(state, shot) {
  setupLevel(state);
  if (shot === 'title') {
    state.phase = 'title';
    stageDemoChannels(state);
    return;
  }
  if (shot === 'build') {
    state.phase = 'build';
    state.night = 1;
    state.buildTimer = 42;
    state.power = 12;
    state.score = 12;
    stageDemoChannels(state);
    return;
  }
  if (shot === 'night') {
    state.phase = 'night';
    state.night = 3;
    state.nightTimer = 48;
    state.nightElapsed = 22;
    state.power = 86;
    state.powerThisNight = 54;
    state.score = 240;
    state.forgeCharge = 38;
    state.weather = 'rain';
    state.weatherLabel = 'Rain — extra flow';
    state.surges = [{ delaySec: 12, volume: 3, speed: 1.2 }, { delaySec: 25, volume: 4, speed: 1.4 }];
    state.surgesLeft = 1;
    state.surgeActive = true;
    state.surgeBoost = 3;
    state.surgeTimer = 6;
    state.nextSurgeIn = null;
    stageDemoChannels(state);
    try { state.flowState = createFlowState(state.grid); } catch (_e) { state.flowState = null; }
    return;
  }
  if (shot === 'win') {
    state.phase = 'win';
    state.night = 7;
    state.forgeCharge = 100;
    state.score = 2450;
    state.highScore = 2450;
    state.power = 1840;
    state.villageHP = 3;
    state.breakdown = { powerScore: 1840, nightsScore: 700, flawlessBonus: 450, forgeBonusScore: 100 };
    stageDemoChannels(state);
    return;
  }
  if (shot === 'loss') {
    state.phase = 'loss';
    state.night = 5;
    state.forgeCharge = 41;
    state.score = 830;
    state.highScore = 2450;
    state.villageHP = 0;
    state.breakdown = { powerScore: 620, nightsScore: 400, flawlessBonus: 150, forgeBonusScore: 41 };
    // Semua rumah hancur.
    for (const h of HOUSE_CELLS) {
      const c = cellAt(state.grid, h.x, h.y);
      if (c) { c.hp = 0; c.broken = true; }
    }
    stageDemoChannels(state);
    return;
  }
  state.phase = 'title';
}

function boot() {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get('seed') || 1) || 1;
  const shot = params.get('shot');

  const state = freshState(seed);
  try { state.highScore = loadHighScore() || 0; } catch (_e) { state.highScore = 0; }
  setupLevel(state);

  // Referensi restart butuh state baru — dibuat lewat closure.
  const refs = {
    restart() {
      const fresh = freshState(state.seed);
      // Pertahankan high score & mute.
      fresh.highScore = state.highScore;
      fresh.muted = state.muted;
      Object.assign(state, fresh);
      setupLevel(state);
      state.phase = 'build';
      state.buildTimer = BUILD_SECONDS;
      sfx('click');
    },
  };
  const actions = makeActions(state, refs);
  state._actions = actions;

  if (shot) {
    stageShot(state, shot);
  }
  bindInput(canvas, state, actions);

  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      update(state, STEP);
      acc -= STEP;
    }
    // Gambar: reset daftar tombol tiap frame, lalu render + UI fase.
    state.buttons = [];
    draw(ctx, state, state.clock);
    if (state.phase === 'title') drawTitle(ctx, state);
    else if (state.phase === 'build') drawBuildHUD(ctx, state);
    else if (state.phase === 'night') drawNightHUD(ctx, state);
    else if (state.phase === 'win') drawResults(ctx, state, true);
    else if (state.phase === 'loss') drawResults(ctx, state, false);
    if (state.showHowTo && state.phase !== 'title') drawHowTo(ctx, state);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
