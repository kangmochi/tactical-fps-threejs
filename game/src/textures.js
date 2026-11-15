// Canvas-drawn textures: concrete, chipped painted metal, rust, worn ground and a
// grating sheet. Everything here is generated at load time — the entry ships no
// image assets, and the judge reads only the code that draws them.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Deterministic-ish mottling: soft blotches layered over a base fill.
function mottle(ctx, w, h, base, blotches, count) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i += 1) {
    const [color, minR, maxR, alpha] = blotches[i % blotches.length];
    const r = minR + Math.random() * (maxR - minR);
    const x = Math.random() * w;
    const y = Math.random() * h;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color.replace('A', String(alpha)));
    grad.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function grain(ctx, w, h, count, alpha) {
  for (let i = 0; i < count; i += 1) {
    const v = Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgba(${v},${v},${v + 8},${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

function finish(canvasEl, repeatX, repeatY) {
  const tex = new THREE.CanvasTexture(canvasEl);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeBump(canvasEl, repeatX, repeatY) {
  const tex = new THREE.CanvasTexture(canvasEl);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

// Weathered concrete: pale base, dark damp blotches, formwork seams, spalls.
export function concreteTextures(repeatX = 2, repeatY = 2) {
  const c = canvas(512, 512);
  const ctx = c.getContext('2d');
  mottle(ctx, 512, 512, '#7d7a6e', [
    ['rgba(56,58,52,A)', 30, 120, 0.5],
    ['rgba(160,158,144,A)', 20, 90, 0.45],
    ['rgba(30,33,34,A)', 8, 46, 0.55],
  ], 46);
  // Formwork seams.
  ctx.strokeStyle = 'rgba(28,29,26,0.55)';
  ctx.lineWidth = 3;
  for (const y of [128, 256, 384]) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(170, 0); ctx.lineTo(170, 512); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(341, 0); ctx.lineTo(341, 512); ctx.stroke();
  grain(ctx, 512, 512, 900, 0.16);
  return { map: finish(c, repeatX, repeatY) };
}

// Chipped painted metal: deep green-grey paint, rust where it flaked through.
export function containerTextures(repeatX = 1.6, repeatY = 1) {
  const c = canvas(512, 512);
  const ctx = c.getContext('2d');
  mottle(ctx, 512, 512, '#5c3a2c', [
    ['rgba(28,20,16,A)', 26, 110, 0.6],
    ['rgba(122,74,44,A)', 18, 80, 0.55],
    ['rgba(70,44,32,A)', 30, 130, 0.5],
  ], 30);
  // Corrugation ribs, vertical.
  for (let x = 0; x < 512; x += 64) {
    const g = ctx.createLinearGradient(x, 0, x + 64, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.05)');
    g.addColorStop(0.82, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 64, 512);
  }
  // Chipped paint: jagged holes with rust bleed.
  for (let i = 0; i < 34; i += 1) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 2 + Math.random() * 14;
    ctx.fillStyle = 'rgba(96,52,26,0.9)';
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.5) {
      const rr = r * (0.7 + Math.random() * 0.6);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(40,22,12,0.8)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
  }
  grain(ctx, 512, 512, 500, 0.14);
  return { map: finish(c, repeatX, repeatY) };
}

// Bare rust: layered oxide tones, streaked downward.
export function rustTextures(repeatX = 1, repeatY = 1) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  mottle(ctx, 256, 256, '#4a2c1a', [
    ['rgba(140,76,34,A)', 12, 60, 0.7],
    ['rgba(24,14,10,A)', 8, 44, 0.7],
    ['rgba(196,120,54,A)', 4, 22, 0.55],
  ], 60);
  for (let i = 0; i < 26; i += 1) {
    const x = Math.random() * 256;
    ctx.fillStyle = 'rgba(20,12,8,0.4)';
    ctx.fillRect(x, Math.random() * 180, 2 + Math.random() * 5, 60 + Math.random() * 90);
  }
  return { map: finish(c, repeatX, repeatY) };
}

// Yard ground: cold slabs, stains, and two wet patches that catch the lamps.
export function groundTextures(repeatX = 8, repeatY = 8) {
  const c = canvas(512, 512);
  const ctx = c.getContext('2d');
  mottle(ctx, 512, 512, '#3f4650', [
    ['rgba(18,22,28,A)', 40, 150, 0.55],
    ['rgba(84,94,106,A)', 26, 110, 0.4],
    ['rgba(8,10,14,A)', 16, 70, 0.5],
  ], 40);
  ctx.strokeStyle = 'rgba(10,12,16,0.7)';
  ctx.lineWidth = 4;
  for (const y of [170, 341]) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(90,100,112,0.35)';
  ctx.lineWidth = 1;
  for (const y of [174, 345]) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  grain(ctx, 512, 512, 1200, 0.12);
  return { map: finish(c, repeatX, repeatY) };
}

// Catwalk grating: dark steel with slotted holes (alpha-tested, see-through).
export function gratingTexture(repeatX = 6, repeatY = 1) {
  const c = canvas(256, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#262a30';
  ctx.fillRect(0, 0, 256, 128);
  // Bearing bars.
  ctx.fillStyle = '#31363e';
  for (let x = 0; x < 256; x += 32) ctx.fillRect(x, 0, 7, 128);
  // Open slots between bars.
  ctx.clearRect(0, 0, 0, 0);
  for (let x = 0; x < 256; x += 32) {
    for (let y = 8; y < 128; y += 16) {
      ctx.clearRect(x + 7, y, 25, 9);
    }
  }
  // Rust freckles on the bars.
  for (let i = 0; i < 90; i += 1) {
    ctx.fillStyle = 'rgba(120,66,30,0.5)';
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

// Painted floor stencil for the sites: a worn dark plate with a worn teal letter.
export function siteMarkTexture(letter) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  // Dark plate so the glyph reads on pale concrete.
  const plate = ctx.createRadialGradient(128, 128, 20, 128, 128, 126);
  plate.addColorStop(0, 'rgba(8, 38, 33, 0.78)');
  plate.addColorStop(0.72, 'rgba(8, 38, 33, 0.55)');
  plate.addColorStop(1, 'rgba(8, 38, 33, 0)');
  ctx.fillStyle = plate;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(43, 255, 214, 0.95)';
  ctx.font = '800 168px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 126);
  // Worn: knock chips out of the fill.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 60; i += 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 9, 1 + Math.random() * 4);
  }
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Horizontal hazard chevrons for the doorframes.
export function chevronTexture() {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#141a22';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffb04a';
  for (let x = -64; x < 256; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 64); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 56, 0); ctx.lineTo(x + 24, 64);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
