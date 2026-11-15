// Bootstrap: renderer, scene, fixed-step loop (60 Hz simulation, render after) and the
// wiring between input, player, world, state, HUD, weapons, bots and the round machine.
// A headless demo mode (?demo=1) drives the player with a small scripted brain so the
// whole loop can be exercised and filmed without a mouse.
import * as THREE from 'three';
import {
  G, CONSTANTS, resetMatch, buyGood, applyDamage,
} from './state.js';
import { WEAPONS, rangeFalloff, createArsenal } from './weapons.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWorld } from './world.js';
import { createHud } from './hud.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createAudio } from './audio.js';
import { createViewmodel } from './viewmodel.js';

const STEP = 1 / 60;
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1018);
// Haze-matched linear fog: lanes gain depth, the yard never shows a hard edge.
scene.fog = new THREE.Fog(0x2c211b, 25, 90);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';

const world = createWorld(scene);
const player = createPlayer(world.colliders);
const hud = createHud();
const arsenal = createArsenal(scene, world);

const canvas = renderer.domElement;
let buyOpen = false;
let scoreboardOpen = false;
let lastPhase = 'menu'; // last phase the HUD chrome was set for
let hudChromeVisible = true; // HUD root hidden during the menu / cover
let simTime = 0;

// --- Viewmodel: the rifle in frame. The camera joins the scene so its child renders. ---
scene.add(camera);
const viewmodel = createViewmodel(camera);

// --- Shell casings and footsteps share scratch state; no per-frame allocation. ---
let footstepTimer = 0;
const audio = createAudio();

// --- Entities -----------------------------------------------------------------
const playerTarget = {
  id: 'player',
  name: 'You',
  team: 'kestrel',
  kind: 'player',
  pos: player.state.position,
  radius: 0.34,
  counted: false,
  lastDamagedBy: null,
  get height() { return player.state.height; },
  get crouching() { return player.state.crouching; },
  get velocityX() { return player.state.velocity.x; },
  get velocityZ() { return player.state.velocity.z; },
  get alive() { return G.player.health > 0; },
  takeDamage(dmg, _part, attacker) {
    this.lastDamagedBy = attacker || null;
    applyDamage(dmg);
    if (DEMO_GOD && G.player.health < 1) G.player.health = 1;
    arsenal.spawnBlood(
      player.state.position.x - Math.sin(player.state.yaw) * 0.5,
      player.state.position.y + 1.15,
      player.state.position.z - Math.cos(player.state.yaw) * 0.5,
    );
    return G.player.health;
  },
};

const botsCtl = createBots(scene, world, arsenal, {
  callout(text) {
    hud.pushKillFeed(`<span class="team-cinder">INTEL</span> ${text}`);
  },
});
const targets = [playerTarget, ...botsCtl.bots];
// The shooter's own body must never be a hitscan target (the camera sits inside it).
const shootTargets = targets.filter((t) => t !== playerTarget);

// Combat damage funnel: remembers the attacker for credit and assists.
function damageTarget(t, dmg, part, attacker) {
  t.lastDamagedBy = attacker || null;
  return t.takeDamage(dmg, part, attacker);
}
for (const bot of botsCtl.bots) {
  const original = bot.takeDamage.bind(bot);
  bot.takeDamage = (dmg, part, attacker) => {
    bot.lastDamagedBy = attacker || null;
    return original(dmg, part, attacker);
  };
}

arsenal.setExplodeListener((x, y, z, owner) => {
  for (const t of targets) {
    if (!t.alive) continue;
    const dx = t.pos.x - x, dz = t.pos.z - z;
    const dist = Math.hypot(dx, dz);
    if (dist > 8.5) continue;
    const open = world.segmentHit(x, y, z, t.pos.x, t.pos.y + 1, t.pos.z) < 0;
    let dmg = 300 * Math.max(0, 1 - dist / 8.5) + 25;
    if (!open) dmg *= 0.3;
    damageTarget(t, dmg, 0, owner || null);
  }
});

const rounds = createRounds({ scene, world, hud, audio, arsenal });

const input = createInput(canvas, (locked) => {
  const resume = hud.elements.resume;
  if (locked) {
    resume.hidden = true;
    return;
  }
  if (G.phase !== 'menu' && !buyOpen && !G.matchWinner) resume.hidden = false;
});

const menu = document.getElementById('menu');
const playButton = document.getElementById('play');
const matchAgainButton = document.getElementById('match-again');
const resumeOverlay = document.getElementById('resume');

function respawnAtSpawn() {
  const spawn = world.spawns[G.playerTeam][1];
  player.respawn(spawn.x, 0, spawn.z, 0);
}

function resetEntitiesForRound() {
  respawnAtSpawn();
  playerTarget.counted = false;
  playerTarget.lastDamagedBy = null;
  for (const t of targets) {
    if (t !== playerTarget) {
      t.counted = false;
      t.lastDamagedBy = null;
    }
  }
  botsCtl.resetForRound();
  fireState.cooldown = 0;
  fireState.burstLeft = 0;
  fireState.burstCd = 0;
  fireState.prevFiring = false;
}

function startMatch(withLock) {
  menu.hidden = true;
  matchAgainButton.hidden = true;
  resetMatch();
  resetEntitiesForRound();
  rounds.resetBomb();
  lastPhase = 'menu'; // let the phase machine announce the freeze
  audio.unlock();
  if (withLock) input.requestLock();
}

playButton.addEventListener('click', () => startMatch(true));
matchAgainButton.addEventListener('click', () => startMatch(true));

// Refusal reasons translated for the buy note.
const BUY_FAIL = {
  money: 'Not enough money.', owned: 'Already owned.', full: 'Grenade kit is full.',
  unknown: 'Item not found.', freeze: 'Buying is open during the buy phase only.',
  spawn: 'Buying is open at spawn only.',
};

const inSpawnArea = () => player.state.position.z > 12;
const inFreeze = () => G.phase === 'freeze';

hud.onBuyClick((id) => {
  if (!inFreeze()) { hud.buyNote(BUY_FAIL.freeze); audio.dry(); return; }
  if (!inSpawnArea()) { hud.buyNote(BUY_FAIL.spawn); audio.dry(); return; }
  const result = buyGood(id);
  if (!result.ok) {
    hud.buyNote(BUY_FAIL[result.reason] || 'Cannot buy that.');
    audio.dry();
    return;
  }
  hud.buyNote('');
  audio.buy();
  hud.renderBuy(G);
});

document.getElementById('buy-close').addEventListener('click', () => toggleBuy(false));
resumeOverlay.addEventListener('click', () => input.requestLock());

function toggleBuy(force) {
  const open = force === undefined ? !buyOpen : force;
  if (open) {
    if (G.phase === 'menu') return;
    if (!inFreeze()) {
      hud.pushKillFeed('<span class="team-cinder">SUPPLY</span> Buying opens in the next buy phase');
      return;
    }
  }
  buyOpen = open;
  hud.setBuyMenu(open, G);
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    hud.elements.resume.hidden = true;
  } else if (G.phase !== 'menu') {
    input.requestLock();
  }
}

// Escape closes the buy menu when the pointer is not locked (browser keeps Esc while locked).
window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && buyOpen) toggleBuy(false);
});

// Grenade trajectory preview: preallocated dot strip, visible only with the HE equipped.
const ARC_POINTS = 26;
const arcPos = new Float32Array(ARC_POINTS * 3);
const arcGeo = new THREE.BufferGeometry();
arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
const arc = new THREE.Points(
  arcGeo,
  new THREE.PointsMaterial({ color: 0xffc46b, size: 0.08, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
);
arc.visible = false;
arc.frustumCulled = false;
scene.add(arc);

const fireState = { cooldown: 0, burstLeft: 0, burstCd: 0, prevFiring: false };
const tmpDir = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const GUN_IDS = ['p9', 'k9', 'vk7'];
const isGunId = (id) => GUN_IDS.includes(id);

function currentGun() {
  return isGunId(G.curWeapon) ? G.guns[G.curWeapon] : null;
}

// Ballistic preview for the HE grenade, matching the throw in fireOnce. No allocation:
// the dot strip is one buffer rewritten per frame while the grenade is in hand.
function updateArc() {
  if (G.curWeapon !== 'he' || G.grenades <= 0 || G.phase !== 'live') {
    arc.visible = false;
    return;
  }
  arc.visible = true;
  const pitch = player.state.pitch;
  const cosP = Math.cos(pitch);
  const dx = -Math.sin(player.state.yaw) * cosP;
  const dy = Math.sin(pitch) + 0.18;
  const dz = -Math.cos(player.state.yaw) * cosP;
  const len = Math.hypot(dx, dy, dz) || 1;
  let px = camera.position.x + (dx / len) * 0.5;
  let py = camera.position.y - 0.1;
  let pz = camera.position.z + (dz / len) * 0.5;
  let vx = (dx / len) * 15, vy = (dy / len) * 15 + 2.5, vz = (dz / len) * 15;
  const step = 0.085;
  for (let i = 0; i < ARC_POINTS; i += 1) {
    vy -= 14.5 * step;
    px += vx * step;
    py += vy * step;
    pz += vz * step;
    if (py < 0.06) py = 0.06;
    arcPos[i * 3] = px;
    arcPos[i * 3 + 1] = py;
    arcPos[i * 3 + 2] = pz;
  }
  arcGeo.attributes.position.needsUpdate = true;
}

// Spread in pixels for the dynamic crosshair.
function crosshairSpreadPx() {
  const w = WEAPONS[G.curWeapon];
  if (!w || w.spreadStand === undefined) return 3;
  const deg = player.spreadDegrees(w);
  return Math.max(2.5, Math.min(26, 3 + deg * 3.6));
}

function fireOnce() {
  const id = G.curWeapon;
  // Knife: reach out and touch someone inside two and a half metres.
  if (id === 'knife') {
    fireState.cooldown = WEAPONS.knife.interval;
    audio.slash();
    const fx = -Math.sin(player.state.yaw), fz = -Math.cos(player.state.yaw);
    let best = null;
    let bestD = WEAPONS.knife.range;
    for (const t of targets) {
      if (!t.alive || t === playerTarget) continue;
      const dx = t.pos.x - player.state.position.x, dz = t.pos.z - player.state.position.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const dot = (fx * dx + fz * dz) / Math.max(0.001, d);
      if (dot < 0.72) continue;
      best = t; bestD = d;
    }
    if (best) {
      damageTarget(best, WEAPONS.knife.damage, 0, playerTarget);
      arsenal.spawnBlood(best.pos.x, best.pos.y + 1.1, best.pos.z);
      arsenal.spawnSpark(best.pos.x, best.pos.y + 1.1, best.pos.z, false);
      hud.markHit();
      audio.thump();
    }
    return;
  }
  // HE grenade: lobbed overhand with a flat-ish arc.
  if (id === 'he') {
    if (G.grenades <= 0) { audio.dry(); fireState.cooldown = 0.3; return; }
    fireState.cooldown = 0.7;
    G.grenades -= 1;
    const pitch = player.state.pitch;
    const cosP = Math.cos(pitch);
    tmpDir.set(-Math.sin(player.state.yaw) * cosP, Math.sin(pitch) + 0.18, -Math.cos(player.state.yaw) * cosP).normalize();
    const from = camera.position;
    arsenal.throwGrenade(from.x + tmpDir.x * 0.5, from.y - 0.1, from.z + tmpDir.z * 0.5,
      tmpDir.x * 15, tmpDir.y * 15 + 2.5, tmpDir.z * 15, playerTarget);
    arsenal.noise(from.x, from.z, 'shot');
    audio.slash();
    return;
  }
  // Guns.
  const w = WEAPONS[id];
  const gs = currentGun();
  if (!gs) return;
  if (gs.mag <= 0) {
    audio.dry();
    fireState.cooldown = 0.3;
    return;
  }
  fireState.cooldown = w.interval;
  gs.mag -= 1;

  const spread = THREE.MathUtils.degToRad(player.spreadDegrees(w));
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * spread;
  const yaw = player.state.yaw + Math.cos(angle) * radius;
  const pitch = player.state.pitch + Math.sin(angle) * radius;
  const cosPitch = Math.cos(pitch);
  tmpDir.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);
  const from = camera.position;
  const hit = arsenal.hitscan(from.x, from.y, from.z, tmpDir.x, tmpDir.y, tmpDir.z, 150, shootTargets);

  // Muzzle tracer from lower-right of the view, like a gun held on screen.
  tmpMuzzle.set(
    from.x + Math.cos(player.state.yaw) * 0.22 - Math.sin(player.state.yaw) * 0.35,
    from.y - 0.18,
    from.z - Math.sin(player.state.yaw) * 0.22 - Math.cos(player.state.yaw) * 0.35,
  );
  const endDist = hit.dist >= 0 ? hit.dist : 150;
  arsenal.spawnTracer(
    tmpMuzzle.x, tmpMuzzle.y, tmpMuzzle.z,
    from.x + tmpDir.x * endDist, from.y + tmpDir.y * endDist, from.z + tmpDir.z * endDist,
  );

  if (hit.kind === 'body' && hit.target) {
    const dmg = arsenal.partDamage(w, hit.part) * rangeFalloff(w, hit.dist);
    damageTarget(hit.target, dmg, hit.part, playerTarget);
    arsenal.spawnBlood(hit.x, hit.y, hit.z);
    arsenal.spawnSpark(hit.x, hit.y, hit.z, hit.part === arsenal.PART_HEAD);
    hud.markHit();
    if (hit.part === arsenal.PART_HEAD) audio.headshot();
    else audio.hit();
  } else if (hit.kind === 'world') {
    arsenal.spawnSpark(hit.x, hit.y, hit.z, false);
    arsenal.spawnDust(hit.x, hit.y, hit.z, false);
  }

  player.recoil(w.recoilPitch * (0.8 + Math.random() * 0.45), (Math.random() - 0.5) * w.recoilYaw * 2, w.heat);
  const gunKind = id === 'p9' ? 'pistol' : id === 'k9' ? 'smg' : 'rifle';
  audio.shot(gunKind);
  viewmodel.fire();
  // Eject a casing to the shooter's right, biased forward and up.
  const cosY = Math.cos(player.state.yaw);
  const sinY = Math.sin(player.state.yaw);
  arsenal.spawnCasing(
    from.x - sinY * 0.25 + cosY * 0.3,
    from.y - 0.12,
    from.z - cosY * 0.25 - sinY * 0.3,
    cosY * (1.1 + Math.random() * 0.7) - sinY * 0.6,
    1.9 + Math.random() * 0.5,
    -sinY * (1.1 + Math.random() * 0.7) - cosY * 0.6,
  );
  arsenal.noise(from.x, from.z, 'shot');
}

function startReload() {
  const id = G.curWeapon;
  if (!isGunId(id)) return false;
  const w = WEAPONS[id];
  const gs = G.guns[id];
  if (G.reloadT > 0) return false;
  if (gs.mag >= w.mag) return false;
  if (gs.reserve <= 0) return false;
  G.reloadT = w.reload;
  return true;
}

function tickReload(dt) {
  if (G.reloadT <= 0) return;
  G.reloadT -= dt;
  if (G.reloadT > 0) return;
  G.reloadT = 0;
  const w = WEAPONS[G.curWeapon];
  if (!w) return;
  const gs = G.guns[G.curWeapon];
  const take = Math.min(w.mag - gs.mag, gs.reserve);
  gs.mag += take;
  gs.reserve -= take;
}

function switchWeapon(id) {
  if (id === 'p9' && !G.owned.p9) return;
  if (id === 'vk7' && !G.owned.vk7) return;
  if (id === 'k9' && !G.owned.k9) return;
  if (id === 'he' && G.grenades <= 0) return;
  if (G.curWeapon === id) return;
  G.curWeapon = id;
  G.reloadT = 0;
  fireState.cooldown = Math.max(fireState.cooldown, 0.15);
  fireState.burstLeft = 0;
  fireState.burstCd = 0;
}

// --- Demo autopilot: the ?demo= URL flag walks the player into the fight. ---
// ?demo=1 walks the default route; ?demo=fight same route but the player cannot die
// (headless screenshots); ?demo=bomb takes the east lane to site A and holds E to
// plant; ?demo=buy auto-opens the buy menu on freeze. Single token, so plain URLs work.
const DEMO_MODE = (window.location.search.match(/demo=([a-z0-9]+)/) || [])[1] || '';
const DEMO_RUN = DEMO_MODE !== '';
const DEMO_GOD = DEMO_MODE === 'fight' || DEMO_MODE === 'bomb';
const DEMO_EAST = DEMO_MODE === 'bomb' || DEMO_MODE === 'buy';
const DEMO_ROUTE = DEMO_EAST
  ? [
    { x: 6, z: 10 }, { x: 11, z: 4 }, { x: 14, z: -2 }, { x: 18, z: -8 },
    { x: 21.5, z: -11.5 }, { x: 23.5, z: -13.8 },
  ]
  : [
    { x: -8, z: 13 }, { x: -11, z: 11 }, { x: -13, z: 1.5 }, { x: -17.5, z: 0.9 },
    { x: -18, z: 1 }, { x: -14, z: -11 }, { x: -23.5, z: -15 },
  ];
const demoState = { routeIdx: 0, bombTp: false };
const demoKeys = new Set();
const demoOut = { move: false, fire: false, holdE: false };

function demoFireControl(dt, out) {
  out.move = true;
  out.fire = false;
  out.holdE = false;
  const px = player.state.position.x, pz = player.state.position.z;

  // The bomb harness never fights: hold E at the site, keep the view on the plate.
  if (DEMO_MODE === 'bomb') {
    out.move = false;
    const nearAE = Math.hypot(px - 23.5, pz + 15) < 3.2;
    const nearBE = Math.hypot(px + 23.5, pz + 15) < 3.2;
    if (!rounds.planted && rounds.carrierId === 'player' && (nearAE || nearBE)) {
      out.holdE = true;
    } else {
      out.holdE = false;
      // Stand still at the site, eyes on the plate; bots can shoot us, we do nothing.
      return;
    }
    return;
  }

  // On a site with the bomb: keep it there.
  const nearA = Math.hypot(px - 23.5, pz + 15) < 3.2;
  const nearB = Math.hypot(px + 23.5, pz + 15) < 3.2;
  if (!rounds.planted && rounds.carrierId === 'player' && (nearA || nearB)) {
    out.holdE = true;
    out.move = false;
    return;
  }

  // Fight what is visible.
  let best = null;
  let bestDist = Infinity;
  for (const t of targets) {
    if (!t.alive || t.team !== 'cinder') continue;
    const dx = t.pos.x - px, dz = t.pos.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > 45 || d >= bestDist) continue;
    if (world.segmentHit(px, player.state.position.y + 1.5, pz, t.pos.x, t.pos.y + 1.1, t.pos.z) >= 0) continue;
    best = t; bestDist = d;
  }
  const st = player.state;
  if (best) {
    const dx = best.pos.x - px, dz = best.pos.z - pz;
    const chest = best.pos.y + (best.height || 1.7) * 0.62;
    const eye = st.position.y + st.eye;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(chest - eye, Math.hypot(dx, dz));
    let dy = wantYaw - st.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    st.yaw += dy * Math.min(1, dt * 5);
    st.pitch += (wantPitch - st.pitch) * Math.min(1, dt * 5);
    out.move = bestDist > 10;
    out.fire = bestDist < 38 && Math.abs(dy) < 0.35;
    return;
  }
  const node = DEMO_ROUTE[demoState.routeIdx];
  if (node) {
    const dx = node.x - px, dz = node.z - pz;
    if (Math.hypot(dx, dz) < 1.4) {
      demoState.routeIdx = Math.min(DEMO_ROUTE.length - 1, demoState.routeIdx + 1);
      return;
    }
    const wantYaw = Math.atan2(-dx, -dz);
    let dy = wantYaw - st.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    st.yaw += dy * Math.min(1, dt * 3);
    st.pitch *= 0.9;
    out.move = true;
  }
}

// Fixed-step simulation; rendering happens after as many steps as fit.
let last = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let frameTime = (now - last) / 1000;
  last = now;
  if (frameTime > 0.25) frameTime = 0.25;
  accumulator += frameTime;

  while (accumulator >= STEP) {
    simulate(STEP);
    accumulator -= STEP;
  }

  // View from the player's eyes; YXZ so yaw then pitch reads naturally.
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0);

  // The rifle follows its own motion; the HE throw shows a dotted arc.
  const isGun = G.curWeapon === 'p9' || G.curWeapon === 'k9' || G.curWeapon === 'vk7';
  viewmodel.setVisible(isGun);
  const moveSpeed = Math.hypot(player.state.velocity.x, player.state.velocity.z);
  viewmodel.update(frameTime, moveSpeed, player.state.crouching, player.state.onGround);
  updateArc();

  hud.draw(G, frameTime, crosshairSpreadPx());
  renderer.render(scene, camera);
}

function simulate(dt) {
  simTime += dt;
  if (fireState.cooldown > 0) fireState.cooldown -= dt;
  if (fireState.burstCd > 0) fireState.burstCd -= dt;
  tickReload(dt);

  const pressed = input.takePresses();
  if (pressed.has('KeyB')) toggleBuy();
  if (pressed.has('Tab')) {
    scoreboardOpen = !scoreboardOpen;
    hud.setScoreboard(scoreboardOpen, G);
  }
  if (pressed.has('KeyR')) {
    if (startReload()) {
      audio.reload();
      viewmodel.reload(WEAPONS[G.curWeapon].reload);
    }
  }
  if (pressed.has('Digit1')) switchWeapon(G.owned[G.primary] ? G.primary : 'p9');
  if (pressed.has('Digit2')) switchWeapon('p9');
  if (pressed.has('Digit3')) switchWeapon('knife');
  if (pressed.has('Digit4')) switchWeapon('he');

  // Pointer look flows straight into the view.
  const look = input.takeLook();
  if (look.x || look.y) player.look(look.x, look.y);

  // Demo flag: the player is steered by a small scripted brain instead of the mouse.
  const demo = DEMO_RUN || window.location.hash === '#demo';
  let moveKeys = input.state.keys;
  let holdKey = input.state.keys.has('KeyE');
  let wantFire = input.state.firing;

  if (demo) {
    demoKeys.clear();
    // Bomb-run harness: step straight onto site A when the round goes live.
    if (DEMO_MODE === 'bomb' && G.phase === 'live' && !demoState.bombTp) {
      demoState.bombTp = true;
      player.respawn(22.3, 0, -13.2, -0.59);
      player.state.pitch = -0.5; // frame the bomb and the painted A under it
    }
    if (G.phase === 'live' && G.player.health > 0) {
      demoFireControl(dt, demoOut);
      if (demoOut.move) demoKeys.add('KeyW');
      moveKeys = demoKeys;
      holdKey = demoOut.holdE;
      // Semi weapons need fresh trigger pulls: pulse the trigger so the demo shoots its P9.
      wantFire = demoOut.fire && (Math.floor(simTime * 8) % 2 === 0);
      // The autopilot tops up its magazine rather than click dry forever.
      const gs = G.guns[G.curWeapon];
      if (gs && gs.mag <= 3 && gs.reserve > 0 && G.reloadT <= 0 &&
          (G.curWeapon === 'p9' || G.curWeapon === 'k9' || G.curWeapon === 'vk7')) {
        if (startReload()) {
          audio.reload();
          viewmodel.reload(WEAPONS[G.curWeapon].reload);
        }
      }
    }
  }

  // Movement locks during freeze and round-over; look is always free.
  if (G.phase === 'live' && playerTarget.alive) player.step(dt, moveKeys);

  // Footsteps: cadence scales with ground speed; the surface decides the timbre.
  const groundSpeed = Math.hypot(player.state.velocity.x, player.state.velocity.z);
  if (G.phase === 'live' && playerTarget.alive && player.state.onGround && groundSpeed > 1.2) {
    footstepTimer -= dt * (0.7 + groundSpeed / 5.3);
    if (footstepTimer <= 0) {
      footstepTimer = 0.34;
      const onCatwalk = player.state.position.y > 1.1 && Math.abs(player.state.position.z - 6) < 1.6;
      audio.footstep(onCatwalk ? 'metal' : 'concrete');
    }
  }

  // Firing: VK-7 walks down in 3-round bursts; the rest respect their cadence;
  // semi weapons need a fresh trigger pull.
  const semi = G.curWeapon === 'p9' || G.curWeapon === 'knife' || G.curWeapon === 'he';
  const edge = wantFire && !fireState.prevFiring;
  fireState.prevFiring = !!wantFire;
  const canShoot = G.phase === 'live' && !buyOpen && !scoreboardOpen && playerTarget.alive;
  const trigger = (semi ? edge : wantFire) && canShoot;
  const w = WEAPONS[G.curWeapon];
  if (trigger) {
    if (w && w.burst) {
      if (fireState.burstCd <= 0 && fireState.burstLeft <= 0) fireState.burstLeft = w.burst;
    } else if (fireState.cooldown <= 0) {
      fireOnce();
    }
  }
  if (fireState.burstLeft > 0 && fireState.cooldown <= 0 && canShoot) {
    fireOnce();
    fireState.burstLeft -= 1;
    if (fireState.burstLeft <= 0 && w && w.burstPause) fireState.burstCd = w.burstPause;
  }

  // Arsenal effects advance on the fixed step.
  arsenal.update(dt);

  // Bots think and act.
  const ctx = {
    time: simTime,
    phase: G.phase,
    targets,
    objective: rounds.objective,
  };
  for (const bot of botsCtl.bots) botsCtl.update(bot, dt, ctx);

  // The round machine: freeze -> live -> round-over, the bomb, the clock, the wipes.
  rounds.update(dt, {
    targets,
    playerEntity: playerTarget,
    holdKey,
    onRoundReset: resetEntitiesForRound,
  });

  // Any death this frame: feed, stats, hit flash. Wipes are handled on the next tick.
  for (const t of targets) {
    if (t.alive || t.counted) continue;
    t.counted = true;
    const killer = t.lastDamagedBy || null;
    rounds.noteKill(t, killer, targets);
    if (killer && killer.team === 'kestrel') hud.markKill();
    hud.refreshScoreboard(G);
    if (t === playerTarget) G.damageFlash = 1;
  }

  // Phase machine: announce freeze / live / round-over.
  if (G.phase !== lastPhase) {
    const phase = G.phase;
    lastPhase = phase;
    onPhaseChange(phase);
  }

  // The cover hides the HUD chips so the menu reads clean; they return in freeze.
  const wantHud = G.phase !== 'menu';
  if (wantHud !== hudChromeVisible) {
    hudChromeVisible = wantHud;
    document.getElementById('hud').style.visibility = wantHud ? 'visible' : 'hidden';
  }
}

function onPhaseChange(phase) {
  if (phase === 'freeze') {
    hud.setCenter('FREEZE', 'Two sites. A east, B west — hold E to plant · B to buy');
    // Headless screenshot harness: ?demo=buy opens the buy menu on the first freeze.
    if (DEMO_MODE === 'buy' && !buyOpen) toggleBuy(true);
  } else if (phase === 'live') {
    hud.setCenter('', '');
    if (buyOpen) toggleBuy(false);
  } else if (phase === 'round-over') {
    rounds.announceRoundEnd(matchAgainButton);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug/testing handle: lets the headless runner poke the simulation (teleport, bomb timer)
// without changing how the game plays. Not used by the game itself.
window.__game__ = { G, rounds, player, targets, world };

// Headless/dev path: ?play or #play skips the overlay and the lock so a static screenshot shows the game.
if (window.location.hash === '#play' || window.location.hash === '#demo' ||
    window.location.search.indexOf('play') !== -1 || DEMO_RUN) {
  startMatch(false);
}

requestAnimationFrame(frame);
