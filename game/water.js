// water.js — simulasi aliran air di grid.
// Murni & deterministik: semua keacakan lewat opts.rng (mulberry32).
// Waktu datang dari parameter dt — tidak ada Date.now() di sini.

import { cellAt, cellIndex, neighbors4, OPPOSITE } from './grid.js';
import { rotatedPorts, isGate, isOpen } from './pieces.js';
import { millOutput } from './mills.js';
import { mulberry32 } from './rng.js';

// Tekanan di atas nilai ini mulai menghitung waktu menuju jebol.
export const BURST_PRESSURE = 3.0;
// Lama tekanan berlebih sebelum saluran jebol (detik).
export const BURST_TIME = 2.0;
// Tiap 0.5 dtk aliran, rumah kehilangan 1 HP.
export const HOUSE_DAMAGE_INTERVAL = 0.5;

// State aliran: satu Float32Array per grid (indeks = y*cols + x).
export function createFlowState(grid) {
  const n = grid.cols * grid.rows;
  return {
    cols: grid.cols,
    rows: grid.rows,
    flow: new Float32Array(n),        // air yang sedang di sel
    pressure: new Float32Array(n),    // tekanan di sel
    overTime: new Float32Array(n),    // lama tekanan > BURST_PRESSURE
    houseTimer: new Float32Array(n),  // akumulasi waktu aliran di rumah
    houseDamage: new Float32Array(n), // total damage taken per house
  };
}

export function flowAt(flowState, x, y) {
  if (x < 0 || y < 0 || x >= flowState.cols || y >= flowState.rows) return 0;
  return flowState.flow[y * flowState.cols + x];
}

// Pengali aliran dari cuaca.
function weatherMult(weather) {
  if (weather === 'drought') return 0.5;
  if (weather === 'rain') return 1.5;
  if (weather === 'storm') return 1.25;
  return 1.0;
}

// Arah keluar air dari sebuah sel (port yang terhubung + tetangga mau terima).
// Mengembalikan daftar {x, y, dir} sel tujuan.
function cellExits(grid, x, y) {
  const cell = cellAt(grid, x, y);
  if (!cell || cell.blocked || cell.debris) return [];
  // Rumah, kincir, dan tempaan adalah ujung (air diserap di sana).
  if (cell.house || cell.mill || cell.forge) return [];

  let ports;
  if (cell.source) {
    // Mata air: air keluar ke semua arah yang ada saluran penerimanya.
    ports = ['N', 'E', 'S', 'W'];
  } else if (cell.piece) {
    if (isGate(cell.piece) && !isOpen(cell.piece)) return []; // pintu tertutup: menahan
    ports = rotatedPorts(cell.piece);
  } else {
    return []; // sel kosong: air tidak mengalir
  }

  const exits = [];
  for (const n of neighbors4(grid, x, y)) {
    if (!ports.includes(n.dir)) continue;
    if (n.cell.blocked || n.cell.debris) continue;
    // Tetangga menerima kalau: punya saluran dengan port menghadap balik,
    // atau rumah/kincir/tempaan/mata air (penyerap & sumber).
    if (n.cell.house || n.cell.mill || n.cell.forge || n.cell.source) {
      exits.push({ x: n.x, y: n.y, dir: n.dir });
    } else if (n.cell.piece) {
      if (rotatedPorts(n.cell.piece).includes(OPPOSITE[n.dir])) {
        exits.push({ x: n.x, y: n.y, dir: n.dir });
      }
    }
  }
  return exits;
}

// Satu langkah simulasi. opts:
//   sourceCells: [{x, y, rate}] — mata air aktif
//   weather: 'clear' | 'rain' | 'drought' | 'storm'
//   rng: fungsi mulberry32 (untuk tumpahan saat jebol)
//   flowBonus: pengali flow lewat kincir (dari upgrade, default 0)
//   forgeBonus: pengali forge charge (dari upgrade, default 0)
// Mengembalikan {totalFlow, powerGenerated, forgeCharge, housesHit: [index]}.
export function stepFlow(grid, flowState, dt, opts = {}) {
  const rng = opts.rng || mulberry32(1);
  const wMult = weatherMult(opts.weather || 'clear');
  const flowBonus = opts.flowBonus || 0;
  const forgeBonus = opts.forgeBonus || 0;
  const n = grid.cols * grid.rows;
  const idx = (x, y) => y * grid.cols + x;

  // 1) Air masuk dari mata air.
  for (const s of opts.sourceCells || []) {
    const cell = cellAt(grid, s.x, s.y);
    if (!cell || cell.blocked) continue;
    flowState.flow[idx(s.x, s.y)] += (s.rate || 1) * wMult * dt;
  }

  // 2) Hitung aliran keluar tiap sel (berdasarkan kondisi awal tick).
  const delta = new Float32Array(n);
  const exitsCache = new Array(n);
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const i = idx(x, y);
      const amount = flowState.flow[i];
      if (amount <= 0.001) continue;
      const exits = cellExits(grid, x, y);
      exitsCache[i] = exits;
      if (exits.length === 0) continue;
      // Sebagian air bergerak tiap detik; bagi rata ke semua jalan keluar.
      const move = Math.min(amount, amount * 2.0 * dt);
      const per = move / exits.length;
      delta[i] -= move;
      for (const e of exits) delta[idx(e.x, e.y)] += per;
    }
  }
  for (let i = 0; i < n; i++) {
    flowState.flow[i] = Math.max(0, flowState.flow[i] + delta[i]);
  }

  // 3) Tekanan: sel yang menahan air (tanpa jalan keluar) naik tekanannya,
  //    sel yang mengalir lancar tekanannya reda.
  const bursts = [];
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const i = idx(x, y);
      const cell = cellAt(grid, x, y);
      const amount = flowState.flow[i];
      const exits = exitsCache[i] || cellExits(grid, x, y);
      if (amount > 0.2 && exits.length === 0 && cell.piece) {
        // Menahan air: tekanan naik sebanding air yang tertahan.
        flowState.pressure[i] += dt * (0.5 + amount * 0.5);
        // Tekanan juga merambat ke sel di belakang (yang mengalir ke sini).
        for (const nb of neighbors4(grid, x, y)) {
          if (nb.cell.piece && !nb.cell.blocked) {
            flowState.pressure[idx(nb.x, nb.y)] += dt * 0.25;
          }
        }
      } else {
        flowState.pressure[i] = Math.max(0, flowState.pressure[i] - dt * 2.0);
      }
      // Timer jebol.
      if (flowState.pressure[i] > BURST_PRESSURE) {
        flowState.overTime[i] += dt;
        if (flowState.overTime[i] > BURST_TIME) bursts.push({ x, y, i });
      } else {
        flowState.overTime[i] = 0;
      }
    }
  }

  // 4) Saluran jebol: piece hancur jadi puing, air tumpah ke tetangga acak.
  for (const b of bursts) {
    const cell = cellAt(grid, b.x, b.y);
    if (!cell || !cell.piece) continue;
    const spilled = flowState.flow[b.i];
    cell.piece = null;
    cell.broken = true;
    cell.debris = true;
    cell.blocked = true;
    flowState.flow[b.i] = 0;
    flowState.pressure[b.i] = 0;
    flowState.overTime[b.i] = 0;
    const open = neighbors4(grid, b.x, b.y).filter(
      (nb) => !nb.cell.blocked && !nb.cell.house,
    );
    if (open.length > 0 && spilled > 0) {
      const target = open[Math.floor(rng() * open.length)];
      flowState.flow[idx(target.x, target.y)] += spilled;
    }
  }

  // 5) Ujung aliran: rumah kena damage, kincir menghasilkan power.
  let powerGenerated = 0;
  let forgeCharge = 0;
  const housesHit = [];
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const i = idx(x, y);
      const cell = cellAt(grid, x, y);
      const amount = flowState.flow[i];
      if (amount <= 0.05) continue;

      if (cell.house && cell.hp > 0) {
        housesHit.push(i);
        flowState.houseTimer[i] += dt;
        while (flowState.houseTimer[i] >= HOUSE_DAMAGE_INTERVAL) {
          flowState.houseTimer[i] -= HOUSE_DAMAGE_INTERVAL;
          cell.hp = Math.max(0, cell.hp - 1);
          flowState.houseDamage[i] += 1;
        }
        // Air yang menghantam rumah terserap (tidak mengalir lanjut).
        flowState.flow[i] *= 0.9;
      } else if (cell.mill) {
        const out = millOutput(cell.mill.type, amount * (1 + flowBonus));
        powerGenerated += out.power;
        forgeCharge += out.forgeCharge * (1 + forgeBonus);
        // Kincir memakai airnya; sisakan sedikit yang lolos.
        flowState.flow[i] *= 0.1;
      } else if (cell.forge) {
        // Air yang sampai tempaan langsung terserap tanpa charge.
        flowState.flow[i] *= 0.5;
      }
    }
  }

  // 6) Sinkronkan flow/pressure kembali ke sel (untuk render).
  let totalFlow = 0;
  for (let i = 0; i < n; i++) {
    grid.cells[i].flow = flowState.flow[i];
    grid.cells[i].pressure = flowState.pressure[i];
    totalFlow += flowState.flow[i];
  }

  return { totalFlow, powerGenerated, forgeCharge, housesHit };
}
