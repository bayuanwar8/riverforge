// waves.js — profil gelombang banjir tiap malam + event acak (seeded).
// Malam makin larut: volume & kecepatan surge naik ~25% per malam.
// Malam 7 = "The Great Melt": 3 surge besar + badai.

import { pick, randRange } from './rng.js';

export const WEATHER_DESC = {
  clear: 'Clear',
  rain: 'Rain — flow +50%',
  drought: 'Drought — spring at half flow',
  storm: 'Storm — lightning damages channels',
};

// Profil satu malam: daftar surge + cuaca + event.
// night: 1..7. rng: fungsi mulberry32 (seeded per malam).
// Mengembalikan {surges: [{delaySec, volume, speed}], weather, event}.
export function nightProfile(night, rng) {
  const n = Math.max(1, Math.min(7, night || 1));
  // Skala kesulitan: +25% per malam dari malam 1.
  const scale = 1 + (n - 1) * 0.25;

  // Jumlah surge: malam 1 cuma 1, lalu bertambah (maks 3).
  const surgeCount = n >= 7 ? 3 : n >= 4 ? 2 : 1;
  const surges = [];
  for (let i = 0; i < surgeCount; i++) {
    surges.push({
      // Surge pertama datang setelah jeda; berikutnya berjarak ~20-30 dtk.
      delaySec: 8 + i * randRange(rng, 20, 30),
      volume: Math.round((1.0 + i * 0.5) * scale * 10) / 10,
      speed: Math.round((1.0 + i * 0.2) * scale * 10) / 10,
    });
  }

  // Cuaca per malam (seeded, bervariasi).
  let weather = 'clear';
  const roll = rng();
  if (n === 7) {
    weather = 'storm'; // The Great Melt selalu badai
  } else if (roll < 0.25) {
    weather = 'rain';
  } else if (roll < 0.45) {
    weather = 'drought';
  }

  // Event acak per malam (seeded). Malam 1 tanpa event (pengenalan).
  let event = null;
  if (n >= 2) {
    const eventRoll = rng();
    if (eventRoll < 0.3) {
      const type = pick(rng, ['beaver', 'debris', 'storm']);
      if (type === 'beaver') {
        event = {
          type: 'beaver',
          desc: 'A cheeky beaver builds a dam in your channel!',
        };
      } else if (type === 'debris') {
        event = {
          type: 'debris',
          desc: 'Drifting debris blocks a channel!',
        };
      } else {
        event = {
          type: 'storm',
          desc: 'Lightning strikes and destroys a channel!',
        };
      }
    }
  }

  // Badai (cuaca storm) selalu membawa petir sebagai event.
  if (weather === 'storm' && !event) {
    event = { type: 'storm', desc: 'Lightning strikes and destroys a channel!' };
  }

  return { surges, weather, event };
}

// Terapkan event ke grid. Dipanggil sekali saat malam dimulai (atau saat
// event terpicu). Mengembalikan deskripsi apa yang terjadi, atau null.
// x, y opsional: kalau diisi, event menimpa sel itu (dipakai mode ?shot).
export function applyEvent(grid, event, rng) {
  if (!event) return null;
  // Cari sel berisi saluran yang bisa jadi korban.
  const candidates = [];
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const cell = grid.cells[y * grid.cols + x];
      if (cell.piece && !cell.blocked) candidates.push({ x, y, cell });
    }
  }
  if (candidates.length === 0) return null;

  let target = null;
  if (event.x !== undefined && event.y !== undefined) {
    const cell = grid.cells[event.y * grid.cols + event.x];
    if (cell && cell.piece) target = { x: event.x, y: event.y, cell };
  }
  if (!target) target = pick(rng, candidates);
  if (!target) return null;

  if (event.type === 'storm') {
    // Petir: saluran hancur jadi puing, sel terblokir.
    target.cell.piece = null;
    target.cell.broken = true;
    target.cell.debris = true;
    target.cell.blocked = true;
    return { ...event, x: target.x, y: target.y, applied: 'destroyed' };
  }
  if (event.type === 'beaver') {
    // Berang-berang: dam memblokir saluran (saluran tetap, tapi tertutup).
    target.cell.blocked = true;
    target.cell.debris = true;
    return { ...event, x: target.x, y: target.y, applied: 'blocked' };
  }
  if (event.type === 'debris') {
    // Puing hanyut: menyumbat saluran (saluran tetap, tapi tertutup).
    target.cell.blocked = true;
    target.cell.debris = true;
    return { ...event, x: target.x, y: target.y, applied: 'blocked' };
  }
  return null;
}

// Nama dramatis tiap malam (untuk HUD).
export function nightName(night) {
  if (night === 7) return 'The Great Melt';
  if (night === 1) return 'The First Night';
  return `Night ${night}`;
}
