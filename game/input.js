// input.js — hanya hit-test mouse + mapping keyboard ke actions.
// Tidak ada logika game di sini; semua aksi diimplementasikan di main.js.

import { PIECES } from './pieces.js';
import { cellAt } from './grid.js';

// Urutan tombol 1-5 untuk memilih saluran (sesuai urutan PIECES).
const PIECE_KEYS = ['straight', 'bend', 'tee', 'gate', 'splitter'];

function canvasPos(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return { x: (evt.clientX - rect.left) * sx, y: (evt.clientY - rect.top) * sy };
}

function cellFromPos(state, px, py) {
  const L = state.layout;
  if (!L) return null;
  const gx = Math.floor((px - L.gridX) / L.cell);
  const gy = Math.floor((py - L.gridY) / L.cell);
  if (gx < 0 || gy < 0 || gx >= L.cols || gy >= L.rows) return null;
  return { x: gx, y: gy };
}

function buttonAt(state, px, py) {
  const btns = state.buttons || [];
  for (let i = btns.length - 1; i >= 0; i--) {
    const b = btns[i];
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
  }
  return null;
}

// Dispatch id tombol UI ke actions. Id "buy:<upgradeId>" dan "mill:<type>".
function dispatchButton(state, actions, btn) {
  const id = btn.id || '';
  if (id === 'disabled') return; // tombol nonaktif: telan klik, jangan tembus.
  if (id === 'start') return actions.startGame();
  if (id === 'howto') { state.showHowTo = !state.showHowTo; return; }
  if (id === 'night') return actions.startNight();
  if (id === 'shop') return actions.openShop();
  if (id === 'again' || id === 'retry') return actions.restart();
  if (id === 'title') return actions.toTitle();
  if (id === 'mute') return actions.toggleMute();
  if (id === 'pause') return actions.togglePause();
  if (id === 'close-shop') { state.showShop = false; return; }
  if (id === 'close-howto') { state.showHowTo = false; return; }
  if (id.startsWith('buy:')) return actions.buyUpgrade(id.slice(4));
  if (id.startsWith('mill:')) {
    state.selectedMill = id.slice(5);
    state.selectedPiece = null;
    state.selectedPlaced = null; // pilih kincir: lepas pilihan piece lama
    return;
  }
  if (id.startsWith('piece:')) {
    state.selectedPiece = id.slice(6);
    state.selectedMill = null;
    state.selectedPlaced = null; // pilih saluran: R kembali mengatur NEXT
    return;
  }
}

export function bindInput(canvas, state, actions) {
  canvas.addEventListener('click', (evt) => {
    try {
      const p = canvasPos(canvas, evt);
      const btn = buttonAt(state, p.x, p.y);
      if (btn) { dispatchButton(state, actions, btn); return; }
      // Overlay toko / How to play terbuka: klik di luar tombol ditelan.
      if (state.showShop || state.showHowTo) return;
      // Klik di luar tombol: hanya aktif saat fase build/night.
      if (state.phase !== 'build' && state.phase !== 'night') return;
      const cell = cellFromPos(state, p.x, p.y);
      if (!cell) return;
      state.selectedCell = cell;
      const c = state.grid ? cellAt(state.grid, cell.x, cell.y) : null;
      if (c && c.debris) {
        // Malam: klik sel rusak = perbaikan darurat (placePiece menangani
        // rebuild / clear). Siang: bersihkan puing seperti biasa.
        if (state.phase === 'night') { actions.placePiece(cell.x, cell.y); return; }
        actions.clearDebris(cell.x, cell.y);
        return;
      }
      if (c && c.piece && c.piece.type === 'gate') { actions.selectGate(cell.x, cell.y); return; }
      // (C) Klik piece terpasang (bukan gate) saat build = PILIH piece itu:
      // R memutarnya, X/Delete menghapusnya. Klik sel kosong / memasang
      // piece baru melepas pilihan ini.
      if (state.phase === 'build' && c && c.piece) {
        state.selectedPlaced = { x: cell.x, y: cell.y };
        return;
      }
      if (state.phase === 'build') state.selectedPlaced = null;
      if (state.selectedMill) {
        if (actions.placeMill) actions.placeMill(cell.x, cell.y, state.selectedMill);
        return;
      }
      if (state.phase === 'build' && state.selectedPiece) {
        actions.placePiece(cell.x, cell.y);
      }
    } catch (_e) { /* klik gagal: abaikan */ }
  });

  canvas.addEventListener('mousemove', (evt) => {
    try {
      const p = canvasPos(canvas, evt);
      state.hoverCell = cellFromPos(state, p.x, p.y);
      state.hoverButton = buttonAt(state, p.x, p.y);
    } catch (_e) { /* abaikan */ }
  });

  window.addEventListener('keydown', (evt) => {
    try {
      const k = evt.key;
      if (k >= '1' && k <= '5') {
        const id = PIECE_KEYS[Number(k) - 1];
        if (id && PIECES[id]) {
          state.selectedPiece = id;
          state.selectedMill = null;
          state.selectedPlaced = null; // pilih saluran: R kembali mengatur NEXT
        }
        return;
      }
      if (k === 'g' || k === 'G') {
        if (state.selectedCell) actions.selectGate(state.selectedCell.x, state.selectedCell.y);
        return;
      }
      if (k === 'r' || k === 'R') {
        // (C) Kalau ada piece terpasang yang dipilih, R memutar PIECE ITU.
        // Kalau tidak ada yang dipilih, R tetap mengatur orientasi
        // penempatan BERIKUTNYA (perilaku Builder B — jangan dipecah).
        if (state.phase === 'build' && state.selectedPlaced && actions.rotatePiece) {
          actions.rotatePiece(state.selectedPlaced.x, state.selectedPlaced.y);
          return;
        }
        state.rot = ((state.rot || 0) + 1) % 4;
        return;
      }
      if (k === 'x' || k === 'X' || k === 'Delete') {
        // (C) Hapus piece terpasang yang dipilih (tanpa refund).
        if (state.phase === 'build' && state.selectedPlaced && actions.removePiece) {
          actions.removePiece(state.selectedPlaced.x, state.selectedPlaced.y);
        }
        return;
      }
      if (k === ' ') { evt.preventDefault(); actions.togglePause(); return; }
      if (k === 'Escape') { actions.toTitle(); return; }
      if (k === 'm' || k === 'M') { actions.toggleMute(); return; }
      if (k === 'Enter') {
        if (state.phase === 'title') actions.startGame();
        else if (state.phase === 'win' || state.phase === 'loss') actions.restart();
        return;
      }
    } catch (_e) { /* abaikan */ }
  });
}
