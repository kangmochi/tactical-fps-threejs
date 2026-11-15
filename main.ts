// Kestrel vs Cinder — a round-based tactical FPS built for the threejs-fps-02 entry.
// This file is the entry's build step. The game itself lives in ./game as plain static
// files: an index.html plus ES modules that pull three.js from an import map, all served
// as-is to the browser, no bundler and no dependencies beyond Node's standard library.
//
// Running it (Node 22.18 or later):
//   node main.ts
// It copies ./game into the output directory's game/ subfolder, collects ./screenshots
// (when present) into <out>/screenshots/, then asks the vendored make.fun library to
// score what landed there and writes the result as <out>/dossier.json.
// The output directory is /output inside the grader's container; anywhere else, point
// MAKEFUN_OUTPUT_DIR at a scratch folder first, e.g.:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// To play the game locally, serve this directory with `node serve.ts` and open
// http://localhost:8080 in a desktop browser with WebGL 2.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// Resolve paths relative to this file, not the caller's working directory.
const entryDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameSource = join(entryDir, 'game');
const screenshotsSource = join(entryDir, 'screenshots');

// The output tree: game/ is mandatory, screenshots/ is created up front and filled
// only when the entry ships its own shots.
mkdirSync(outputDir, { recursive: true });
cpSync(gameSource, join(outputDir, 'game'), { recursive: true });

const screenshotsTarget = join(outputDir, 'screenshots');
mkdirSync(screenshotsTarget, { recursive: true });
if (existsSync(screenshotsSource)) {
  cpSync(screenshotsSource, screenshotsTarget, { recursive: true });
}

// Limits mirroring the scorer's gate (reference/gate.json): text_max_bytes is the only
// cap that shapes byte content; the rest make the entry fail the same way the scorer
// would refuse it — over 4 screenshots or one above 256 KiB, or more than 993 files /
// 48 MiB total inside game/ (it counts against /output's own 1000-entry ceiling along
// with screenshots/ and dossier.json).
const gateCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, gateCaps));
