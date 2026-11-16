// save.js — high score di localStorage (satu-satunya file yang
// menyentuh DOM/storage; simulasi lain murni).

const KEY = 'riverforge-highscore';

// Baca high score tersimpan; 0 kalau belum ada / storage tidak tersedia.
export function loadHighScore() {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw === null ? 0 : parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

// Simpan skor kalau lebih besar dari yang tersimpan.
// Mengembalikan {score, isNewBest}.
export function saveHighScore(score) {
  const prev = loadHighScore();
  const s = Math.max(0, Math.floor(score || 0));
  if (s > prev) {
    try {
      localStorage.setItem(KEY, String(s));
    } catch (e) {
      // Storage penuh / tidak tersedia: skor tetap dilaporkan.
    }
    return { score: s, isNewBest: true };
  }
  return { score: prev, isNewBest: false };
}
