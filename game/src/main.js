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

const STEP = 1 / 60;
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e141b);
scene.fog = new THREE.Fog(0x0e141b, 40, 125);

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
let simTime = 0;

// --- Tiny synthesized audio: no assets, created on first user gesture. ---
function createAudio() {
  let ctx = null;
  let noise = null;
  function ac() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const len = Math.floor(ctx.sampleRate * 0.18);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      } catch {
        ctx = null;
      }
    }
    return ctx;
  }
  function tone(freq, type, duration, gain, when = 0) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
  return {
    unlock() { ac(); },
    shot() {
      const c = ac();
      if (!c) return;
      const src = c.createBufferSource();
      src.buffer = noise;
      const g = c.createGain();
      const t = c.currentTime;
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      src.connect(g).connect(c.destination);
      src.start(t);
      tone(68, 'square', 0.09, 0.22);
    },
    slash() { tone(340, 'triangle', 0.05, 0.14); },
    thump() { tone(95, 'sine', 0.14, 0.2); },
    dry() { tone(1900, 'square', 0.025, 0.08); },
    reload() { tone(520, 'square', 0.04, 0.12); tone(760, 'square', 0.045, 0.12, 0.16); },
    hit() { tone(1450, 'sine', 0.055, 0.16); },
    buy() { tone(880, 'sine', 0.06, 0.12); tone(1320, 'sine', 0.07, 0.1, 0.07); },
    plant() { tone(660, 'square', 0.06, 0.14); tone(660, 'square', 0.06, 0.14, 0.18); },
    beep(freq) { tone(freq || 880, 'sine', 0.05, 0.1); },
    explode() {
      const c = ac();
      if (!c) return;
      const src = c.createBufferSource();
      src.buffer = noise;
      const g = c.createGain();
      const t = c.currentTime;
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      src.connect(g).connect(c.destination);
      src.start(t);
      tone(42, 'sine', 0.5, 0.4);
    },
    round() { tone(392, 'sine', 0.16, 0.16); tone(523, 'sine', 0.18, 0.16, 0.14); },
  };
}
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
  get velocityX() { return player.state.velocity.x; },
  get velocityZ() { return player.state.velocity.z; },
  get alive() { return G.player.health > 0; },
  takeDamage(dmg, _part, attacker) {
    this.lastDamagedBy = attacker || null;
    applyDamage(dmg);
    return G.player.health;
  },
};

const botsCtl = createBots(scene, world, arsenal, {
  callout(text) {
    hud.pushKillFeed(`<span class="team-cinder">INTEL</span> ${text}`);
  },
});
const targets = [playerTarget, ...botsCtl.bots];

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

const fireState = { cooldown: 0, burstLeft: 0, burstCd: 0, prevFiring: false };
const tmpDir = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const GUN_IDS = ['p9', 'k9', 'vk7'];
const isGunId = (id) => GUN_IDS.includes(id);

function currentGun() {
  return isGunId(G.curWeapon) ? G.guns[G.curWeapon] : null;
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
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
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
    const pitch = player.pitch;
    const cosP = Math.cos(pitch);
    tmpDir.set(-Math.sin(player.yaw) * cosP, Math.sin(pitch) + 0.18, -Math.cos(player.yaw) * cosP).normalize();
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
  const yaw = player.yaw + Math.cos(angle) * radius;
  const pitch = player.pitch + Math.sin(angle) * radius;
  const cosPitch = Math.cos(pitch);
  tmpDir.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);

  const from = camera.position;
  const hit = arsenal.hitscan(from.x, from.y, from.z, tmpDir.x, tmpDir.y, tmpDir.z, 150, targets);

  // Muzzle tracer from lower-right of the view, like a gun held on screen.
  tmpMuzzle.set(
    from.x + Math.cos(player.yaw) * 0.22 - Math.sin(player.yaw) * 0.35,
    from.y - 0.18,
    from.z - Math.sin(player.yaw) * 0.22 - Math.cos(player.yaw) * 0.35,
  );
  const endDist = hit.dist >= 0 ? hit.dist : 150;
  arsenal.spawnTracer(
    tmpMuzzle.x, tmpMuzzle.y, tmpMuzzle.z,
    from.x + tmpDir.x * endDist, from.y + tmpDir.y * endDist, from.z + tmpDir.z * endDist,
  );

  if (hit.kind === 'body' && hit.target) {
    const dmg = arsenal.partDamage(w, hit.part) * rangeFalloff(w, hit.dist);
    damageTarget(hit.target, dmg, hit.part, playerTarget);
    arsenal.spawnSpark(hit.x, hit.y, hit.z, hit.part === arsenal.PART_HEAD);
    hud.markHit();
    audio.hit();
  } else if (hit.kind === 'world') {
    arsenal.spawnSpark(hit.x, hit.y, hit.z, false);
  }

  player.recoil(w.recoilPitch * (0.8 + Math.random() * 0.45), (Math.random() - 0.5) * w.recoilYaw * 2, w.heat);
  audio.shot();
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

// --- Demo autopilot: the ?demo=1 URL flag walks the player into the fight. ---
const DEMO_ROUTE = [
  { x: -8, z: 13 }, { x: -11, z: 11 }, { x: -13, z: 1.5 }, { x: -17.5, z: 0.9 },
  { x: -18, z: 1 }, { x: -14, z: -11 }, { x: -23.5, z: -15 },
];
const demoState = { routeIdx: 0 };
const demoKeys = new Set();
const demoOut = { move: false, fire: false, holdE: false };

function demoFireControl(dt, out) {
  out.move = true;
  out.fire = false;
  out.holdE = false;
  const px = player.state.position.x, pz = player.state.position.z;

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
    if (startReload()) audio.reload();
  }
  if (pressed.has('Digit1')) switchWeapon(G.owned[G.primary] ? G.primary : 'p9');
  if (pressed.has('Digit2')) switchWeapon('p9');
  if (pressed.has('Digit3')) switchWeapon('knife');
  if (pressed.has('Digit4')) switchWeapon('he');

  // Pointer look flows straight into the view.
  const look = input.takeLook();
  if (look.x || look.y) player.look(look.x, look.y);

  // Demo flag: the player is steered by a small scripted brain instead of the mouse.
  const demo = window.location.search.indexOf('demo=1') !== -1 || window.location.hash === '#demo';
  let moveKeys = input.state.keys;
  let holdKey = input.state.keys.has('KeyE');
  let wantFire = input.state.firing;

  if (demo) {
    demoKeys.clear();
    if (G.phase === 'live' && G.player.health > 0) {
      demoFireControl(dt, demoOut);
      if (demoOut.move) demoKeys.add('KeyW');
      moveKeys = demoKeys;
      holdKey = demoOut.holdE;
      // Semi weapons need fresh trigger pulls: pulse the trigger so the demo shoots its P9.
      wantFire = demoOut.fire && (Math.floor(simTime * 8) % 2 === 0);
    }
  }

  // Movement locks during freeze and round-over; look is always free.
  if (G.phase === 'live' && playerTarget.alive) player.step(dt, moveKeys);

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
}

function onPhaseChange(phase) {
  if (phase === 'freeze') {
    hud.setCenter('FREEZE', 'Two sites. A east, B west — hold E to plant · B to buy');
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
    window.location.search.indexOf('play') !== -1 || window.location.search.indexOf('demo=1') !== -1) {
  startMatch(false);
}

requestAnimationFrame(frame);
