// grid.js — papan permainan 12x9 dan helper sel.
// Sel menyimpan kondisi saluran, kincir, rumah, puing, dan aliran air.

// Arah mata angin, searah jarum jam: N -> E -> S -> W -> N.
export const DIRS = ['N', 'E', 'S', 'W'];
export const DIR_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const OPPOSITE = { N: 'S', E: 'W', S: 'N', W: 'E' };

// Buat grid baru. Tiap sel:
//   piece: null | {type, rot, open}      — saluran yang terpasang
//   mill:  null | {type}                 — kincir di sel ini
//   house: bool                           — ada rumah di sel ini
//   hp:    number                         — HP rumah (0 kalau bukan rumah)
//   blocked: bool                         — terhalang puing/dam, air tak lewat
//   debris: bool                          — ada puing (bisa dibersihkan)
//   broken: bool                          — saluran jebol karena tekanan
//   flow: number                          — jumlah air di sel saat ini
//   pressure: number                      — tekanan air di sel ini
//   source: bool                          — mata air
//   forge: bool                           — sel tempaan
export function createGrid(cols, rows) {
  const cells = [];
  for (let i = 0; i < cols * rows; i++) {
    cells.push({
      piece: null,
      mill: null,
      house: false,
      hp: 0,
      blocked: false,
      debris: false,
      broken: false,
      flow: 0,
      pressure: 0,
      source: false,
      forge: false,
    });
  }
  return { cols, rows, cells };
}

// Ambil sel di (x, y); null kalau di luar papan.
export function cellAt(grid, x, y) {
  if (!inBounds(grid, x, y)) return null;
  return grid.cells[y * grid.cols + x];
}

// Cek koordinat masih di dalam papan.
export function inBounds(grid, x, y) {
  return x >= 0 && y >= 0 && x < grid.cols && y < grid.rows;
}

// Tetangga 4 arah: [{x, y, dir, cell}] — hanya yang masih di dalam papan.
export function neighbors4(grid, x, y) {
  const out = [];
  for (const dir of DIRS) {
    const [dx, dy] = DIR_VEC[dir];
    const nx = x + dx, ny = y + dy;
    if (!inBounds(grid, nx, ny)) continue;
    out.push({ x: nx, y: ny, dir, cell: cellAt(grid, nx, ny) });
  }
  return out;
}

// Indeks linear sel di array cells (untuk flowState / housesHit).
export function cellIndex(grid, x, y) {
  return y * grid.cols + x;
}

// Reset aliran & tekanan semua sel (dipanggil awal tiap malam).
export function resetFlow(grid) {
  for (const c of grid.cells) {
    c.flow = 0;
    c.pressure = 0;
  }
}
