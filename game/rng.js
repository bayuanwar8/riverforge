// rng.js — RNG seeded deterministik (mulberry32).
// Semua keacakan game HARUS lewat modul ini. Jangan pakai Math.random()
// di file simulasi lain — supaya replay/seed menghasilkan hasil yang sama.

// mulberry32: generator angka acak seeded, cepat dan deterministik.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Angka float acak di [min, max).
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

// Ambil satu elemen acak dari array (tidak mengubah array).
export function pick(rng, arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

// Angka integer acak di [min, max] (inklusif).
export function randInt(rng, min, max) {
  return Math.floor(randRange(rng, min, max + 1));
}

// Acak urutan array (Fisher-Yates), kembalikan array BARU.
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}
