// water.js — simulasi aliran air di grid.
// Murni & deterministik: semua keacakan lewat opts.rng (mulberry32).
// Waktu datang dari parameter dt — tidak ada Date.now() di sini.

import { cellAt, cellIndex, neighbors4, OPPOSITE, DIRS } from './grid.js';
import { rotatedPorts, isGate, isOpen } from './pieces.js';
import { millOutput } from './mills.js';
import { mulberry32 } from './rng.js';

// Tekanan di atas nilai ini mulai menghitung waktu menuju jebol.
// (B1) Dinaikkan supaya pintu tertutup bertahan ~10-15 dtk, bukan ~5 dtk.
export const BURST_PRESSURE = 6.0;
// Lama tekanan berlebih sebelum saluran jebol (detik).
export const BURST_TIME = 4.0;
// Tiap 1,0 dtk aliran, rumah kehilangan 1 HP (B8: dengan HP 4, rumah
// bertahan ~4 dtk aliran kontinu — ada waktu reaksi).
export const HOUSE_DAMAGE_INTERVAL = 1.0;
// (K4) Rembesan forge: tiap unit power yang dihasilkan kincir biasa ikut
// mengisi tempaan sebesar ini. Disetel supaya layout demo (wood+stone,
// tanpa forge mill) yang dimainkan rapi menang tipis di malam 7
// (simulasi: ~108 di cuaca clear, ~115-125 di cuaca campuran — bahkan
// dengan 2 malam drought dalam 7 malam, demo masih menang tipis).
export const FORGE_SEEP_RATE = 0.09;

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
    // (K3) Arah aliran hilir: BITMASK arah gerak (bit = indeks DIRS) air
    // yang tiba di tiap sel pada tick terakhir. Satu bit set -> air hanya
    // keluar lewat port SELAIN port masuknya (no backflow). Dua bit atau
    // lebih (konfluensi: dua aliran bertemu) -> air tercampur dan boleh
    // keluar lewat semua port majunya; kalau tidak, aliran kedua akan
    // saling mengunci (dulu: inDir tunggal last-write-wins membuat
    // pasangan mata air (5,0)<->(5,1) menelan semua air second spring).
    // Bitmask dihitung ulang tiap tick dari kedatangan tick itu.
    inMask: new Uint8Array(n),
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

// Dari bitmask arah kedatangan, arah mana yang dilarang dipakai keluar?
// Satu arah kedatangan -> larang port baliknya (no backflow, K3).
// Nol / dua arah atau lebih -> tidak ada larangan (sel kosong arah, atau
// konfluensi tempat air tercampur). Mengembalikan satu dir atau null.
function backflowDir(inMask) {
  if (!inMask) return null;
  if ((inMask & (inMask - 1)) !== 0) return null; // 2+ bit: konfluensi
  const bit = Math.log2(inMask);
  return OPPOSITE[DIRS[bit]];
}

// Arah keluar air dari sebuah sel (port yang terhubung + tetangga mau terima).
// Mengembalikan daftar {x, y, dir} sel tujuan.
// excludeDir (opsional): arah yang TIDAK boleh dipakai — dipakai untuk
// melarang backflow (K3): air tidak mengalir balik ke sel tempat ia datang.
function cellExits(grid, x, y, excludeDir) {
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
    if (excludeDir && n.dir === excludeDir) continue; // (K3) no backflow
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
// Mengembalikan {totalFlow, flowRate, powerGenerated, forgeCharge, housesHit: [index]}.
//   totalFlow: stok air di grid saat ini.
//   flowRate: laju air yang MASUK dari mata air, unit/detik (K4: HUD "Water
//     flowing: X /s" harus menampilkan laju, bukan stok).
//   powerGenerated / forgeCharge: pertambahan DALAM tick ini, sudah diskala
//     dt (K4: laju per detik x dt — bukan angka mentah per tick).
//   housesHit: indeks sel rumah yang benar-benar KEHILANGAN HP pada tick
//     ini (B5: sekali per kejadian damage, bukan sekali per tick).
export function stepFlow(grid, flowState, dt, opts = {}) {
  const rng = opts.rng || mulberry32(1);
  const wMult = weatherMult(opts.weather || 'clear');
  const flowBonus = opts.flowBonus || 0;
  const forgeBonus = opts.forgeBonus || 0;
  const n = grid.cols * grid.rows;
  const idx = (x, y) => y * grid.cols + x;

  // 1) Air masuk dari mata air.
  let inflow = 0;
  for (const s of opts.sourceCells || []) {
    const cell = cellAt(grid, s.x, s.y);
    if (!cell || cell.blocked) continue;
    const added = (s.rate || 1) * wMult * dt;
    flowState.flow[idx(s.x, s.y)] += added;
    inflow += added;
  }

  // 2) Hitung aliran keluar tiap sel (berdasarkan kondisi awal tick).
  //    (K3) Air hanya keluar lewat port selain port masuknya: arah balik
  //    (dari bitmask kedatangan tick lalu) dikecualikan — kecuali di mata
  //    air (bebas) dan di konfluensi (air tercampur, semua port maju buka).
  //    Mask diperbarui DARI gerakan tick ini, tapi baru dipakai tick
  //    depan — jadi semua sel dihitung dari snapshot yang sama.
  const delta = new Float32Array(n);
  const exitsCache = new Array(n);
  const arrivedMask = new Uint8Array(n);
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const i = idx(x, y);
      const amount = flowState.flow[i];
      if (amount <= 0.001) continue;
      // (K3) Mata air mengabaikan larangan backflow: air yang tiba di mata
      // air (mis. surge dari (6,0), atau air second spring yang berputar
      // naik lewat kolom utama) harus bisa keluar lagi lewat port mana pun
      // — kalau tidak, air itu terjebak di mata air dan seluruh jalur di
      // belakangnya ikut tersumbat. Larangan backflow hanya untuk saluran.
      const isSource = cellAt(grid, x, y)?.source;
      const excludeDir = isSource ? null : backflowDir(flowState.inMask[i]);
      const exits = cellExits(grid, x, y, excludeDir);
      exitsCache[i] = exits;
      if (exits.length === 0) continue;
      // Sebagian air bergerak tiap detik; bagi rata ke semua jalan keluar.
      const move = Math.min(amount, amount * 3.0 * dt);
      const per = move / exits.length;
      delta[i] -= move;
      for (const e of exits) {
        delta[idx(e.x, e.y)] += per;
        arrivedMask[idx(e.x, e.y)] |= 1 << DIRS.indexOf(e.dir);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    flowState.flow[i] = Math.max(0, flowState.flow[i] + delta[i]);
    flowState.inMask[i] = arrivedMask[i];
  }

  // 3) Tekanan: sel yang menahan air (tanpa jalan keluar) naik tekanannya,
  //    sel yang mengalir lancar tekanannya reda.
  //    (B1) Laju tekanan diperlambat + ambang/waktu jebol dinaikkan, supaya
  //    pintu tertutup bertahan ~10-15 dtk. Jalan keluar yang dipakai di sini
  //    adalah yang SUDAH disaring backflow (K3): sel yang airnya cuma bisa
  //    balik ke hulu dianggap menahan air.
  const bursts = [];
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const i = idx(x, y);
      const cell = cellAt(grid, x, y);
      const amount = flowState.flow[i];
      const inM = flowState.inMask[i];
      const isSource = cellAt(grid, x, y)?.source;
      const excludeDir = isSource ? null : backflowDir(inM);
      const exits = exitsCache[i] || cellExits(grid, x, y, excludeDir);
      if (amount > 0.2 && exits.length === 0 && cell.piece) {
        // Menahan air: tekanan naik sebanding air yang tertahan.
        flowState.pressure[i] += dt * (0.25 + amount * 0.25);
        // Tekanan juga merambat ke sel di belakang (yang mengalir ke sini).
        for (const nb of neighbors4(grid, x, y)) {
          if (nb.cell.piece && !nb.cell.blocked) {
            flowState.pressure[idx(nb.x, nb.y)] += dt * 0.15;
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
  //    (K4) Output kincir dihitung sebagai LAJU per detik: kincir memproses
  //    air yang dikonsumsinya tick ini (90% stoknya); laju proses =
  //    konsumsi/dt, lalu output per tick = laju x dt. Jadi power/forge
  //    tidak lagi bergantung pada jumlah tick per detik.
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
        // (B5) Catat hit HANYA saat rumah benar-benar kehilangan HP
        // (sekali per interval damage), bukan sekali per tick.
        const dmgBefore = flowState.houseDamage[i];
        flowState.houseTimer[i] += dt;
        while (flowState.houseTimer[i] >= HOUSE_DAMAGE_INTERVAL) {
          flowState.houseTimer[i] -= HOUSE_DAMAGE_INTERVAL;
          cell.hp = Math.max(0, cell.hp - 1);
          flowState.houseDamage[i] += 1;
        }
        if (flowState.houseDamage[i] > dmgBefore) housesHit.push(i);
        // Air yang menghantam rumah terserap (tidak mengalir lanjut).
        flowState.flow[i] *= 0.9;
      } else if (cell.mill) {
        // Kincir memakai airnya; sisakan sedikit yang lolos.
        const consumed = amount * 0.9;
        const rate = dt > 0 ? consumed / dt : 0;
        const out = millOutput(cell.mill.type, rate * (1 + flowBonus));
        powerGenerated += out.power * dt;
        forgeCharge += out.forgeCharge * (1 + forgeBonus) * dt;
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

  return {
    totalFlow,
    flowRate: dt > 0 ? inflow / dt : 0,
    powerGenerated, forgeCharge, housesHit,
  };
}
