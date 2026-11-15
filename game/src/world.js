// The map: Halden Yard, a dusk freight yard built from axis-aligned boxes. Three
// lanes (west to B, mid, east to A), a mid catwalk you clear by crouching, two
// bomb sites. Every structural box is a collider and a surface a ray or a bullet
// stops on. All textures are drawn at load time (see textures.js); the only
// external surfaces are vendored three.js modules.
import * as THREE from 'three';
import {
  concreteTextures, containerTextures, rustTextures, groundTextures,
  gratingTexture, siteMarkTexture, chevronTexture,
} from './textures.js';

const CONCRETE_LIGHT = 0xd8d5c8;
const DARK_METAL = 0x2e3540;
const CRATE = 0x8a8371;
const CATWALK = 0x3a3f47;
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

  const conc = concreteTextures(2.4, 2.4);
  const concBig = concreteTextures(6, 1);
  const concrete = new THREE.MeshStandardMaterial({ map: conc.map, roughness: 0.96, metalness: 0.02 });
  const concreteLight = new THREE.MeshStandardMaterial({ map: conc.map, color: CONCRETE_LIGHT, roughness: 0.9, metalness: 0.02 });
  const concreteWall = new THREE.MeshStandardMaterial({ map: concBig.map, roughness: 0.96, metalness: 0.02 });
  const containerT = containerTextures(2, 1.2);
  const container = new THREE.MeshStandardMaterial({ map: containerT.map, roughness: 0.58, metalness: 0.34 });
  const rustT = rustTextures(2, 2);
  const rust = new THREE.MeshStandardMaterial({ map: rustT.map, roughness: 0.82, metalness: 0.25 });
  const crateT = concreteTextures(0.8, 0.8);
  const crate = new THREE.MeshStandardMaterial({ map: crateT.map, color: CRATE, roughness: 0.9, metalness: 0.02 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: DARK_METAL, roughness: 0.5, metalness: 0.5 });
  const catwalk = new THREE.MeshStandardMaterial({ color: CATWALK, roughness: 0.7, metalness: 0.55 });

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

  // Angled box: visual rotation, collision from the enclosing axis-aligned box
  // (inflated by the rotation) so the collider never intrudes on the visible face.
  function angledBox(size, x, y, z, rotY, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const half = (size / 2) * (Math.abs(Math.cos(rotY)) + Math.abs(Math.sin(rotY)));
    const unit = new THREE.Box3();
    unit.min.set(x - half, y - size / 2, z - half);
    unit.max.set(x + half, y + size / 2, z + half);
    colliders.push(unit);
    shootables.push(mesh);
    return mesh;
  }

  // --- Dusk sky dome: vertical gradient, haze band low, sodium glow at the horizon. ---
  const skyGeo = new THREE.SphereGeometry(165, 32, 18);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x060b16) },
      mid: { value: new THREE.Color(0x182335) },
      horizon: { value: new THREE.Color(0x53321f) },
      haze: { value: new THREE.Color(0xa05a28) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 zenith, mid, horizon, haze;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.08, 1.0);
        vec3 col = mix(zenith, mid, smoothstep(0.55, 0.16, h));
        col = mix(col, horizon, smoothstep(0.16, 0.045, h));
        // Thin haze band kissing the horizon, sodium-orange toward the west (-x).
        float band = smoothstep(0.085, 0.0, abs(vDir.y - 0.012));
        float west = clamp(0.5 - 0.5 * (vDir.x + vDir.z * 0.35), 0.25, 1.0);
        col = mix(col, haze, band * west * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  // --- Perimeter. 58 x 42 m yard, walls 5.2 m; concrete with formwork seams. ---
  box(0.5, 5.2, 43, -29.25, 2.6, 0, concreteWall);
  box(0.5, 5.2, 43, 29.25, 2.6, 0, concreteWall);
  box(59, 5.2, 0.5, 0, 2.6, -21.25, concreteWall);
  box(59, 5.2, 0.5, 0, 2.6, 21.25, concreteWall);

  // --- Ground slab: cold worn concrete with two wet patches near the lamps. ---
  const groundT = groundTextures(9, 9);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ map: groundT.map, roughness: 0.98, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  group.add(floor);

  const wetMat = new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.08, metalness: 0.35 });
  for (const [x, z, sx, sz] of [[4.5, 2.5, 6, 3.4], [-15, -9.5, 5, 2.6]]) {
    const wet = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), wetMat);
    wet.rotation.x = -Math.PI / 2;
    wet.rotation.z = Math.random() * Math.PI;
    wet.position.set(x, 0.015, z);
    wet.receiveShadow = true;
    group.add(wet);
  }

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
  box(0.7, 4.2, 6.2, 9.8, 2.1, -8.4, concreteWall);
  box(0.7, 4.2, 6.2, -9.8, 2.1, -8.4, concreteWall);

  // Angled crates tucked into dead corners — visual rhythm, out of every lane.
  angledBox(1.6, 26.8, 0.8, 19.3, 0.42, crate);
  angledBox(1.6, -26.6, 0.8, -18.6, -0.35, crate);

  // Mid catwalk: a raised walkway across mid at z = 6, top at y = 1.6. Underneath
  // is a crawl gap (crouch height 1.12 m fits). Reached by the west steps.
  box(12.0, 0.4, 2.2, 0, 1.4, 6, catwalk);
  // Grating skin on the deck: see-through slots.
  const grate = new THREE.Mesh(
    new THREE.PlaneGeometry(12.0, 2.2),
    new THREE.MeshStandardMaterial({ map: gratingTexture(7, 1.4), alphaTest: 0.42, roughness: 0.7, metalness: 0.6, side: THREE.DoubleSide }),
  );
  grate.rotation.x = -Math.PI / 2;
  grate.position.set(0, 1.606, 6);
  group.add(grate);
  box(0.8, 1.2, 0.8, -4.6, 0.6, 6, darkMetal);
  box(0.8, 1.2, 0.8, 4.6, 0.6, 6, darkMetal);
  box(1.7, 0.53, 2.1, -6.85, 0.265, 6, catwalk); // step 1 (top 0.53)
  box(1.7, 1.06, 2.1, -8.55, 0.53, 6, catwalk);  // step 2 (top 1.06)

  // Railings on the catwalk edges: posts + double rail, both sides.
  const railMat = darkMetal;
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.95, 6);
  for (const zEdge of [5.02, 6.98]) {
    for (let x = -5.6; x <= 5.6; x += 1.6) {
      const post = new THREE.Mesh(postGeo, railMat);
      post.position.set(x, 2.07, zEdge);
      post.castShadow = true;
      group.add(post);
    }
    for (const railY of [2.52, 2.12]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(12.0, 0.05, 0.07), railMat);
      rail.position.set(0, railY, zEdge);
      rail.castShadow = true;
      group.add(rail);
    }
  }

  // Pipes run along the north and south walls — rust, knee height and waist height.
  const pipeGeoA = new THREE.CylinderGeometry(0.14, 0.14, 58, 10);
  const pipeGeoB = new THREE.CylinderGeometry(0.09, 0.09, 58, 8);
  for (const [wallZ, flip] of [[-20.9, 1], [20.9, -1]]) {
    for (const [geo, y] of [[pipeGeoA, 0.62], [pipeGeoB, 1.28]]) {
      const pipe = new THREE.Mesh(geo, rust);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, y, wallZ + flip * 0.18);
      pipe.castShadow = true;
      pipe.receiveShadow = true;
      group.add(pipe);
    }
    // Pipe brackets every 8 m.
    for (let x = -24; x <= 24; x += 8) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.05, 0.12), darkMetal);
      bracket.position.set(x, 0.95, wallZ + flip * 0.13);
      group.add(bracket);
    }
  }

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

  // Bombsite floor markings: painted ring + a big stencil letter in the circle.
  const ringMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.42, depthWrite: false });
  for (const site of [SITES.A, SITES.B]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.radius - 0.55, site.radius, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 5.6),
      new THREE.MeshBasicMaterial({ map: siteMarkTexture(site === SITES.A ? 'A' : 'B'), transparent: true, depthWrite: false, opacity: 1 }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(site.x, 0.018, site.z);
    group.add(mark);
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

  // Big painted site letters on the back walls.
  const letterA = makeLetterMesh('A');
  letterA.position.set(23.5, 3.4, -20.94);
  group.add(letterA);
  const letterB = makeLetterMesh('B');
  letterB.position.set(-23.5, 3.4, -20.94);
  group.add(letterB);

  // --- Doorways framing sightlines. Two: mid-north and mid-south. ---
  const chevron = chevronTexture();
  const lintelMat = new THREE.MeshStandardMaterial({ map: chevron, roughness: 0.6, metalness: 0.2 });
  function doorway(x, z) {
    const postGeo = new THREE.BoxGeometry(0.36, 3.1, 0.36);
    box(0.36, 3.1, 0.36, x - 1.12, 1.55, z, darkMetal);
    box(0.36, 3.1, 0.36, x + 1.12, 1.55, z, darkMetal);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 0.42), lintelMat);
    lintel.position.set(x, 3.28, z);
    lintel.castShadow = true;
    group.add(lintel);
  }
  doorway(0, -11.5);   // frames the mid-lane push toward the sites
  doorway(0, 11.8);    // frames the spawn-side view of mid

  // Sodium lamps: dark pole, hot head, warm point light. Four corners of the action.
  const lampPositions = [[0, 1.5], [0, -9.5], [16.5, -9], [-16.5, -9]];
  for (const [x, z] of lampPositions) {
    box(0.32, 4.3, 0.32, x, 2.15, z, darkMetal);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.42), new THREE.MeshStandardMaterial({
      color: 0x301d06, emissive: 0xffa03c, emissiveIntensity: 1.35, roughness: 0.6,
    }));
    head.position.set(x, 4.35, z);
    group.add(head);
    const light = new THREE.PointLight(0xffb04a, 70, 22, 1.75);
    light.position.set(x, 4.1, z);
    light.castShadow = false;
    group.add(light);
  }

  // --- Warm bounce per site: a low amber fill so the sites read as destinations. ---
  for (const site of [SITES.A, SITES.B]) {
    const bounce = new THREE.PointLight(0xff9a44, 26, 14, 1.9);
    bounce.position.set(site.x, 1.4, site.z + 2.2);
    group.add(bounce);
  }

  // --- Distant silhouettes: two rings of dead shipping mass and stacks beyond the walls. ---
  const skyline = new THREE.MeshStandardMaterial({ color: 0x10161f, roughness: 1 });
  const skyline2 = new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 1 });
  const shards = [
    [-34, -6, 7, 9, 5], [-38, 8, 5, 14, 6], [34, 2, 6, 11, 6], [38, -12, 8, 8, 7],
    [-30, 26, 6, 10, 8], [28, 26, 7, 13, 9], [-12, -34, 9, 12, 7], [16, -36, 7, 17, 8],
    [60, -4, 9, 10, 8], [-58, -14, 8, 12, 9], [52, 22, 6, 15, 6], [-54, 20, 7, 11, 7],
    [8, 44, 10, 9, 8], [-24, 46, 8, 13, 7], [70, -30, 10, 18, 9], [-72, -26, 9, 15, 8],
  ];
  for (const [x, z, w, h, d] of shards) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), (Math.abs(x) + Math.abs(z)) % 3 > 1.5 ? skyline2 : skyline);
    mesh.position.set(x, h / 2 - 0.5, z);
    group.add(mesh);
  }
  // Two dead chimney stacks on the horizon.
  for (const [x, z, h] of [[-44, -30, 22], [46, 30, 18]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.0, h, 10), skyline2);
    stack.position.set(x, h / 2, z);
    group.add(stack);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.3, 0.7, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a0f06, emissive: 0xff5a1e, emissiveIntensity: 0.5 }),
    );
    tip.position.set(x, h + 0.2, z);
    group.add(tip);
  }

  // Lights: cool sky fill, one warm key with shadows, a cold rim.
  const hemi = new THREE.HemisphereLight(0x4a5f77, 0x141820, 1.32);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xe8e4d8, 2.15);
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
  const rim = new THREE.DirectionalLight(0x506f92, 0.8);
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
