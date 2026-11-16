// ui.js — semua HUD, menu, toko, dan layar hasil digambar di canvas.
// Font sistem saja, tanpa aset. Setiap tombol didaftarkan ke state.buttons
// (main.js mengosongkan daftar itu tiap frame sebelum menggambar).

import { PIECES, rotatedPorts } from './pieces.js';
import { MILL_TYPES } from './mills.js';
import { UPGRADES, upgradeCost } from './economy.js';
import { flowAt } from './water.js';
import { cellAt, inBounds, OPPOSITE } from './grid.js';

const W = 1280, H = 720;

// ---- Connection check (build preview) ----
// BFS from the spring(s) through mutually-connected piece ports.
// Returns { unconnected: [{x,y}], deadend: [{x,y}] }.
// - unconnected: piece with no path back to any spring (e.g. rotated
//   the wrong way) — water can never reach it.
// - deadend: piece reachable from a spring, but one of its ports leads
//   nowhere (empty cell, house, or a neighbour without a matching port).
// Blocked (dam/debris) pieces still count as passable here: this is a
// layout check, not a live-flow check. Mills, the forge and springs
// count as valid endpoints for a port.
export function connectionWarnings(state) {
  const out = { unconnected: [], deadend: [] };
  const grid = state.grid;
  if (!grid) return out;
  const sources = (state.springs || [{ x: 5, y: 0 }]).slice();
  if (state.secondSpring && !sources.some((s) => s.x === 8 && s.y === 0)) {
    sources.push({ x: 8, y: 0 });
  }
  const key = (x, y) => x + ',' + y;
  const reachable = new Set();
  const queue = [];
  const tryEnter = (x, y, fromDir) => {
    // fromDir: direction FROM this cell TOWARDS the cell we came from.
    if (!inBounds(grid, x, y)) return false;
    const c = cellAt(grid, x, y);
    if (!c || !c.piece) return false;
    let ports = [];
    try { ports = rotatedPorts(c.piece) || []; } catch (_e) { ports = []; }
    if (!ports.includes(fromDir)) return false;
    if (reachable.has(key(x, y))) return false;
    reachable.add(key(x, y));
    queue.push({ x, y });
    return true;
  };
  // Seed: any piece with a port facing a spring is connected.
  const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  for (const s of sources) {
    for (const dir of Object.keys(DIRS)) {
      const [dx, dy] = DIRS[dir];
      tryEnter(s.x + dx, s.y + dy, OPPOSITE[dir]);
    }
  }
  while (queue.length) {
    const cur = queue.shift();
    const c = cellAt(grid, cur.x, cur.y);
    let ports = [];
    try { ports = rotatedPorts(c.piece) || []; } catch (_e) { ports = []; }
    for (const dir of ports) {
      const [dx, dy] = DIRS[dir];
      tryEnter(cur.x + dx, cur.y + dy, OPPOSITE[dir]);
    }
  }
  // Classify every placed piece.
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const c = cellAt(grid, x, y);
      if (!c || !c.piece) continue;
      if (!reachable.has(key(x, y))) { out.unconnected.push({ x, y }); continue; }
      let ports = [];
      try { ports = rotatedPorts(c.piece) || []; } catch (_e) { ports = []; }
      let dead = false;
      for (const dir of ports) {
        const [dx, dy] = DIRS[dir];
        const nx = x + dx, ny = y + dy;
        if (!inBounds(grid, nx, ny)) { dead = true; break; }
        const n = cellAt(grid, nx, ny);
        if (!n) { dead = true; break; }
        if (n.mill || n.forge || n.source) continue;
        if (n.house || !n.piece) { dead = true; break; }
        let nports = [];
        try { nports = rotatedPorts(n.piece) || []; } catch (_e) { nports = []; }
        if (!nports.includes(OPPOSITE[dir])) { dead = true; break; }
      }
      if (dead) out.deadend.push({ x, y });
    }
  }
  return out;
}

// Red "!" markers over unconnected / dead-end pieces (drawn on top of
// the grid by the build & night HUDs). Also stashes the counts on state
// so headless checks can read them.
// (C) showDeadend=false: only unconnected pieces get a marker. A dead end
// is normal mid-build (the player is still laying channels), so flagging
// it during the day is just noise — it only matters at night, when water
// actually flows.
function drawConnectionWarnings(ctx, state, showDeadend) {
  const warn = connectionWarnings(state);
  state._connWarnings = {
    unconnected: warn.unconnected.length,
    deadend: warn.deadend.length,
  };
  const marks = showDeadend === false
    ? warn.unconnected
    : [...warn.unconnected, ...warn.deadend];
  const total = marks.length;
  if (total === 0) return warn;
  const L = state.layout;
  if (!L) return warn;
  const blink = 0.6 + 0.4 * Math.sin((state.clock || 0) * 5);
  for (const { x, y } of marks) {
    const px = L.gridX + x * L.cell, py = L.gridY + y * L.cell;
    ctx.strokeStyle = 'rgba(255,70,50,' + blink.toFixed(2) + ')';
    ctx.lineWidth = 3;
    ctx.strokeRect(px + 3, py + 3, L.cell - 6, L.cell - 6);
    // "!" badge, top-right corner of the cell.
    ctx.fillStyle = '#ff4632';
    ctx.beginPath();
    ctx.arc(px + L.cell - 12, py + 12, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', px + L.cell - 12, py + 13);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }
  return warn;
}

function btn(state, id, x, y, w, h, label, opts) {
  const o = opts || {};
  o.label = label;
  const hov = state.hoverButton && state.hoverButton.id === id;
  // Tombol disabled tetap didaftarkan sebagai 'disabled' supaya kliknya
  // tertelan (tidak tembus ke grid di belakangnya).
  (state.buttons = state.buttons || []).push({ id: o.disabled ? 'disabled' : id, x, y, w, h });
  ctxFill(state, x, y, w, h, hov, o);
  return { x, y, w, h };
}

// Helper gambar tombol — dipanggil dari btn() lewat state.ctx sementara.
let _ctx = null;
function ctxFill(state, x, y, w, h, hov, o) {
  const ctx = _ctx;
  ctx.fillStyle = o.disabled ? '#3a4448' : (hov ? '#e8b45a' : (o.color || '#c98f2e'));
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();
  ctx.fillStyle = o.disabled ? '#8a9494' : (o.textColor || '#1a1206');
  ctx.font = 'bold ' + (o.fontSize || 15) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.label2) {
    // Tombol dua baris: nama di atas, harga singkat di bawah.
    ctx.fillText(o.label || '', x + w / 2, y + h / 2 - 8);
    ctx.fillStyle = o.disabled ? '#8a9494' : (o.textColor2 || '#cfe8ec');
    ctx.font = (o.fontSize2 || 11) + 'px sans-serif';
    ctx.fillText(o.label2, x + w / 2, y + h / 2 + 10);
  } else {
    ctx.fillText(o.label || '', x + w / 2, y + h / 2 + 1);
  }
  ctx.textBaseline = 'alphabetic';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function panel(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill || 'rgba(10,24,28,0.88)';
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,200,210,0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();
}

function bar(ctx, x, y, w, h, frac, fill, bg) {
  ctx.fillStyle = bg || 'rgba(0,0,0,0.5)';
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  if (frac > 0) {
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, Math.max(4, w * Math.max(0, Math.min(1, frac))), h, 4);
    ctx.fill();
  }
}

function costText(def) {
  const c = def.cost;
  if (c == null) return 'free';
  if (typeof c === 'number') return c + ' power';
  const parts = [];
  if (c.timber) parts.push(c.timber + ' timber');
  if (c.stone) parts.push(c.stone + ' stone');
  if (c.power) parts.push(c.power + ' power');
  return parts.join(' + ') || 'free';
}

// Versi singkat untuk tombol dua baris (muat di lebar ~136px).
function costShort(def) {
  const c = def.cost;
  if (c == null) return 'free';
  if (typeof c === 'number') return c + ' power';
  const parts = [];
  if (c.timber) parts.push(c.timber + ' timber');
  if (c.stone) parts.push(c.stone + ' stone');
  if (c.power) parts.push(c.power + ' power');
  return parts.join(' + ') || 'free';
}

// Nama pendek saluran untuk palet bawah (tanpa "Saluran" / "Air").
const PIECE_SHORT = { straight: 'Straight', bend: 'Corner', tee: 'T-Junction', gate: 'Gate', splitter: 'Splitter' };

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// Potong teks dengan ellipsis supaya muat dalam maxW piksel (diukur
// dengan font yang sedang aktif di ctx).
function truncateCenter(ctx, text, maxW) {
  if (!text || ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

// Bungkus teks ke beberapa baris (maks maxW piksel, font sedang aktif).
function wrapLines(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Satu baris progres gelombang untuk panel FLOW malam hari, misal
// "Surge 1/2 — next in 12s" atau "Surge 2/2 — ACTIVE".
// surgesLeft = gelombang yang BELUM dimulai; gelombang yang sedang aktif
// sudah dikurangi dari hitungan itu saat ia dimulai.
function surgeLine(state) {
  const total = (state.surges && state.surges.length) || 0;
  if (total === 0) return 'Surges: —';
  const left = state.surgesLeft || 0;
  const no = Math.max(1, Math.min(total, total - left + (state.surgeActive ? 0 : 1)));
  if (state.surgeActive) return 'Surge ' + no + '/' + total + ' — ACTIVE';
  if (left > 0 && state.nextSurgeIn != null) {
    return 'Surge ' + no + '/' + total + ' — next in ' + Math.ceil(state.nextSurgeIn) + 's';
  }
  if (left <= 0) return 'Surges done (' + total + '/' + total + ')';
  return 'Surge ' + no + '/' + total;
}

// ---- Bar atas: dipakai build & night ----
function drawTopBar(ctx, state) {
  _ctx = ctx;
  panel(ctx, 8, 8, W - 16, 56, 'rgba(8,20,24,0.85)');
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('NIGHT ' + state.night + ' / 7', 24, 42);

  const timer = state.phase === 'build' ? state.buildTimer : state.nightTimer;
  ctx.fillStyle = '#e8f4f4';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(fmtTime(timer || 0), 170, 42);

  ctx.fillStyle = '#8fe8ff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('⚡ ' + Math.floor(state.power || 0), 250, 41);

  // Forge charge bar.
  ctx.fillStyle = '#e8f4f4';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('FORGE', 350, 30);
  bar(ctx, 350, 36, 150, 12, (state.forgeCharge || 0) / 100, '#ff8a2a');
  ctx.fillStyle = '#ffd98c';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(Math.floor(state.forgeCharge || 0) + '%', 505, 47);

  // Village HP sebagai hati.
  ctx.fillStyle = '#e8f4f4';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('VILLAGE', 540, 30);
  const maxHP = state.maxVillageHP || 5;
  let hearts = '';
  for (let i = 0; i < maxHP; i++) hearts += i < (state.villageHP || 0) ? '♥ ' : '♡ ';
  ctx.fillStyle = '#ff6a5a';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(hearts, 540, 50);

  // Skor + combo.
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('SCORE ' + Math.floor(state.score || 0), 1060, 34);
  ctx.fillStyle = state.combo > 1 ? '#8fe8ff' : '#7fa3a8';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(state.combo > 1 ? 'COMBO x' + state.combo : 'Flawless x' + (state.flawlessStreak || 0), 1060, 54);
  ctx.textAlign = 'left';

  // Cuaca — di tengah bar atas (celah kosong antara hati desa dan skor),
  // bukan di kanan: di sana bertabrakan dengan tombol mute/pause.
  // Dibatasi lebarnya supaya label event yang panjang tidak menabrak skor.
  const weatherText = (state.weatherLabel || state.weather || 'clear') + (state.eventLabel ? ' • ' + state.eventLabel : '');
  ctx.fillStyle = '#cfe8ec';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(truncateCenter(ctx, weatherText, 280), 800, 42);
  ctx.textAlign = 'left';

  btn(state, 'mute', 1100, 18, 44, 36, state.muted ? '🔇' : '🔊', { color: '#274b52', textColor: '#e8f4f4', fontSize: 16 });
  btn(state, 'pause', 1150, 18, 44, 36, state.paused ? '▶' : '⏸', { color: '#274b52', textColor: '#e8f4f4', fontSize: 16 });
}

// ---- Panel kanan: stok + kincir ----
function drawSidePanel(ctx, state) {
  _ctx = ctx;
  const x = 784, y = 92, w = 460 - 8, h = 236;
  panel(ctx, x, y, w, h);
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('SUPPLY', x + 16, y + 28);
  ctx.fillStyle = '#e8f4f4';
  ctx.font = '16px sans-serif';
  ctx.fillText('🪵 Timber: ' + (state.stock ? state.stock.timber : 0) + '    🪨 Stone: ' + (state.stock ? state.stock.stone : 0), x + 16, y + 54);
  ctx.fillText('Pieces left today: ' + (state.piecesLeft != null ? state.piecesLeft : '—'), x + 16, y + 78);
  ctx.fillStyle = '#7fa3a8';
  ctx.font = '13px sans-serif';
  ctx.fillText('Click a channel below, then click a grid cell.', x + 16, y + 102);
  ctx.fillText('Click a gate to open / close it. Click debris to clear.', x + 16, y + 122);
  ctx.fillText('At night, click a wrecked channel to rebuild it (−10 ⚡).', x + 16, y + 142);

  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('MILLS — click, then click a cell', x + 16, y + 168);
  const mills = Object.values(MILL_TYPES || {});
  let mx = x + 16;
  for (const m of mills) {
    const sel = state.selectedMill === m.id;
    btn(state, 'mill:' + m.id, mx, y + 180, 136, 44, m.name,
      { label2: costShort(m), color: sel ? '#e8b45a' : '#274b52', textColor: sel ? '#1a1206' : '#e8f4f4', textColor2: sel ? '#5a3d08' : '#9fc4c8', fontSize: 13, fontSize2: 11 });
    mx += 142;
  }
}

// ---- Palet saluran bawah ----
function drawPiecePalette(ctx, state) {
  _ctx = ctx;
  const y = 644;
  panel(ctx, 28, y, 1224, 64, 'rgba(8,20,24,0.85)');
  const order = ['straight', 'bend', 'tee', 'gate', 'splitter'];
  let px = 40;
  order.forEach((id, i) => {
    const def = PIECES[id];
    if (!def) return;
    const sel = state.selectedPiece === id;
    btn(state, 'piece:' + id, px, y + 10, 136, 44,
      (i + 1) + '  ' + (PIECE_SHORT[id] || def.name || id),
      { label2: costShort(def), color: sel ? '#e8b45a' : '#274b52', textColor: sel ? '#1a1206' : '#e8f4f4', textColor2: sel ? '#5a3d08' : '#9fc4c8', fontSize: 13, fontSize2: 11 });
    px += 144;
  });
  // Orientasi penempatan BERIKUTNYA (diatur dengan R) — supaya pemain
  // tahu persis arah saluran yang akan dipasang sebelum mengeklik grid.
  if (state.selectedPiece) {
    const def = PIECES[state.selectedPiece];
    let ports = [];
    try { ports = rotatedPorts({ type: state.selectedPiece, rot: state.rot || 0 }) || []; } catch (_e) { ports = []; }
    ctx.fillStyle = '#f5c86e';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('NEXT: ' + (PIECE_SHORT[state.selectedPiece] || def.name || state.selectedPiece), 790, y + 27);
    ctx.fillStyle = '#8fe8ff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('rot ' + (state.rot || 0) + '  ·  ports ' + (ports.join('·') || '—'), 790, y + 48);
    ctx.fillStyle = '#7fa3a8';
    ctx.font = '13px sans-serif';
    ctx.fillText('R to rotate', 1080, y + 38);
  }
}

export function drawTitle(ctx, state) {
  _ctx = ctx;
  ctx.fillStyle = 'rgba(6,14,18,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 84px sans-serif';
  ctx.fillText('RIVERFORGE', W / 2, 240);
  ctx.fillStyle = '#e8f4f4';
  ctx.font = '24px sans-serif';
  ctx.fillText('bend the river · power the forge · hold the valley', W / 2, 284);
  ctx.fillStyle = '#9fc4c8';
  ctx.font = '16px sans-serif';
  ctx.fillText('Seven nights. One forge. Don\'t let the flood take the village.', W / 2, 316);
  btn(state, 'start', W / 2 - 130, 360, 260, 56, '▶  START', { fontSize: 22 });
  btn(state, 'howto', W / 2 - 130, 432, 260, 48, 'HOW TO PLAY', { color: '#274b52', textColor: '#e8f4f4', fontSize: 16 });
  const hs = state.highScore || 0;
  if (hs > 0) {
    ctx.fillStyle = '#f5c86e';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('BEST SCORE: ' + hs, W / 2, 520);
  }
  ctx.fillStyle = '#7fa3a8';
  ctx.font = '13px sans-serif';
  ctx.fillText('1-5 channels · R rotate next piece · G toggle gate · Space pause · Esc menu · M mute', W / 2, 560);
  ctx.textAlign = 'left';
  if (state.showHowTo) drawHowTo(ctx, state);
}

export function drawBuildHUD(ctx, state) {
  _ctx = ctx;
  drawTopBar(ctx, state);
  drawSidePanel(ctx, state);
  drawPiecePalette(ctx, state);
  // Tombol aksi utama.
  btn(state, 'night', 784, 330, 220, 52, '🌙  START NIGHT', { fontSize: 18 });
  btn(state, 'shop', 1016, 330, 220, 52, '🛒  SHOP', { color: '#274b52', textColor: '#e8f4f4', fontSize: 18 });
  ctx.fillStyle = '#cfe8ec';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Day ' + state.night + ' — build channels from the spring to the mills,', 784, 412);
  ctx.fillText('then to the forge. Water that hits a house damages the village.', 784, 434);
  ctx.fillText('Gates hold back water — but pressure builds. Watch the red dot!', 784, 456);
  if (state.buildMsg) {
    ctx.fillStyle = '#ffb0a0';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(state.buildMsg, 784, 486);
  }
  // Peringatan koneksi: piece yang tidak terhubung / buntu (tanda "!" merah
  // di grid) dijelaskan di sini supaya pemain baru tidak membangun
  // layout yang kelihatan nyambung tapi tidak mengalir.
  // (C) Siang hari hanya piece TAK TERHUBUNG yang diperingatkan — dead-end
  // masih wajar saat membangun bertahap (lihat drawConnectionWarnings).
  const warn = drawConnectionWarnings(ctx, state, false);
  const badCount = warn.unconnected.length;
  if (badCount > 0) {
    ctx.fillStyle = '#ff9a8a';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('⚠ ' + badCount + ' piece' + (badCount > 1 ? 's' : '') + ' not connected to the spring — see the red ! marks', 784, 512);
  }
  // (C) Piece terpasang yang dipilih (klik): R memutarnya, X menghapusnya.
  if (state.selectedPlaced) {
    const c = cellAt(state.grid, state.selectedPlaced.x, state.selectedPlaced.y);
    const label = c && c.piece ? (PIECE_SHORT[c.piece.type] || c.piece.type) : 'channel';
    ctx.fillStyle = '#f5c86e';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('Selected ' + label + ' at (' + (state.selectedPlaced.x + 1) + ',' + (state.selectedPlaced.y + 1) + ') — R rotate · X remove (no refund)', 784, 540);
  }
  if (state.showShop) drawShop(ctx, state);
  if (state.showHowTo) drawHowTo(ctx, state);
}

export function drawNightHUD(ctx, state) {
  _ctx = ctx;
  drawTopBar(ctx, state);
  // Peringatan surge berikutnya — strip ramping di celah antara bar atas
  // (berakhir y=64) dan grid (mulai y=92), supaya tidak menutupi grid.
  const next = state.nextSurgeIn;
  if (next != null && next <= 10 && state.surgesLeft > 0) {
    const blink = 0.5 + 0.5 * Math.sin(state.clock * 6);
    // Banner di kiri (280–760) supaya tidak tertutup panel FLOW (mulai x=784).
    panel(ctx, 280, 64, 480, 26, 'rgba(120,20,10,' + (0.55 + 0.3 * blink).toFixed(2) + ')');
    ctx.fillStyle = '#ffd9d0';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠  FLOOD SURGE IN ' + Math.ceil(next) + 's  —  ' + state.surgesLeft + ' left', 520, 82);
    ctx.textAlign = 'left';
  } else if (state.surgeActive) {
    panel(ctx, 280, 64, 480, 26, 'rgba(20,60,90,0.8)');
    ctx.fillStyle = '#8fe8ff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🌊  SURGE! Route the water through the mills!', 520, 82);
    ctx.textAlign = 'left';
  }
  // Panel kanan saat malam: info aliran + progres gelombang + event +
  // status tempaan & kincir. Diperluas sampai y=492 supaya separuh kanan
  // layar tidak kosong/gelap di bawah panel FLOW yang lama (cuma 200px).
  panel(ctx, 784, 92, 452, 400, 'rgba(8,20,24,0.85)');
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('FLOW', 800, 122);
  ctx.fillStyle = '#e8f4f4';
  ctx.font = '16px sans-serif';
  ctx.fillText('Water flowing: ' + Math.floor(state.lastFlow || 0) + ' /s', 800, 148);
  ctx.fillText('Power this night: ' + Math.floor(state.powerThisNight || 0), 800, 172);
  ctx.fillText('Houses hit tonight: ' + (state.damageThisNight || 0), 800, 196);
  ctx.fillText(surgeLine(state), 800, 220);
  // Bar progres surge: sisa waktu surge aktif, atau hitung mundur ke
  // surge berikutnya kalau belum ada yang aktif.
  let surgeFrac = 0;
  if (state.surgeActive) {
    surgeFrac = Math.max(0, Math.min(1, (state.surgeTimer || 0) / 8));
  } else if (state.nextSurgeIn != null && (state.surgesLeft || 0) > 0) {
    surgeFrac = Math.max(0, Math.min(1, 1 - (state.nextSurgeIn || 0) / 25));
  }
  bar(ctx, 800, 230, 420, 10, surgeFrac, state.surgeActive ? '#4fc8ff' : '#2a6a8a');
  // Event malam itu — teks lengkap (bukan yang terpotong di bar atas).
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText("TONIGHT'S EVENT", 800, 268);
  ctx.fillStyle = '#ffd9a0';
  ctx.font = '15px sans-serif';
  const evLines = wrapLines(ctx, state.eventLabel || 'Nothing unusual — yet.', 420).slice(0, 2);
  let evY = 290;
  for (const ln of evLines) { ctx.fillText(ln, 800, evY); evY += 20; }
  // Tempaan: charge + bar (cermin bar atas, tapi dengan konteks menang).
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('FORGE  ' + Math.floor(state.forgeCharge || 0) + '%  —  win at 100% after Night 7', 800, 336);
  bar(ctx, 800, 344, 420, 12, (state.forgeCharge || 0) / 100, '#ff8a2a');
  // Kincir: status putaran dari aliran nyata di selnya.
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('MILLS', 800, 384);
  ctx.fillStyle = '#e8f4f4';
  ctx.font = '15px sans-serif';
  let millY = 406;
  let millsSeen = 0;
  if (state.grid) {
    for (let y = 0; y < state.grid.rows && millsSeen < 3; y++) {
      for (let x = 0; x < state.grid.cols && millsSeen < 3; x++) {
        const cell = cellAt(state.grid, x, y);
        if (!cell || !cell.mill) continue;
        const mdef = MILL_TYPES[cell.mill.type] || {};
        let fl = 0;
        try { fl = state.flowState ? flowAt(state.flowState, x, y) : 0; } catch (_e) { fl = 0; }
        const spin = fl > 0.0005;
        ctx.fillStyle = spin ? '#8fe8ff' : '#7fa3a8';
        ctx.fillText((mdef.name || cell.mill.type) + ' — ' + (spin ? 'spinning, making power' : 'dry, no water yet'), 800, millY);
        millY += 22;
        millsSeen += 1;
      }
    }
  }
  if (millsSeen === 0) {
    ctx.fillStyle = '#7fa3a8';
    ctx.fillText('No mills built yet.', 800, millY);
  }
  ctx.fillStyle = '#7fa3a8';
  ctx.font = '13px sans-serif';
  ctx.fillText('Click a gate (or press G) to open / close it.', 800, 468);
  ctx.fillText('Click a wrecked channel to rebuild it (−10 ⚡).', 800, 486);
  drawConnectionWarnings(ctx, state);
  if (state.paused) {
    panel(ctx, 440, 300, 400, 90);
    ctx.fillStyle = '#f5c86e';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', 640, 340);
    ctx.fillStyle = '#cfe8ec';
    ctx.font = '15px sans-serif';
    ctx.fillText('Space to resume · Esc for menu', 640, 368);
    ctx.textAlign = 'left';
  }
}

export function drawResults(ctx, state, win) {
  _ctx = ctx;
  ctx.fillStyle = win ? 'rgba(20,30,8,0.55)' : 'rgba(30,8,8,0.55)';
  ctx.fillRect(0, 0, W, H);
  panel(ctx, 340, 110, 600, 500, 'rgba(8,20,24,0.94)');
  ctx.textAlign = 'center';
  // (B9) Teks kalah mengikuti alasan sebenarnya: 'forge' = forge tidak
  // terisi sampai malam 7 (desa masih utuh) — BUKAN banjir.
  const forgeLoss = !win && state.lossReason === 'forge';
  ctx.fillStyle = win ? '#ffd23e' : (forgeLoss ? '#ffb35a' : '#ff8a7a');
  ctx.font = 'bold 52px sans-serif';
  ctx.fillText(win ? 'THE FORGE BURNS!' : (forgeLoss ? 'THE FORGE GOES COLD' : 'THE VALLEY FLOODS'), 640, 190);
  ctx.fillStyle = '#e8f4f4';
  ctx.font = '20px sans-serif';
  ctx.fillText(win ? 'Seven nights held. The forge is fully charged.'
    : (forgeLoss ? 'Seven nights passed and the forge never caught fire.'
      : 'The village is gone — but the river remembers.'), 640, 228);

  const b = state.breakdown || {};
  const rows = [
    ['Power generated', b.powerScore || 0],
    ['Nights survived  (100 each)', b.nightsScore || 0],
    ['Flawless nights bonus', b.flawlessBonus || 0],
    ['Forge charge bonus', b.forgeBonusScore || 0],
  ];
  ctx.textAlign = 'left';
  ctx.font = '18px sans-serif';
  let ry = 290;
  for (const [label, val] of rows) {
    ctx.fillStyle = '#cfe8ec';
    ctx.fillText(label, 400, ry);
    ctx.fillStyle = '#f5c86e';
    ctx.textAlign = 'right';
    // Skor disimpan sebagai float — tampilkan bilangan bulat (floor)
    // supaya baris breakdown berjumlah tepat sama dengan total.
    ctx.fillText(String(Math.floor(val || 0)), 880, ry);
    ctx.textAlign = 'left';
    ry += 36;
  }
  ctx.strokeStyle = 'rgba(245,200,110,0.5)';
  ctx.beginPath(); ctx.moveTo(400, ry - 8); ctx.lineTo(880, ry - 8); ctx.stroke();
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('TOTAL', 400, ry + 28);
  ctx.textAlign = 'right';
  ctx.fillText(String(Math.floor(state.score || 0)), 880, ry + 28);
  ctx.textAlign = 'center';
  ctx.fillStyle = (state.highScore || 0) > 0 && Math.floor(state.score || 0) >= (state.highScore || 0)
    ? '#ffd23e' : '#7fa3a8';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('BEST: ' + (state.highScore || 0) + ((state.highScore || 0) > 0 && Math.floor(state.score || 0) >= (state.highScore || 0) ? '  —  NEW BEST!' : ''), 640, ry + 66);
  btn(state, win ? 'again' : 'retry', 490, 520, 300, 52, win ? '↻  PLAY AGAIN' : '↻  TRY AGAIN', { fontSize: 18 });
  btn(state, 'title', 540, 584, 200, 40, 'MENU', { color: '#274b52', textColor: '#e8f4f4', fontSize: 15 });
  ctx.textAlign = 'left';
}

export function drawShop(ctx, state) {
  _ctx = ctx;
  ctx.fillStyle = 'rgba(4,10,12,0.6)';
  ctx.fillRect(0, 0, W, H);
  panel(ctx, 300, 90, 680, 540, 'rgba(8,20,24,0.96)');
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NIGHT MARKET', 640, 140);
  ctx.fillStyle = '#cfe8ec';
  ctx.font = '15px sans-serif';
  ctx.fillText('Spend power on upgrades. Your power: ' + Math.floor(state.power || 0) + ' ⚡', 640, 168);
  ctx.textAlign = 'left';
  const list = UPGRADES || [];
  let y = 200;
  for (const u of list) {
    const cost = upgradeCost ? upgradeCost(state, u.id) : u.cost;
    // Jumlah pembelian dari economy.js (boughtUpgrades); upgrade sekali
    // beli -> OWNED, yang repeatable -> MAXED setelah maxRepeat.
    const bought = (state.boughtUpgrades && state.boughtUpgrades[u.id]) || 0;
    const owned = !u.repeatable && bought >= 1;
    const maxed = !!u.repeatable && !!u.maxRepeat && bought >= u.maxRepeat;
    const locked = u.minNight && state.night < u.minNight;
    const afford = !owned && !maxed && !locked && (state.power || 0) >= (typeof cost === 'number' ? cost : 0);
    panel(ctx, 330, y, 620, 56, owned ? 'rgba(30,60,40,0.9)' : 'rgba(16,34,40,0.9)');
    ctx.fillStyle = '#e8f4f4';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(u.name, 346, y + 22);
    ctx.fillStyle = '#9fc4c8';
    ctx.font = '13px sans-serif';
    ctx.fillText(u.desc || '', 346, y + 42);
    if (owned) {
      ctx.fillStyle = '#8fe8a0';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('OWNED ✓', 930, y + 30);
      ctx.textAlign = 'left';
    } else if (maxed) {
      ctx.fillStyle = '#8fe8a0';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('MAXED (' + bought + 'x)', 930, y + 30);
      ctx.textAlign = 'left';
    } else if (locked) {
      ctx.fillStyle = '#7fa3a8';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Night ' + u.minNight + '+', 930, y + 30);
      ctx.textAlign = 'left';
    } else {
      btn(state, 'buy:' + u.id, 830, y + 10, 106, 36,
        (typeof cost === 'number' ? cost + ' ⚡' : costText({ cost })),
        { disabled: !afford, fontSize: 14 });
    }
    y += 62;
    if (y > 560) break;
  }
  if (state.shopMsg) {
    ctx.fillStyle = '#ffb0a0';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.shopMsg, 640, y + 6);
    ctx.textAlign = 'left';
  }
  // CLOSE di bawah panel upgrade terakhir (panel terakhir berakhir y=566),
  // bukan menabraknya.
  btn(state, 'close-shop', 540, 588, 200, 34, 'CLOSE', { color: '#274b52', textColor: '#e8f4f4', fontSize: 15 });
}

export function drawHowTo(ctx, state) {
  _ctx = ctx;
  ctx.fillStyle = 'rgba(4,10,12,0.7)';
  ctx.fillRect(0, 0, W, H);
  panel(ctx, 340, 120, 600, 480, 'rgba(8,20,24,0.96)');
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HOW TO PLAY', 640, 170);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8f4f4';
  ctx.font = '16px sans-serif';
  const lines = [
    'DAY — build channels from the spring at the top',
    'of the valley down to the mills and the forge.',
    'Channels cost timber and stone. R rotates the next piece',
    '(see NEXT in the palette). A red ! marks a channel',
    'not connected to the spring.',
    '',
    'NIGHT — water flows in real time. Open and close',
    'gates (click or G) to send water through mills',
    'for power, and keep it away from the houses.',
    'A closed gate builds pressure — it can burst!',
    '',
    'WIN — charge the forge to 100% after Night 7.',
    'LOSE — every house in the village is destroyed.',
    '',
    'CONTROLS',
    '1-5 select channel · R rotate next piece · G toggle gate',
    'Space pause · Esc menu · M mute',
  ];
  let y = 205;
  for (const ln of lines) {
    ctx.fillText(ln, 380, y);
    y += 21;
  }
  btn(state, 'close-howto', 540, 556, 200, 40, 'GOT IT', { fontSize: 15 });
}
