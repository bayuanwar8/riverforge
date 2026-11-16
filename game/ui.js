// ui.js — semua HUD, menu, toko, dan layar hasil digambar di canvas.
// Font sistem saja, tanpa aset. Setiap tombol didaftarkan ke state.buttons
// (main.js mengosongkan daftar itu tiap frame sebelum menggambar).

import { PIECES } from './pieces.js';
import { MILL_TYPES } from './mills.js';
import { UPGRADES, upgradeCost } from './economy.js';

const W = 1280, H = 720;

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
const PIECE_SHORT = { straight: 'Lurus', bend: 'Belokan', tee: 'Pertigaan', gate: 'Pintu', splitter: 'Pembagi' };

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
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
  ctx.fillText(state.combo > 1 ? 'COMBO x' + state.combo : 'no combo yet', 1060, 54);
  ctx.textAlign = 'left';

  // Cuaca — di tengah bar atas (celah kosong antara hati desa dan skor),
  // bukan di kanan: di sana bertabrakan dengan tombol mute/pause.
  ctx.fillStyle = '#cfe8ec';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText((state.weatherLabel || state.weather || 'clear') + (state.eventLabel ? ' • ' + state.eventLabel : ''), 800, 42);
  ctx.textAlign = 'left';

  btn(state, 'mute', 1100, 18, 44, 36, state.muted ? '🔇' : '🔊', { color: '#274b52', textColor: '#e8f4f4', fontSize: 16 });
  btn(state, 'pause', 1150, 18, 44, 36, state.paused ? '▶' : '⏸', { color: '#274b52', textColor: '#e8f4f4', fontSize: 16 });
}

// ---- Panel kanan: stok + kincir ----
function drawSidePanel(ctx, state) {
  _ctx = ctx;
  const x = 784, y = 92, w = 460 - 8, h = 220;
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

  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('MILLS — click, then click a cell', x + 16, y + 152);
  const mills = Object.values(MILL_TYPES || {});
  let mx = x + 16;
  for (const m of mills) {
    const sel = state.selectedMill === m.id;
    btn(state, 'mill:' + m.id, mx, y + 164, 136, 44, m.name,
      { label2: costShort(m), color: sel ? '#e8b45a' : '#274b52', textColor: sel ? '#1a1206' : '#e8f4f4', textColor2: sel ? '#5a3d08' : '#9fc4c8', fontSize: 13, fontSize2: 11 });
    mx += 142;
  }
}

// ---- Palet saluran bawah ----
function drawPiecePalette(ctx, state) {
  _ctx = ctx;
  const y = 644;
  panel(ctx, 28, y, 736, 64, 'rgba(8,20,24,0.85)');
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
  ctx.fillText('1-5 channels · R rotate · G toggle gate · Space pause · Esc menu · M mute', W / 2, 560);
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
  if (state.showShop) drawShop(ctx, state);
  if (state.showHowTo) drawHowTo(ctx, state);
}

export function drawNightHUD(ctx, state) {
  _ctx = ctx;
  drawTopBar(ctx, state);
  // Peringatan surge berikutnya.
  const next = state.nextSurgeIn;
  if (next != null && next <= 10 && state.surgesLeft > 0) {
    const blink = 0.5 + 0.5 * Math.sin(state.clock * 6);
    // Banner di kiri (280–760) supaya tidak tertutup panel FLOW (mulai x=784).
    panel(ctx, 280, 76, 480, 44, 'rgba(120,20,10,' + (0.55 + 0.3 * blink).toFixed(2) + ')');
    ctx.fillStyle = '#ffd9d0';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠  FLOOD SURGE IN ' + Math.ceil(next) + 's  —  ' + state.surgesLeft + ' left', 520, 105);
    ctx.textAlign = 'left';
  } else if (state.surgeActive) {
    panel(ctx, 280, 76, 480, 44, 'rgba(20,60,90,0.8)');
    ctx.fillStyle = '#8fe8ff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🌊  SURGE! Route the water through the mills!', 520, 105);
    ctx.textAlign = 'left';
  }
  // Panel kanan saat malam: info aliran.
  panel(ctx, 784, 92, 452, 150, 'rgba(8,20,24,0.85)');
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('FLOW', 800, 122);
  ctx.fillStyle = '#e8f4f4';
  ctx.font = '16px sans-serif';
  ctx.fillText('Water flowing: ' + Math.floor(state.lastFlow || 0) + ' /s', 800, 148);
  ctx.fillText('Power this night: ' + Math.floor(state.powerThisNight || 0), 800, 172);
  ctx.fillText('Houses hit tonight: ' + (state.damageThisNight || 0), 800, 196);
  ctx.fillStyle = '#7fa3a8';
  ctx.font = '13px sans-serif';
  ctx.fillText('Click a gate (or press G) to open / close it.', 800, 222);
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
  ctx.fillStyle = win ? '#ffd23e' : '#ff8a7a';
  ctx.font = 'bold 52px sans-serif';
  ctx.fillText(win ? 'THE FORGE BURNS!' : 'THE VALLEY FLOODS', 640, 190);
  ctx.fillStyle = '#e8f4f4';
  ctx.font = '20px sans-serif';
  ctx.fillText(win ? 'Seven nights held. The forge is fully charged.' : 'The village is gone — but the river remembers.', 640, 228);

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
    ctx.fillText(String(val), 880, ry);
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
    y += 66;
    if (y > 560) break;
  }
  if (state.shopMsg) {
    ctx.fillStyle = '#ffb0a0';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.shopMsg, 640, y + 6);
    ctx.textAlign = 'left';
  }
  btn(state, 'close-shop', 540, 580, 200, 40, 'CLOSE', { color: '#274b52', textColor: '#e8f4f4', fontSize: 15 });
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
    'Channels cost timber and stone. Rotate with R.',
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
    '1-5 select channel · R rotate · G toggle gate',
    'Space pause · Esc menu · M mute',
  ];
  let y = 210;
  for (const ln of lines) {
    ctx.fillText(ln, 380, y);
    y += 24;
  }
  btn(state, 'close-howto', 540, 540, 200, 40, 'GOT IT', { fontSize: 15 });
}
