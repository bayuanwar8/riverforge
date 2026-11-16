// render.js — semua gambar prosedural di canvas 1280x720, tanpa aset eksternal.
// draw(ctx, state, t): latar senja + gunung + lembah + grid + air + kincir + tempaan.

import { rotatedPorts } from './pieces.js';
import { flowAt } from './water.js';
import { cellAt } from './grid.js';

// Arah port Builder A: 'N','E','S','W' — vektor per arah.
const DIR_VEC = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

function cellCenter(L, x, y) {
  return { x: L.gridX + x * L.cell + L.cell / 2, y: L.gridY + y * L.cell + L.cell / 2 };
}

function flowOf(state, x, y) {
  try {
    if (!state.flowState) return 0;
    const f = flowAt(state.flowState, x, y);
    return typeof f === 'number' ? f : (f && typeof f.flow === 'number' ? f.flow : 0);
  } catch (_e) { return 0; }
}

function drawSky(ctx, state, t) {
  const night = state.phase === 'night' || state.phase === 'win' || state.phase === 'loss';
  const g = ctx.createLinearGradient(0, 0, 0, 720);
  if (night) {
    g.addColorStop(0, '#0b1026');
    g.addColorStop(0.45, '#1c2a4a');
    g.addColorStop(0.75, '#7a4a3a');
    g.addColorStop(1, '#2a1a20');
  } else {
    g.addColorStop(0, '#2c4a6e');
    g.addColorStop(0.5, '#7a6a72');
    g.addColorStop(0.8, '#e08a4e');
    g.addColorStop(1, '#3a2a30');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, 720);

  // Matahari senja / bulan.
  const sunX = 1080, sunY = night ? 90 : 150;
  const sunG = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 90);
  sunG.addColorStop(0, night ? 'rgba(235,230,200,0.95)' : 'rgba(255,214,140,0.95)');
  sunG.addColorStop(0.35, night ? 'rgba(220,215,180,0.35)' : 'rgba(255,170,90,0.45)');
  sunG.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = sunG;
  ctx.fillRect(sunX - 100, sunY - 100, 200, 200);
  ctx.fillStyle = night ? '#e8e2c8' : '#ffd98c';
  ctx.beginPath();
  ctx.arc(sunX, sunY, night ? 22 : 34, 0, Math.PI * 2);
  ctx.fill();

  // Bintang (posisi sudah di-seed di state.stars).
  if (night && state.stars) {
    for (const s of state.stars) {
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = 'rgba(255,255,255,' + tw.toFixed(2) + ')';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
  }
}

function drawMountains(ctx, state) {
  // Dua lapis siluet gunung (parallax statis, beda warna).
  const layers = [
    { color: '#1d2f45', pts: [[0, 300], [140, 180], [260, 260], [420, 140], [560, 250], [700, 170], [860, 270], [1020, 150], [1160, 240], [1280, 190], [1280, 720], [0, 720]] },
    { color: '#16283a', pts: [[0, 360], [180, 250], [330, 330], [520, 230], [700, 330], [900, 240], [1080, 340], [1280, 260], [1280, 720], [0, 720]] },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.color;
    ctx.beginPath();
    ctx.moveTo(L.pts[0][0], L.pts[0][1]);
    for (let i = 1; i < L.pts.length; i++) ctx.lineTo(L.pts[i][0], L.pts[i][1]);
    ctx.closePath();
    ctx.fill();
    // Salju di puncak tertinggi.
    ctx.fillStyle = 'rgba(230,238,248,0.75)';
    ctx.beginPath();
    ctx.moveTo(420, 140); ctx.lineTo(452, 178); ctx.lineTo(436, 178);
    ctx.lineTo(420, 162); ctx.lineTo(404, 178); ctx.lineTo(388, 178);
    ctx.closePath(); ctx.fill();
  }
  // Tanah lembah.
  const g = ctx.createLinearGradient(0, 380, 0, 720);
  g.addColorStop(0, '#1e3a33');
  g.addColorStop(1, '#0f211d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 380, 1280, 340);
}

function drawGridBase(ctx, state) {
  const L = state.layout;
  ctx.fillStyle = 'rgba(8,20,24,0.55)';
  ctx.fillRect(L.gridX - 8, L.gridY - 8, L.cols * L.cell + 16, L.rows * L.cell + 16);
  for (let y = 0; y < L.rows; y++) {
    for (let x = 0; x < L.cols; x++) {
      const px = L.gridX + x * L.cell, py = L.gridY + y * L.cell;
      ctx.fillStyle = (x + y) % 2 === 0 ? 'rgba(38,74,66,0.5)' : 'rgba(30,60,55,0.5)';
      ctx.fillRect(px + 1, py + 1, L.cell - 2, L.cell - 2);
    }
  }
}

function drawPiece(ctx, state, x, y, cell, t) {
  const L = state.layout;
  const c = cellCenter(L, x, y);
  const piece = cell.piece;
  const flow = flowOf(state, x, y);
  const lit = flow > 0.05;
  let ports = [];
  try { ports = rotatedPorts(piece) || []; } catch (_e) { ports = piece.ports || []; }

  // Parit tanah di bawah saluran.
  ctx.strokeStyle = 'rgba(20,40,38,0.9)';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const d of ports) {
    const v = DIR_VEC[d];
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + v.x * L.cell * 0.5, c.y + v.y * L.cell * 0.5);
  }
  ctx.stroke();

  // Air di dalam saluran (denyut mengikuti flow).
  if (lit || piece.type === 'gate') {
    const pulse = 0.65 + 0.35 * Math.sin(t * 4 + x * 0.7 + y * 0.9);
    ctx.strokeStyle = 'rgba(64,200,255,' + (0.55 + 0.4 * pulse).toFixed(2) + ')';
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (const d of ports) {
      const v = DIR_VEC[d];
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + v.x * L.cell * 0.5, c.y + v.y * L.cell * 0.5);
    }
    ctx.stroke();
  }

  // Badan saluran: garis kayu/batu.
  ctx.strokeStyle = piece.type === 'gate' ? '#c9a35c' : '#8a6b45';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const d of ports) {
    const v = DIR_VEC[d];
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + v.x * L.cell * 0.46, c.y + v.y * L.cell * 0.46);
  }
  ctx.stroke();

  if (piece.type === 'gate') {
    // Pintu air: palang melintang, terbuka = terangkat.
    const open = piece.open !== false;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(open ? -0.5 : 0);
    ctx.fillStyle = open ? '#7ec8e3' : '#d8b25e';
    ctx.fillRect(-14, open ? -22 : -8, 28, open ? 10 : 16);
    ctx.strokeStyle = '#5a4020';
    ctx.lineWidth = 2;
    ctx.strokeRect(-14, open ? -22 : -8, 28, open ? 10 : 16);
    ctx.restore();
    // Indikator tekanan: merah menyala saat pressure tinggi & pintu tertutup.
    const p = cell.pressure || 0;
    if (!open && p > 0.6) {
      const blink = 0.5 + 0.5 * Math.sin(t * 10);
      ctx.fillStyle = 'rgba(255,60,40,' + (0.4 + 0.5 * blink).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(c.x, c.y - 20, 5 + 2 * blink, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (piece.type === 'splitter') {
    ctx.fillStyle = '#e8d27a';
    ctx.beginPath(); ctx.arc(c.x, c.y, 5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHouse(ctx, state, x, y, cell, t) {
  const L = state.layout;
  const c = cellCenter(L, x, y);
  const broken = cell.hp <= 0 || cell.broken;
  const flick = 0.75 + 0.25 * Math.sin(t * 3 + x * 1.3 + y);
  // Badan rumah.
  ctx.fillStyle = broken ? '#3a2f2a' : '#6b4a2f';
  ctx.fillRect(c.x - 18, c.y - 4, 36, 24);
  // Atap.
  ctx.fillStyle = broken ? '#2c2320' : '#a33d2e';
  ctx.beginPath();
  ctx.moveTo(c.x - 21, c.y - 4); ctx.lineTo(c.x, c.y - 20); ctx.lineTo(c.x + 21, c.y - 4);
  ctx.closePath(); ctx.fill();
  // Jendela lentera.
  if (!broken) {
    const glow = ctx.createRadialGradient(c.x, c.y + 6, 2, c.x, c.y + 6, 26);
    glow.addColorStop(0, 'rgba(255,190,90,' + (0.5 * flick).toFixed(2) + ')');
    glow.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(c.x - 26, c.y - 20, 52, 52);
    ctx.fillStyle = '#ffd98c';
    ctx.fillRect(c.x - 7, c.y + 2, 6, 8);
    ctx.fillRect(c.x + 2, c.y + 2, 6, 8);
  } else {
    ctx.fillStyle = '#14100e';
    ctx.fillRect(c.x - 7, c.y + 2, 6, 8);
    ctx.fillRect(c.x + 2, c.y + 2, 6, 8);
    // Puing miring.
    ctx.strokeStyle = '#554433';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c.x - 16, c.y - 18); ctx.lineTo(c.x - 6, c.y - 8);
    ctx.moveTo(c.x + 10, c.y - 16); ctx.lineTo(c.x + 18, c.y - 6);
    ctx.stroke();
  }
}

function drawMill(ctx, state, x, y, cell, t) {
  const L = state.layout;
  const c = cellCenter(L, x, y);
  const flow = flowOf(state, x, y);
  const spinning = flow > 0.05;
  const speed = spinning ? 1 + flow * 2 : 0;
  const ang = (state.clock || 0) * speed;
  // Dudukan.
  ctx.fillStyle = '#4a3a26';
  ctx.fillRect(c.x - 12, c.y + 6, 24, 16);
  // Roda kincir berputar.
  ctx.save();
  ctx.translate(c.x, c.y - 4);
  ctx.rotate(ang);
  ctx.strokeStyle = spinning ? '#d8b25e' : '#8a7a5a';
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
    ctx.stroke();
    ctx.fillStyle = spinning ? '#b98a3e' : '#6b5a3a';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 20, Math.sin(a) * 20, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#3a2c18';
  ctx.beginPath(); ctx.arc(c.x, c.y - 4, 4, 0, Math.PI * 2); ctx.fill();
  if (spinning) {
    ctx.fillStyle = 'rgba(120,220,255,0.8)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('+', c.x + 18, c.y - 14);
  }
}

function drawSpring(ctx, state, t) {
  const L = state.layout;
  // Mata air di puncak: dua sel sumber di baris atas.
  const springs = state.springs || [{ x: 5, y: 0 }];
  for (const s of springs) {
    const c = cellCenter(L, s.x, s.y);
    const pulse = 0.6 + 0.4 * Math.sin(t * 3 + s.x);
    const g = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, 44);
    g.addColorStop(0, 'rgba(120,230,255,' + (0.85 * pulse).toFixed(2) + ')');
    g.addColorStop(0.5, 'rgba(60,160,255,0.35)');
    g.addColorStop(1, 'rgba(60,160,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - 44, c.y - 44, 88, 88);
    ctx.fillStyle = '#9fe8ff';
    ctx.beginPath(); ctx.arc(c.x, c.y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8fbff';
    ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.fill();
  }
}

function drawForge(ctx, state, t) {
  const L = state.layout;
  const f = state.forgeCell || { x: 11, y: 8 };
  const c = cellCenter(L, f.x, f.y);
  const charge = Math.max(0, Math.min(100, state.forgeCharge || 0));
  const glowR = 30 + charge * 0.55 + 4 * Math.sin(t * 2);
  const g = ctx.createRadialGradient(c.x, c.y - 6, 6, c.x, c.y - 6, Math.max(30, glowR));
  g.addColorStop(0, 'rgba(255,170,60,' + (0.25 + charge / 130).toFixed(2) + ')');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x - glowR - 10, c.y - glowR - 20, (glowR + 10) * 2, (glowR + 20) * 2);
  // Bangunan tempaan.
  ctx.fillStyle = '#4a3428';
  ctx.fillRect(c.x - 24, c.y - 10, 48, 32);
  ctx.fillStyle = '#2e2019';
  ctx.beginPath();
  ctx.moveTo(c.x - 27, c.y - 10); ctx.lineTo(c.x, c.y - 30); ctx.lineTo(c.x + 27, c.y - 10);
  ctx.closePath(); ctx.fill();
  // Cerobong + asap.
  ctx.fillStyle = '#33261d';
  ctx.fillRect(c.x + 12, c.y - 34, 8, 24);
  ctx.fillStyle = 'rgba(200,200,200,0.35)';
  ctx.beginPath();
  ctx.arc(c.x + 16 + Math.sin(t * 1.5) * 4, c.y - 42 - (t % 3) * 4, 4, 0, Math.PI * 2);
  ctx.fill();
  // Api: nyala sebanding charge.
  const flameH = 4 + charge * 0.16;
  ctx.fillStyle = charge > 60 ? '#ffd23e' : '#ff8a2a';
  ctx.beginPath();
  ctx.moveTo(c.x - 10, c.y + 22);
  ctx.quadraticCurveTo(c.x - 6, c.y + 22 - flameH, c.x, c.y + 10 - flameH * 0.4);
  ctx.quadraticCurveTo(c.x + 6, c.y + 22 - flameH, c.x + 10, c.y + 22);
  ctx.closePath(); ctx.fill();
  // Landasan.
  ctx.fillStyle = '#5a5a62';
  ctx.fillRect(c.x - 14, c.y + 14, 28, 6);
  ctx.fillStyle = '#f5c86e';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FORGE ' + Math.floor(charge) + '%', c.x, c.y + 34);
}

function drawParticles(ctx, state) {
  // Partikel air / cipratan (posisi sudah di-update di main.js).
  for (const p of state.particles || []) {
    ctx.fillStyle = p.color || 'rgba(120,210,255,0.8)';
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life || 1));
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  // Angka melayang "+power".
  ctx.textAlign = 'center';
  for (const f of state.floaters || []) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life || 1));
    ctx.fillStyle = '#8fe8ff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawWeather(ctx, state, t) {
  const w = state.weather;
  if (w === 'rain' || w === 'storm') {
    ctx.strokeStyle = 'rgba(170,200,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of state.rain || []) {
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - 3, r.y + 12);
    }
    ctx.stroke();
  }
  if (w === 'storm' && state.lightning > 0) {
    ctx.fillStyle = 'rgba(220,230,255,' + (state.lightning * 0.5).toFixed(2) + ')';
    ctx.fillRect(0, 0, 1280, 720);
  }
}

function drawSelection(ctx, state, t) {
  const L = state.layout;
  const hov = state.hoverCell;
  if (hov && (state.phase === 'build' || state.phase === 'night')) {
    const px = L.gridX + hov.x * L.cell, py = L.gridY + hov.y * L.cell;
    ctx.strokeStyle = 'rgba(140,230,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, L.cell - 4, L.cell - 4);
  }
  const sel = state.selectedCell;
  if (sel) {
    const px = L.gridX + sel.x * L.cell, py = L.gridY + sel.y * L.cell;
    ctx.strokeStyle = '#f5c86e';
    ctx.lineWidth = 3;
    ctx.strokeRect(px + 3, py + 3, L.cell - 6, L.cell - 6);
  }
}

export function draw(ctx, state, t) {
  ctx.save();
  // Screen shake kecil saat rumah kena air (jitter deterministik dari sinus).
  if (state.shake > 0.2) {
    const s = state.shake;
    const dx = Math.sin(t * 61) * s * 0.9;
    const dy = Math.cos(t * 53) * s * 0.7;
    ctx.translate(dx, dy);
  }
  drawSky(ctx, state, t);
  drawMountains(ctx, state);
  drawGridBase(ctx, state);

  const L = state.layout;
  const grid = state.grid;
  if (grid) {
    for (let y = 0; y < L.rows; y++) {
      for (let x = 0; x < L.cols; x++) {
        const cell = cellAt(grid, x, y);
        if (!cell) continue;
        if (cell.house) drawHouse(ctx, state, x, y, cell, t);
        if (cell.debris) {
          const c = cellCenter(L, x, y);
          ctx.fillStyle = '#7a6a52';
          ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#4a3d2c';
          ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('X', c.x, c.y + 4);
        }
      }
    }
    for (let y = 0; y < L.rows; y++) {
      for (let x = 0; x < L.cols; x++) {
        const cell = cellAt(grid, x, y);
        if (!cell) continue;
        if (cell.piece) drawPiece(ctx, state, x, y, cell, t);
        if (cell.mill) drawMill(ctx, state, x, y, cell, t);
      }
    }
  }

  drawSpring(ctx, state, t);
  drawForge(ctx, state, t);
  drawParticles(ctx, state);
  drawWeather(ctx, state, t);
  drawSelection(ctx, state, t);
  ctx.restore();
}
