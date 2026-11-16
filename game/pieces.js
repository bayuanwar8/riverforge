// pieces.js — definisi saluran (pipa) yang bisa dipasang pemain.
// Port arah: N/E/S/W relatif terhadap rotasi 0. rot = 0..3, tiap rotasi
// memutar 90 derajat searah jarum jam: N -> E -> S -> W -> N.

export const PIECES = {
  straight: {
    id: 'straight', name: 'Straight Channel', key: '1',
    cost: { timber: 1 }, ports: ['N', 'S'], rotatable: true,
    desc: 'Water runs straight from north to south.',
  },
  bend: {
    id: 'bend', name: 'Corner', key: '2',
    cost: { timber: 1 }, ports: ['N', 'E'], rotatable: true,
    desc: 'Turn the water 90 degrees.',
  },
  tee: {
    id: 'tee', name: 'T-Junction', key: '3',
    cost: { timber: 2 }, ports: ['N', 'E', 'S'], rotatable: true,
    desc: 'Split the water three ways.',
  },
  gate: {
    id: 'gate', name: 'Water Gate', key: '4',
    cost: { timber: 1, stone: 1 }, ports: ['N', 'S'], rotatable: true,
    isGate: true,
    desc: 'Open or close the flow. A closed gate holds back water and builds pressure!',
  },
  splitter: {
    id: 'splitter', name: 'Splitter', key: '5',
    cost: { stone: 2 }, ports: ['N', 'E', 'W'], rotatable: true,
    desc: 'Split the water left and right.',
  },
};

const ROT_MAP = { N: 'E', E: 'S', S: 'W', W: 'N' };

// Putar satu arah sebanyak rot langkah 90 derajat searah jarum jam.
export function rotateDir(dir, rot) {
  let d = dir;
  const n = ((rot % 4) + 4) % 4;
  for (let i = 0; i < n; i++) d = ROT_MAP[d];
  return d;
}

// Daftar arah port setelah rotasi piece dipasang.
// piece: {type, rot, open} — rot 0..3.
export function rotatedPorts(piece) {
  const def = PIECES[piece.type];
  if (!def) return [];
  return def.ports.map((p) => rotateDir(p, piece.rot || 0));
}

// Apakah piece (setelah rotasi) punya port ke arah dir?
export function connects(piece, dir) {
  if (!piece) return false;
  return rotatedPorts(piece).includes(dir);
}

// Apakah piece adalah pintu air?
export function isGate(piece) {
  if (!piece) return false;
  return !!PIECES[piece.type] && !!PIECES[piece.type].isGate;
}

// Apakah pintu air ini terbuka? (saluran biasa selalu "terbuka")
export function isOpen(piece) {
  if (!piece) return false;
  if (!isGate(piece)) return true;
  return piece.open !== false; // default terbuka
}

// Buat instance piece baru dari tipe + rotasi (open default true).
export function makePiece(type, rot = 0) {
  return { type, rot: ((rot % 4) + 4) % 4, open: true };
}

// Harga pasang piece (salinan, supaya tidak bisa diubah dari luar).
export function pieceCost(type) {
  const def = PIECES[type];
  if (!def) return null;
  return { ...def.cost };
}
