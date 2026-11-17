// main.ts — skrip build RIVERFORGE untuk make.fun (Node 22, stdlib saja).
// Tugasnya: salin folder game/ dan screenshots/ ke direktori output,
// lalu tulis dossier.json dari isi output tersebut.
// Dijalankan dari root repo, misal: node main.ts
// (butuh runtime yang bisa menjalankan TypeScript, misal via kit make.fun).

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Folder repo = folder tempat file ini berada.
const repoDir = fileURLToPath(new URL('.', import.meta.url));

// Tujuan output: pakai $MAKEFUN_OUTPUT_DIR kalau di-set, kalau tidak /output.
const out = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Siapkan direktori tujuan (rekursif, supaya tidak gagal kalau belum ada).
mkdirSync(out, { recursive: true });

// Salin game/ dan screenshots/ apa adanya (termasuk subfolder).
for (const name of ['game', 'screenshots']) {
  const src = join(repoDir, name);
  if (existsSync(src)) {
    cpSync(src, join(out, name), { recursive: true });
  }
}

// Susun dossier dari hasil salinan, lalu tulis sebagai dossier.json.
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
// buildDossier mengembalikan Uint8Array berupa canonical JSON bytes,
// jadi tulis langsung tanpa JSON.stringify (JSON.stringify pada Uint8Array
// malah menghasilkan {"0":123,"1":34,...} yang tidak bisa dibaca harness).
writeFileSync(join(out, 'dossier.json'), dossier);

console.log('RIVERFORGE build selesai -> ' + out);
