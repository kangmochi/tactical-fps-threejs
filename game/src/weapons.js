// The arsenal and the gunplay. WEAPONS holds the numbers; createArsenal owns the
// pooled visual effects (tracers, sparks, grenades) and the shared hitscan so the
// player and the bots shoot exactly the same way. No allocations in per-frame paths:
// effects come from fixed pools, hitscan writes into a reused result object.
import * as THREE from 'three';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9', kind: 'Pistol', auto: false,
    damage: 30, headMult: 2.6, interval: 0.135, mag: 12, reserve: 36, reload: 1.9,
    spreadStand: 0.5, spreadCrouch: 0.25, spreadMove: 0.62, heatSpread: 1.35,
    recoilPitch: 0.016, recoilYaw: 0.008, heat: 0.14,
    falloffNear: 25, falloffFar: 60, price: 200,
  },
  k9: {
    id: 'k9', name: 'K9', kind: 'SMG', auto: true,
    damage: 21, headMult: 2.6, interval: 0.05, mag: 25, reserve: 100, reload: 2.15,
    spreadStand: 1.15, spreadCrouch: 0.6, spreadMove: 0.88, heatSpread: 1.5,
    recoilPitch: 0.013, recoilYaw: 0.011, heat: 0.15,
    falloffNear: 15, falloffFar: 45, price: 1250,
  },
  vk7: {
    id: 'vk7', name: 'VK-7', kind: 'Rifle', auto: true, burst: 3, burstPause: 0.36,
    damage: 40, headMult: 2.6, interval: 0.075, mag: 30, reserve: 90, reload: 2.5,
    spreadStand: 0.7, spreadCrouch: 0.3, spreadMove: 0.74, heatSpread: 1.15,
    recoilPitch: 0.03, recoilYaw: 0.013, heat: 0.24,
    falloffNear: 32, falloffFar: 75, price: 4200,
  },
  knife: {
    id: 'knife', name: 'Knife', kind: 'Melee', auto: false,
    damage: 55, headMult: 1, interval: 0.42, range: 2.3, price: 0,
  },
  he: {
    id: 'he', name: 'HE Grenade', kind: 'Grenade', auto: false,
    fuse: 3.2, maxDamage: 300, radius: 8.5, price: 300,
  },
};

// Damage multiplier for range: full inside falloffNear, linear down to 0.55 at falloffFar.
export function rangeFalloff(weapon, dist) {
  if (dist <= weapon.falloffNear) return 1;
  if (dist >= weapon.falloffFar) return 0.55;
  const t = (dist - weapon.falloffNear) / (weapon.falloffFar - weapon.falloffNear);
  return 1 - 0.45 * t;
}

const PART_TORSO = 0, PART_HEAD = 1, PART_LEGS = 2;
// Damage multiplier per body region.
const PART_MULT = [1, 2.6, 0.75];

export function createArsenal(scene, world) {
  // --- Tracers: thin stretched boxes that fade fast (60 ms). ---
  const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < 28; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0, maxLife: 0.06 });
  }
  let tracerIdx = 0;

  // --- Dust puffs: soft grey sprites that expand and thin out (impacts on world). ---
  const puffTex = makePuffTexture();
  const dusts = [];
  for (let i = 0; i < 24; i += 1) {
    const mat = new THREE.SpriteMaterial({ map: puffTex, color: 0xa9a294, transparent: true, opacity: 0.85, depthWrite: false });
    const mesh = new THREE.Sprite(mat);
    mesh.visible = false;
    scene.add(mesh);
    dusts.push({ mesh, life: 0, maxLife: 0.7 });
  }
  let dustIdx = 0;

  // --- Blood puffs: darker, quicker, on body hits. ---
  const bloods = [];
  for (let i = 0; i < 16; i += 1) {
    const mat = new THREE.SpriteMaterial({ map: puffTex, color: 0x6e1410, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Sprite(mat);
    mesh.visible = false;
    scene.add(mesh);
    bloods.push({ mesh, life: 0, maxLife: 0.5 });
  }
  let bloodIdx = 0;

  // --- Shell casings: eject right, bounce once, fade out. ---
  const casingGeo = new THREE.BoxGeometry(0.02, 0.011, 0.011);
  const casingMat = new THREE.MeshStandardMaterial({ color: 0xb8893a, roughness: 0.35, metalness: 0.9 });
  const casings = [];
  for (let i = 0; i < 24; i += 1) {
    const mesh = new THREE.Mesh(casingGeo, casingMat);
    mesh.visible = false;
    scene.add(mesh);
    casings.push({ mesh, life: 0, maxLife: 2.4, vy: 0, vx: 0, vz: 0, bounced: false });
  }
  let casingIdx = 0;

  // --- Sparks: additive sprites that flash and expand (always camera-facing). ---
  const sparkTex = makeSparkTexture();
  const sparks = [];
  for (let i = 0; i < 40; i += 1) {
    const mat = new THREE.SpriteMaterial({ map: sparkTex, color: 0xffc46b, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Sprite(mat);
    mesh.visible = false;
    mesh.scale.setScalar(0.22);
    scene.add(mesh);
    sparks.push({ mesh, life: 0, maxLife: 0.28 });
  }
  let sparkIdx = 0;

  // --- Explosions: expanding sphere + point light, pooled. ---
  const boomGeo = new THREE.SphereGeometry(1, 12, 10);
  const boomMat = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const booms = [];
  for (let i = 0; i < 3; i += 1) {
    const mesh = new THREE.Mesh(boomGeo, boomMat.clone());
    mesh.visible = false;
    const light = new THREE.PointLight(0xffa03c, 0, 14, 1.6);
    scene.add(mesh, light);
    booms.push({ mesh, light, life: 0, maxLife: 0.55 });
  }
  let boomIdx = 0;

  // --- Grenades in flight. ---
  const grenadeGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2f4432, roughness: 0.5, metalness: 0.4 });
  const grenades = [];
  for (let i = 0; i < 3; i += 1) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, vx: 0, vy: 0, vz: 0, fuse: 0, owner: null });
  }

  const _hit = { kind: 'none', dist: -1, target: null, part: -1, x: 0, y: 0, z: 0 };
  let _noiseCb = null; // set by rounds: fn(x, z, type)
  let _explodeCb = null; // set by rounds: fn(x, y, z, owner)

  function spawnTracer(fromX, fromY, fromZ, toX, toY, toZ, color) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    const dx = toX - fromX, dy = toY - fromY, dz = toZ - fromZ;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.1) return;
    t.mesh.visible = true;
    t.mesh.position.set(fromX + dx / 2, fromY + dy / 2, fromZ + dz / 2);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(toX, toY, toZ);
    t.mesh.material.opacity = 0.95;
    t.mesh.material.color.setHex(color || 0xffd27a);
    t.life = t.maxLife = 0.06;
  }

  function spawnDust(x, y, z, big) {
    const d = dusts[dustIdx];
    dustIdx = (dustIdx + 1) % dusts.length;
    d.mesh.visible = true;
    d.mesh.position.set(x, y, z);
    d.mesh.scale.setScalar(big ? 0.8 : 0.45);
    d.mesh.material.opacity = 0.85;
    d.life = d.maxLife = big ? 0.9 : 0.6;
  }

  function spawnBlood(x, y, z) {
    const b = bloods[bloodIdx];
    bloodIdx = (bloodIdx + 1) % bloods.length;
    b.mesh.visible = true;
    b.mesh.position.set(x, y, z);
    b.mesh.scale.setScalar(0.34);
    b.mesh.material.opacity = 0.9;
    b.life = b.maxLife = 0.45;
  }

  // Eject a casing to the shooter's right. vx/vz passed in world space.
  function spawnCasing(x, y, z, vx, vy, vz) {
    const s = casings[casingIdx];
    casingIdx = (casingIdx + 1) % casings.length;
    s.mesh.visible = true;
    s.mesh.position.set(x, y, z);
    s.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    s.mesh.scale.setScalar(1);
    s.vx = vx; s.vy = vy; s.vz = vz;
    s.bounced = false;
    s.life = s.maxLife;
  }

  function spawnSpark(x, y, z, big) {
    const s = sparks[sparkIdx];
    sparkIdx = (sparkIdx + 1) % sparks.length;
    s.mesh.visible = true;
    s.mesh.position.set(x, y, z);
    s.mesh.scale.setScalar(big ? 1.6 : 1);
    s.mesh.material.opacity = 1;
    s.life = s.maxLife = big ? 0.4 : 0.24;
  }

  function spawnBoom(x, y, z) {
    const b = booms[boomIdx];
    boomIdx = (boomIdx + 1) % booms.length;
    b.mesh.visible = true;
    b.mesh.position.set(x, Math.max(0.6, y), z);
    b.mesh.scale.setScalar(0.4);
    b.mesh.material.opacity = 0.95;
    b.light.position.set(x, Math.max(0.8, y) + 0.5, z);
    b.light.intensity = 260;
    b.life = b.maxLife = 0.55;
  }

  // Segment a->b vs one body made of three AABBs. Writes into _hit. Returns nearest part hit distance or -1.
  function _rayVsBody(ox, oy, oz, dx, dy, dz, maxDist, target) {
    const h = target.height;
    const r = target.radius || 0.32;
    const px = target.pos.x, py = target.pos.y, pz = target.pos.z;
    // Head: top 0.34 m region; torso: middle; legs: bottom.
    const regions = [
      { y0: py + h * 0.52, y1: py + h * 0.86, part: PART_TORSO, inflate: 0.06 },
      { y0: py + h * 0.86, y1: py + h + 0.02, part: PART_HEAD, inflate: 0.09 },
      { y0: py, y1: py + h * 0.52, part: PART_LEGS, inflate: 0.05 },
    ];
    let best = null;
    for (const reg of regions) {
      const rr = r + reg.inflate;
      const t = rayAABB(ox, oy, oz, dx, dy, dz, px - rr, reg.y0, pz - rr, px + rr, reg.y1, pz + rr);
      if (t >= 0 && t <= maxDist && (!best || t < best.dist)) best = { dist: t, part: reg.part };
    }
    return best;
  }

  // Shared hitscan. targets: array of damageable entities. Writes into and returns _hit.
  function hitscan(ox, oy, oz, dx, dy, dz, maxDist, targets) {
    _hit.kind = 'none';
    _hit.dist = -1;
    _hit.target = null;
    _hit.part = -1;
    const wall = world.rayTest(ox, oy, oz, dx, dy, dz, maxDist);
    let limit = wall >= 0 ? wall : maxDist;
    let bestBody = null;
    for (const target of targets) {
      if (!target.alive) continue;
      const hit = _rayVsBody(ox, oy, oz, dx, dy, dz, limit, target);
      if (hit && (!bestBody || hit.dist < bestBody.dist)) bestBody = { target, dist: hit.dist, part: hit.part };
    }
    if (bestBody) {
      _hit.kind = 'body';
      _hit.dist = bestBody.dist;
      _hit.target = bestBody.target;
      _hit.part = bestBody.part;
    } else if (wall >= 0) {
      _hit.kind = 'world';
      _hit.dist = wall;
    }
    _hit.x = ox + dx * (_hit.dist >= 0 ? _hit.dist : maxDist);
    _hit.y = oy + dy * (_hit.dist >= 0 ? _hit.dist : maxDist);
    _hit.z = oz + dz * (_hit.dist >= 0 ? _hit.dist : maxDist);
    return _hit;
  }

  function partDamage(weapon, part) {
    if (part === PART_HEAD) return weapon.damage * weapon.headMult;
    if (part === PART_LEGS) return weapon.damage * 0.75;
    return weapon.damage;
  }

  function throwGrenade(x, y, z, vx, vy, vz, owner) {
    for (const g of grenades) {
      if (g.active) continue;
      g.active = true;
      g.mesh.visible = true;
      g.mesh.position.set(x, y, z);
      g.vx = vx; g.vy = vy; g.vz = vz;
      g.fuse = WEAPONS.he.fuse;
      g.owner = owner;
      return true;
    }
    return false;
  }

  function explode(g) {
    const p = g.mesh.position;
    spawnBoom(p.x, p.y, p.z);
    if (_noiseCb) _noiseCb(p.x, p.z, 'grenade');
    if (_explodeCb) _explodeCb(p.x, p.y, p.z, g.owner);
  }

  // Advance effects and grenades. Call once per simulation step.
  function update(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, (t.life / t.maxLife) * 0.95);
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const d of dusts) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const k = Math.max(0, d.life / d.maxLife);
      d.mesh.material.opacity = k * 0.85;
      d.mesh.scale.setScalar(d.mesh.scale.x + dt * 1.4);
      if (d.life <= 0) d.mesh.visible = false;
    }
    for (const b of bloods) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = Math.max(0, b.life / b.maxLife);
      b.mesh.material.opacity = k * 0.9;
      b.mesh.scale.setScalar(b.mesh.scale.x + dt * 0.9);
      if (b.life <= 0) b.mesh.visible = false;
    }
    for (const s of casings) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vy -= 12 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.rotation.x += dt * 9;
      s.mesh.rotation.z += dt * 7;
      if (s.mesh.position.y < 0.012 && s.vy < 0) {
        if (s.bounced) {
          s.mesh.position.y = 0.012;
          s.vy = 0;
          s.vx *= 0.4;
          s.vz *= 0.4;
        } else {
          s.mesh.position.y = 0.012;
          s.vy = -s.vy * 0.38;
          s.vx *= 0.55;
          s.vz *= 0.55;
          s.bounced = true;
        }
      }
      // Fade in the last 0.8 s of life.
      const fade = Math.min(1, s.life / 0.8);
      s.mesh.scale.setScalar(fade);
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = Math.max(0, s.life / s.maxLife);
      s.mesh.material.opacity = k;
      s.mesh.scale.setScalar((1.6 - k) * (s.maxLife > 0.3 ? 0.5 : 0.3));
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (const b of booms) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = Math.max(0, b.life / b.maxLife);
      b.mesh.scale.setScalar(0.4 + (1 - k) * 3.6);
      b.mesh.material.opacity = k * 0.9;
      b.light.intensity = 260 * k * k;
      if (b.life <= 0) {
        b.mesh.visible = false;
        b.light.intensity = 0;
      }
    }
    for (const g of grenades) {
      if (!g.active) continue;
      g.vy -= 14.5 * dt;
      g.mesh.position.x += g.vx * dt;
      g.mesh.position.y += g.vy * dt;
      g.mesh.position.z += g.vz * dt;
      // Floor bounce with heavy damping.
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        if (g.vy < 0) g.vy = -g.vy * 0.42;
        g.vx *= 0.72;
        g.vz *= 0.72;
        if (_noiseCb && Math.abs(g.vy) > 1.2) _noiseCb(g.mesh.position.x, g.mesh.position.z, 'bounce');
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        explode(g);
      }
    }
  }

  return {
    hitscan,
    partDamage,
    spawnTracer,
    spawnSpark,
    spawnDust,
    spawnBlood,
    spawnCasing,
    spawnBoom,
    throwGrenade,
    update,
    setNoiseListener(fn) { _noiseCb = fn; },
    setExplodeListener(fn) { _explodeCb = fn; },
    noise(x, z, type) { if (_noiseCb) _noiseCb(x, z, type); },
    PART_HEAD,
    PART_TORSO,
    PART_LEGS,
  };
}

// Soft blotch sprite for dust and blood. No assets.
function makePuffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Radial spark texture drawn at runtime; no assets.
function makeSparkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,220,150,0.9)');
  grad.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Slab test vs an explicit AABB (bodies). No allocation.
function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return -1;
  } else {
    let t1 = (minX - ox) / dx;
    let t2 = (maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return -1;
  } else {
    let t1 = (minY - oy) / dy;
    let t2 = (maxY - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < minZ || oz > maxZ) return -1;
  } else {
    let t1 = (minZ - oz) / dz;
    let t2 = (maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
