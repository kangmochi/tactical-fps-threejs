// The map: Halden Yard, a cold freight yard built from axis-aligned boxes. Three lanes
// (west to B, mid, east to A), a mid catwalk you clear by crouching, two bomb sites.
// Every structural box is a collider and a surface a ray or a bullet stops on.
import * as THREE from 'three';

const CONCRETE = 0x6f6c62;
const CONCRETE_LIGHT = 0x83806f;
const DARK_METAL = 0x2e3540;
const CONTAINER = 0x6e4030;
const CRATE = 0x5d574c;
const CATWALK = 0x57544a;
const TEAL = 0x1fd3bd;
const RED = 0xff5a4e;

export const SPAWNS = {
  kestrel: [{ x: -3, z: 17.5 }, { x: 0, z: 18.2 }, { x: 3, z: 17.5 }, { x: -1.5, z: 15.8 }, { x: 1.5, z: 15.8 }],
  cinder: [{ x: -3, z: -17.5 }, { x: 0, z: -18.2 }, { x: 3, z: -17.5 }, { x: -1.5, z: -15.8 }, { x: 1.5, z: -15.8 }],
};
export const SITES = {
  A: { x: 23.5, z: -15, radius: 3.4 },
  B: { x: -23.5, z: -15, radius: 3.4 },
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const concrete = new THREE.MeshStandardMaterial({ color: CONCRETE, roughness: 0.95, metalness: 0.02 });
  const concreteLight = new THREE.MeshStandardMaterial({ color: CONCRETE_LIGHT, roughness: 0.9, metalness: 0.02 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: DARK_METAL, roughness: 0.55, metalness: 0.45 });
  const container = new THREE.MeshStandardMaterial({ color: CONTAINER, roughness: 0.62, metalness: 0.28 });
  const crate = new THREE.MeshStandardMaterial({ color: CRATE, roughness: 0.9, metalness: 0.02 });
  const catwalk = new THREE.MeshStandardMaterial({ color: CATWALK, roughness: 0.92, metalness: 0.05 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collidable = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collidable) {
      const unit = new THREE.Box3();
      unit.min.set(x - w / 2, y - h / 2, z - d / 2);
      unit.max.set(x + w / 2, y + h / 2, z + d / 2);
      colliders.push(unit);
      shootables.push(mesh);
    }
    return mesh;
  }

  // Perimeter. 58 x 42 m yard, walls 5.2 m; open sky, fog does the work.
  box(0.5, 5.2, 43, -29.25, 2.6, 0, concrete);
  box(0.5, 5.2, 43, 29.25, 2.6, 0, concrete);
  box(59, 5.2, 0.5, 0, 2.6, -21.25, concrete);
  box(59, 5.2, 0.5, 0, 2.6, 21.25, concrete);

  // Ground slab: pale worn concrete.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  group.add(floor);

  // West lane (towards site B): two long containers making the choke.
  box(3.1, 2.6, 8.2, -16.5, 1.3, 6, container);
  box(3.1, 2.6, 7.0, -21.5, 1.3, -3.5, container);
  box(1.6, 0.8, 1.6, -12.5, 0.4, 10.5, crate);
  box(1.6, 0.8, 1.6, -25.5, 0.4, 3.5, crate);

  // East lane (towards site A): mirrored containers.
  box(3.1, 2.6, 8.2, 16.5, 1.3, 6, container);
  box(3.1, 2.6, 7.0, 21.5, 1.3, -3.5, container);
  box(1.6, 0.8, 1.6, 12.5, 0.4, 10.5, crate);
  box(1.6, 0.8, 1.6, 25.5, 0.4, 3.5, crate);

  // Mid: two pillars breaking the sightline, a low fountain block behind them.
  box(1.5, 2.4, 1.5, -3.6, 1.2, -1.5, concreteLight);
  box(1.5, 2.4, 1.5, 3.6, 1.2, -1.5, concreteLight);
  box(2.2, 0.9, 2.2, 0, 0.45, -6.2, concrete);

  // Short walls forcing corners on the site connectors ("short A" / "short B").
  box(0.7, 4.2, 6.2, 9.8, 2.1, -8.4, concrete);
  box(0.7, 4.2, 6.2, -9.8, 2.1, -8.4, concrete);

  // Mid catwalk: a raised walkway across mid at z = 6, top at y = 1.6. Underneath
  // is a crawl gap (crouch height 1.12 m fits). Reached by jumping the west steps.
  box(12.0, 0.4, 2.2, 0, 1.4, 6, catwalk);
  box(0.8, 1.2, 0.8, -4.6, 0.6, 6, darkMetal);
  box(0.8, 1.2, 0.8, 4.6, 0.6, 6, darkMetal);
  box(1.7, 0.53, 2.1, -6.85, 0.265, 6, catwalk); // step 1 (top 0.53)
  box(1.7, 1.06, 2.1, -8.55, 0.53, 6, catwalk);  // step 2 (top 1.06)

  // Site A (north-east): a container wall, a crate stack, a back crate.
  box(3.2, 2.7, 7.6, 25.4, 1.35, -13.5, container);
  box(1.5, 1.5, 1.5, 19.2, 0.75, -14.8, crate);
  box(1.1, 1.1, 1.1, 19.2, 2.05, -14.8, crate);
  box(1.5, 1.5, 1.5, 27.0, 0.75, -18.6, crate);

  // Site B (north-west): mirrored.
  box(3.2, 2.7, 7.6, -25.4, 1.35, -13.5, container);
  box(1.5, 1.5, 1.5, -19.2, 0.75, -14.8, crate);
  box(1.1, 1.1, 1.1, -19.2, 2.05, -14.8, crate);
  box(1.5, 1.5, 1.5, -27.0, 0.75, -18.6, crate);

  // Bomb site markers on the ground (emissive paint, non-collidable).
  const siteMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.28, depthWrite: false });
  for (const site of [SITES.A, SITES.B]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.radius - 0.55, site.radius, 40), siteMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
  }

  // Team spawn paint: teal south (Kestrel), red north (Cinder).
  const spawnTeal = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.4, depthWrite: false });
  const spawnRed = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.4, depthWrite: false });
  const spawnPlane = new THREE.PlaneGeometry(9, 1.4);
  const kSpawn = new THREE.Mesh(spawnPlane, spawnTeal);
  kSpawn.rotation.x = -Math.PI / 2;
  kSpawn.position.set(0, 0.02, 17.6);
  group.add(kSpawn);
  const cSpawn = new THREE.Mesh(spawnPlane, spawnRed);
  cSpawn.rotation.x = -Math.PI / 2;
  cSpawn.position.set(0, 0.02, -17.6);
  group.add(cSpawn);

  // Big painted site letters on the back walls (runtime canvas texture, no assets).
  const letterA = makeLetterMesh('A');
  letterA.position.set(23.5, 3.4, -20.94);
  group.add(letterA);
  const letterB = makeLetterMesh('B');
  letterB.position.set(-23.5, 3.4, -20.94);
  group.add(letterB);

  // Sodium lamps: dark pole, hot head, warm point light. Four corners of the action.
  const lampPositions = [[0, 1.5], [0, -9.5], [16.5, -9], [-16.5, -9]];
  for (const [x, z] of lampPositions) {
    box(0.32, 4.3, 0.32, x, 2.15, z, darkMetal);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.42), new THREE.MeshStandardMaterial({
      color: 0x301d06, emissive: 0xffa03c, emissiveIntensity: 1.15, roughness: 0.6,
    }));
    head.position.set(x, 4.35, z);
    group.add(head);
    const light = new THREE.PointLight(0xffb04a, 65, 20, 1.75);
    light.position.set(x, 4.1, z);
    group.add(light);
  }

  // Distant silhouettes outside the walls for depth against the fog.
  const skyline = new THREE.MeshStandardMaterial({ color: 0x131a23, roughness: 1 });
  const shards = [[-34, -6, 7, 9, 5], [-38, 8, 5, 14, 6], [34, 2, 6, 11, 6], [38, -12, 8, 8, 7], [-30, 26, 6, 10, 8], [28, 26, 7, 13, 9]];
  for (const [x, z, w, h, d] of shards) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skyline);
    mesh.position.set(x, h / 2, z);
    group.add(mesh);
  }

  // Lights: cold sky fill, one warm key with shadows.
  const hemi = new THREE.HemisphereLight(0x3d5163, 0x10141a, 1.7);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xe8e4d8, 2.3);
  key.position.set(14, 22, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -34;
  key.shadow.camera.right = 34;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0007;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x4a6a8a, 0.7);
  rim.position.set(-12, 10, -18);
  scene.add(rim);

  // Slab test against every collider. Returns the nearest hit distance, or -1.
  function rayTest(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = -1;
    for (const c of colliders) {
      const t = rayAABB(ox, oy, oz, dx, dy, dz, c);
      if (t >= 0 && t <= maxDist && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  // Segment (a -> b) vs boxes. Used for bot line-of-sight and bullet stops.
  function segmentHit(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return -1;
    return rayTest(ax, ay, az, dx / len, dy / len, dz / len, len);
  }

  return { colliders, shootables, spawns: SPAWNS, sites: SITES, rayTest, segmentHit };
}

// Ridge-line layout: |axis - o| / d, slab style, no allocation.
function rayAABB(ox, oy, oz, dx, dy, dz, box) {
  let tmin = 0;
  let tmax = Infinity;
  // X axis
  if (Math.abs(dx) < 1e-9) {
    if (ox < box.min.x || ox > box.max.x) return -1;
  } else {
    let t1 = (box.min.x - ox) / dx;
    let t2 = (box.max.x - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y axis
  if (Math.abs(dy) < 1e-9) {
    if (oy < box.min.y || oy > box.max.y) return -1;
  } else {
    let t1 = (box.min.y - oy) / dy;
    let t2 = (box.max.y - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z axis
  if (Math.abs(dz) < 1e-9) {
    if (oz < box.min.z || oz > box.max.z) return -1;
  } else {
    let t1 = (box.min.z - oz) / dz;
    let t2 = (box.max.z - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function makeLetterMesh(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(232,230,221,0.92)';
  ctx.font = '700 170px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 118);
  ctx.fillStyle = '#1fd3bd';
  ctx.fillRect(48, 196, 160, 14);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 4.6),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  return mesh;
}
