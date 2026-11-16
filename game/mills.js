// mills.js — 3 tipe kincir air.
// Kincir dipasang di sel kosong; air yang mengalir melewatinya diubah
// menjadi power, dan kincir tempa mengubah power menjadi forge charge.

export const MILL_TYPES = {
  wood: {
    id: 'wood', name: 'Kincir Kayu',
    cost: { timber: 2 }, powerPerFlow: 1,
    desc: '+1 power per unit flow',
  },
  stone: {
    id: 'stone', name: 'Kincir Batu',
    cost: { timber: 1, stone: 2 }, powerPerFlow: 2,
    desc: '+2 power per unit flow',
  },
  forge: {
    id: 'forge', name: 'Kincir Tempa',
    cost: { timber: 2, stone: 3 }, powerPerFlow: 2, forgeMultiplier: 2,
    needsForgeNeighbor: true,
    desc: 'Konversi power ke forge charge x2, harus di samping tempaan',
  },
};

// Hitung output kincir dari jumlah flow yang melewatinya.
// Mengembalikan {power, forgeCharge}. Kincir biasa: forgeCharge 0.
// Kincir tempa: power diubah jadi forge charge (power x forgeMultiplier).
export function millOutput(millType, flow) {
  const def = MILL_TYPES[millType];
  if (!def || flow <= 0) return { power: 0, forgeCharge: 0 };
  const power = def.powerPerFlow * flow;
  if (millType === 'forge') {
    return { power: 0, forgeCharge: power * (def.forgeMultiplier || 1) };
  }
  return { power, forgeCharge: 0 };
}

// Apakah kincir boleh dipasang di (x, y)?
// Syarat: sel kosong (tanpa saluran/kincir/rumah/mata air/tempaan/puing),
// dan kincir tempa harus bertetangga langsung dengan sel tempaan.
export function canPlaceMill(grid, x, y, type) {
  if (!grid || x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return false;
  const cell = grid.cells[y * grid.cols + x];
  if (!cell) return false;
  if (cell.piece || cell.mill || cell.house || cell.source || cell.forge) return false;
  if (cell.blocked || cell.debris) return false;
  if (type === 'forge') {
    // Cari sel tempaan di 4 tetangga.
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      if (grid.cells[ny * grid.cols + nx].forge) return true;
    }
    return false;
  }
  return !!MILL_TYPES[type];
}

// Harga pasang kincir (salinan).
export function millCost(type) {
  const def = MILL_TYPES[type];
  if (!def) return null;
  return { ...def.cost };
}
