// Bootstrap: renderer, scene, fixed-step loop (60 Hz simulation, render after) and the
// wiring between input, player, world, state and HUD. The next session adds weapons,
// bots and round logic on these seams.
import * as THREE from 'three';
import { G, CONSTANTS, resetMatch, beginFreeze, beginLive, endRound, startReload, tickReload, buyGood } from './state.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWorld } from './world.js';
import { createHud } from './hud.js';

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

const canvas = renderer.domElement;
let buyOpen = false;
let scoreboardOpen = false;
let lastPhase = 'menu'; // last phase the HUD chrome was set for
let fireCooldown = 0;

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
    dry() { tone(1900, 'square', 0.025, 0.08); },
    reload() { tone(520, 'square', 0.04, 0.12); tone(760, 'square', 0.045, 0.12, 0.16); },
    hit() { tone(1450, 'sine', 0.055, 0.16); },
    buy() { tone(880, 'sine', 0.06, 0.12); tone(1320, 'sine', 0.07, 0.1, 0.07); },
    round() { tone(392, 'sine', 0.16, 0.16); tone(523, 'sine', 0.18, 0.16, 0.14); },
  };
}
const audio = createAudio();

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

function startMatch(withLock) {
  menu.hidden = true;
  matchAgainButton.hidden = true;
  resetMatch();
  respawnAtSpawn();
  lastPhase = 'menu'; // let the phase machine announce the freeze
  audio.unlock();
  if (withLock) input.requestLock();
}

playButton.addEventListener('click', () => startMatch(true));
matchAgainButton.addEventListener('click', () => {
  startMatch(true);
});

// Refusal reasons translated for the buy note.
const BUY_FAIL = { money: 'Not enough money.', owned: 'Already owned.', full: 'Ammo is full.', unknown: 'Item not found.' };

hud.onBuyClick((id) => {
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
  if (open && G.phase === 'menu') return;
  buyOpen = open;
  hud.setBuyMenu(open, G);
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    hud.elements.resume.hidden = true;
  } else {
    input.requestLock();
  }
}

// Escape closes the buy menu when the pointer is not locked (browser keeps Esc while locked).
window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && buyOpen) toggleBuy(false);
});

const tmpDir = new THREE.Vector3();

function tryFire() {
  if (fireCooldown > 0) return;
  if (G.ammo.mag <= 0) {
    audio.dry();
    fireCooldown = 0.28;
    return;
  }
  fireCooldown = 0.1;
  G.ammo.mag -= 1;

  // Direction with the current spread cone, in yaw/pitch space.
  const spread = THREE.MathUtils.degToRad(player.spreadDegrees());
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * spread;
  const yaw = player.yaw + Math.cos(angle) * radius;
  const pitch = player.pitch + Math.sin(angle) * radius;
  const cosPitch = Math.cos(pitch);
  tmpDir.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);

  const from = camera.position;
  const dist = world.rayTest(from.x, from.y, from.z, tmpDir.x, tmpDir.y, tmpDir.z, 150);
  player.recoil(0.021 + Math.random() * 0.008, (Math.random() - 0.5) * 0.011);
  audio.shot();
  if (dist >= 0) hud.markHit();
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

  hud.draw(G, frameTime);
  renderer.render(scene, camera);
}

function simulate(dt) {
  if (fireCooldown > 0) fireCooldown -= dt;
  tickReload(dt);

  const pressed = input.takePresses();
  if (pressed.has('KeyB')) toggleBuy();
  if (pressed.has('Tab')) {
    scoreboardOpen = !scoreboardOpen;
    hud.setScoreboard(scoreboardOpen);
  }
  if (pressed.has('KeyR')) {
    if (startReload()) audio.reload();
  }

  // Pointer look flows straight into the view.
  const look = input.takeLook();
  if (look.x || look.y) player.look(look.x, look.y);

  // Movement locks during freeze and round-over; look is always free.
  if (G.phase === 'live') player.step(dt, input.state.keys);

  // Auto fire while the trigger is held and the phase allows it.
  if (input.state.firing && G.phase === 'live' && !buyOpen && !scoreboardOpen) tryFire();

  // Phase machine: freeze -> live, live -> round-over, round-over -> next round.
  if (G.phase !== lastPhase) {
    lastPhase = G.phase;
    onPhaseChange();
  }
  if (G.phase === 'freeze') {
    G.timers.freeze -= dt;
    if (G.timers.freeze <= 0) beginLive();
  } else if (G.phase === 'live') {
    G.timers.round -= dt;
    if (G.timers.round <= 0) {
      // Time expires: the defenders hold the yard.
      endRound('cinder');
    }
  } else if (G.phase === 'round-over' && !G.matchWinner) {
    G.timers.roundOver += dt;
    if (G.timers.roundOver >= CONSTANTS.ROUND_OVER_PAUSE) {
      G.round += 1;
      beginFreeze(); // health, magazine and the freeze clock come back
      respawnAtSpawn();
    }
  }
}

function onPhaseChange() {
  if (G.phase === 'freeze') {
    hud.setCenter('FREEZE', 'Two sites. A east, B west — press B to buy');
  } else if (G.phase === 'live') {
    hud.setCenter('', '');
  } else if (G.phase === 'round-over') {
    const winner = G.teams[G.roundWinner];
    if (G.matchWinner) {
      hud.setCenter(`${G.teams[G.matchWinner].name} TAKE THE MATCH`, `${G.teams.kestrel.score} — ${G.teams.cinder.score}`);
      matchAgainButton.hidden = false;
      hud.pushKillFeed(`<span class="team-${G.matchWinner}">${G.teams[G.matchWinner].name}</span> win the match`);
    } else {
      hud.setCenter(`${winner.name} TAKE THE ROUND`, `${G.teams.kestrel.score} — ${G.teams.cinder.score}`);
      hud.pushKillFeed(`<span class="team-${winner.id}">${winner.name}</span> secure the round`);
    }
    audio.round();
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Headless/dev path: ?play or #play skips the overlay and the lock so a static screenshot shows the game.
if (window.location.hash === '#play' || window.location.search.indexOf('play') !== -1) {
  startMatch(false);
}

requestAnimationFrame(frame);
