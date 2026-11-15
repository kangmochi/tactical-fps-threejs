// Opponents that move, see, hear and shoot. Bots walk a waypoint graph built from the
// yard's lanes and sites, keep a 100-degree view cone with line-of-sight rays, hear
// gunshots and grenades, stop to aim, fire in bursts, shy away when hurt and reload
// when empty. Fair by design: 0.35-0.55 s reaction (longer when the target re-appears
// from behind cover), an opening burst that usually misses a fresh sighting, and aim
// that tightens only while the bot holds still on target. The headless demo mode
// reuses this to drive the player.
import * as THREE from 'three';
import { WEAPONS, rangeFalloff } from './weapons.js';

const NODES = [
  { id: 's_mid', x: 0, z: 13.5 },
  { id: 's_west', x: -6, z: 14.5 },
  { id: 's_east', x: 6, z: 14.5 },
  { id: 'w_mid', x: -11, z: 11 },
  { id: 'e_mid', x: 11, z: 11 },
  { id: 'choke_w', x: -17.5, z: 0.9 }, // the gaps between the two container pairs
  { id: 'choke_e', x: 17.5, z: 0.9 },
  { id: 'gap_w', x: -13, z: 1.5 }, // south approach to the west gap, clear of the containers
  { id: 'gap_e', x: 13, z: 1.5 },
  { id: 'mid_s', x: 0, z: 2 },
  { id: 'mid_n', x: 0, z: -1.5 },
  { id: 'fount', x: 0, z: -8.6 },
  { id: 'mid_exit', x: 0, z: -11 },
  { id: 'short_a', x: 7, z: -8.4 },
  { id: 'short_b', x: -7, z: -8.4 },
  { id: 'a_conn', x: 14, z: -11 },
  { id: 'b_conn', x: -14, z: -11 },
  { id: 'lane_w', x: -18.0, z: 1.0 },
  { id: 'lane_e', x: 18.0, z: 1.0 },
  { id: 'site_a', x: 23.5, z: -15 },
  { id: 'site_b', x: -23.5, z: -15 },
  { id: 'spawn_c', x: 0, z: -17.5 },
  { id: 'spawn_k', x: 0, z: 17.5 },
];
const NODE_INDEX = new Map(NODES.map((n) => [n.id, n]));
const EDGES = [
  ['s_mid', 's_west'], ['s_mid', 's_east'], ['s_mid', 'mid_s'], ['s_mid', 'spawn_k'],
  ['s_west', 'w_mid'], ['s_east', 'e_mid'],
  ['w_mid', 'gap_w'], ['e_mid', 'gap_e'],
  ['gap_w', 'choke_w'], ['gap_e', 'choke_e'],
  ['choke_w', 'lane_w'], ['choke_e', 'lane_e'],
  ['mid_s', 'mid_n'], ['mid_s', 'spawn_k'],
  ['mid_n', 'fount'],
  ['fount', 'mid_exit'], ['fount', 'short_a'], ['fount', 'short_b'],
  ['short_a', 'a_conn'], ['short_b', 'b_conn'],
  ['a_conn', 'site_a'], ['a_conn', 'lane_e'],
  ['b_conn', 'site_b'], ['b_conn', 'lane_w'],
  ['site_a', 'a_conn'], ['site_b', 'b_conn'],
  ['spawn_c', 'mid_exit'],
];
const ADJ = new Map();
for (const [a, b] of EDGES) {
  if (!ADJ.has(a)) ADJ.set(a, []);
  if (!ADJ.has(b)) ADJ.set(b, []);
  ADJ.get(a).push(b);
  ADJ.get(b).push(a);
}

function nearestNode(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const n of NODES) {
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best.id;
}

// Breadth-first path as a list of node ids from `fromId` to `toId` (excluding the start).
function findPath(fromId, toId) {
  if (fromId === toId) return [];
  const prev = new Map();
  const queue = [fromId];
  prev.set(fromId, null);
  while (queue.length) {
    const cur = queue.shift();
    for (const next of ADJ.get(cur) || []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === toId) {
        const path = [toId];
        let p = cur;
        while (p && p !== fromId) { path.unshift(p); p = prev.get(p); }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

const BOT_DEFS = [
  { id: 'c1', name: 'Cinder Bot 1', team: 'cinder', weapon: 'vk7', role: 'holder',
    route: ['site_a', 'a_conn', 'short_a', 'a_conn'], spawn: { x: -1.5, z: -16.5 } },
  { id: 'c2', name: 'Cinder Bot 2', team: 'cinder', weapon: 'k9', role: 'rotator',
    route: ['mid_exit', 'fount', 'mid_n', 'mid_s'], spawn: { x: 1.5, z: -16.5 } },
  { id: 'ally', name: 'Kestrel Bot 1', team: 'kestrel', weapon: 'k9', role: 'pusher',
    route: ['w_mid', 'gap_w', 'choke_w', 'lane_w', 'b_conn', 'site_b'], spawn: { x: 1.5, z: 17 } },
];

const RADIUS = 0.34;
const EYE = 1.5;
const STAND_HEIGHT = 1.72;
const SIGHT_RANGE = 42;
const CONE_COS = Math.cos((100 / 2) * Math.PI / 180);
const TURN_RATE = 3.1;
const MOVE_SPEED = 3.35;
const RETREAT_SPEED = 4.15;
// Reaction to a fresh sighting: floor of REACT_MIN seconds, growing with distance up to
// REACT_MIN + REACT_SPAN, plus REACT_COVER when the target was hidden moments ago.
const REACT_MIN = 0.35;
const REACT_SPAN = 0.20;
const REACT_RANGE = 40;
const REACT_COVER = 0.22;
// Aim error: wide for CORNER_TIME seconds after a fresh acquisition (a bot that just
// turned a corner misses the opening burst), tightening only while the bot holds still.
const CORNER_TIME = 0.7;
const CORNER_PENALTY = 0.30;
const AIM_STILL_TIGHTEN = 0.12;
const AIM_STILL_RATE = 0.09;
// Break off and reposition below this health instead of standing and trading.
const LOW_HP = 40;

export function createBots(scene, world, arsenal, opts = {}) {
  const callout = opts.callout || (() => {});
  const noises = [];
  arsenal.setNoiseListener((x, z, type) => {
    noises.push({ x, z, type });
    if (type === 'grenade') callout('Grenade out!');
    else if (type === 'kill') callout('Man down!');
  });

  const torsoGeo = new THREE.CylinderGeometry(0.27, 0.31, 0.78, 10);
  const headGeo = new THREE.SphereGeometry(0.165, 10, 8);
  const shoulderGeo = new THREE.BoxGeometry(0.72, 0.14, 0.3);
  const stripeGeo = new THREE.BoxGeometry(0.3, 0.07, 0.02);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.62);
  const legGeo = new THREE.BoxGeometry(0.24, 0.72, 0.24);

  const bots = [];

  for (const def of BOT_DEFS) {
    const cinder = def.team === 'cinder';
    const bodyMat = new THREE.MeshStandardMaterial({ color: cinder ? 0x3a2320 : 0x1f2f33, roughness: 0.75, metalness: 0.15 });
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.6, metalness: 0.35 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x0e141b, emissive: cinder ? 0xff5a4e : 0x1fd3bd, emissiveIntensity: 1.6, roughness: 0.4 });

    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 0.99;
    torso.castShadow = true;
    const head = new THREE.Mesh(headGeo, gearMat);
    head.position.y = 1.52;
    head.castShadow = true;
    const shoulders = new THREE.Mesh(shoulderGeo, gearMat);
    shoulders.position.y = 1.34;
    const stripe = new THREE.Mesh(stripeGeo, glowMat);
    stripe.position.set(0, 1.06, 0.285);
    const legL = new THREE.Mesh(legGeo, gearMat);
    legL.position.set(-0.15, 0.36, 0);
    const legR = new THREE.Mesh(legGeo, gearMat);
    legR.position.set(0.15, 0.36, 0);
    const gun = new THREE.Mesh(gunGeo, gearMat);
    gun.position.set(0.3, 1.12, 0.32);
    group.add(torso, head, shoulders, stripe, legL, legR, gun);
    group.position.set(def.spawn.x, 0, def.spawn.z);
    scene.add(group);

    const weapon = WEAPONS[def.weapon];
    bots.push({
      id: def.id, name: def.name, team: def.team, role: def.role,
      kind: 'bot',
      pos: group.position, group,
      yaw: cinder ? Math.PI : 0, // face the enemy side
      health: 100, armour: 50, height: STAND_HEIGHT, radius: RADIUS,
      alive: true,
      weaponId: def.weapon,
      mag: weapon.mag, reserve: weapon.reserve,
      reloadT: 0,
      fireCd: 0, burstLeft: 0, burstCd: 0,
      route: def.route.slice(), routeIdx: 0,
      forcedPath: null, forcedIdx: 0,
      visibleTarget: null, lastSeenX: 0, lastSeenZ: 0, lostTime: 0, reactAt: 0,
      aimStill: 0, acquireAt: -10,
      lastAttacker: null, lastDamagedAt: -99,
      retreatUntil: 0,
      strafeDir: 1, strafeTimer: 0,
      stuckTime: 0, lastX: def.spawn.x, lastZ: def.spawn.z, nudgeTimer: 0,
      heardAt: 0, heardYaw: 0, objectiveKey: null,
      eyeY: EYE,
      takeDamage(dmg, part, attacker) {
        let remaining = dmg;
        if (this.armour > 0) {
          const absorbed = Math.min(this.armour, remaining * 0.5);
          this.armour -= absorbed;
          remaining -= absorbed;
        }
        this.health = Math.max(0, this.health - remaining);
        this.lastAttacker = attacker || this.lastAttacker;
        this.lastDamagedAt = perfNow();
        if (this.health <= 0) {
          this.alive = false;
          this.group.visible = false;
        }
        return this.health;
      },
    });
  }

  function perfNow() { return performance.now() / 1000; }

  // Respawn for a new round.
  function resetForRound() {
    for (const def of BOT_DEFS) {
      const bot = bots.find((b) => b.id === def.id);
      bot.pos.set(def.spawn.x, 0, def.spawn.z);
      bot.yaw = def.team === 'cinder' ? Math.PI : 0;
      bot.health = 100;
      bot.armour = 50;
      bot.alive = true;
      bot.group.visible = true;
      const weapon = WEAPONS[bot.weaponId];
      bot.mag = weapon.mag;
      bot.reserve = weapon.reserve;
      bot.reloadT = 0;
      bot.fireCd = 0;
      bot.burstLeft = 0;
      bot.burstCd = 0;
      bot.routeIdx = 0;
      bot.forcedPath = null;
      bot.visibleTarget = null;
      bot.lastAttacker = null;
      bot.retreatUntil = 0;
      bot.stuckTime = 0;
      bot.objectiveKey = null;
      bot.heardAt = 0;
      bot.aimStill = 0;
      bot.acquireAt = -10;
    }
  }

  // Steer one bot: aim, move along its route (or a forced path), avoid walls.
  function moveBot(bot, desiredYaw, speed, dt) {
    let dy = desiredYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turn = Math.sign(dy) * Math.min(Math.abs(dy), TURN_RATE * dt);
    bot.yaw += turn;

    if (speed <= 0) return;
    const forwardX = -Math.sin(bot.yaw);
    const forwardZ = -Math.cos(bot.yaw);
    let mx = forwardX * speed;
    let mz = forwardZ * speed;
    // Sidestep while in combat so bots are not sitting ducks, set by think().
    if (bot.strafeTimer > 0) {
      bot.strafeTimer -= dt;
      mx += Math.cos(bot.yaw) * bot.strafeDir * speed * 0.45;
      mz += -Math.sin(bot.yaw) * bot.strafeDir * speed * 0.45;
    }
    const px = bot.pos.x + mx * dt;
    const pz = bot.pos.z + mz * dt;
    resolveMove(bot, px, pz);
  }

  const probe = new THREE.Box3();
  function resolveMove(bot, nextX, nextZ) {
    const r = RADIUS;
    const h = STAND_HEIGHT;
    // X axis
    probe.min.set(nextX - r, 0.05, bot.pos.z - r);
    probe.max.set(nextX + r, h - 0.02, bot.pos.z + r);
    let blocked = false;
    for (const c of world.colliders) if (probe.intersectsBox(c)) { blocked = true; break; }
    if (!blocked) bot.pos.x = nextX;
    // Z axis
    probe.min.set(bot.pos.x - r, 0.05, nextZ - r);
    probe.max.set(bot.pos.x + r, h - 0.02, nextZ + r);
    blocked = false;
    for (const c of world.colliders) if (probe.intersectsBox(c)) { blocked = true; break; }
    if (!blocked) bot.pos.z = nextZ;
    bot.group.position.copy(bot.pos);
    bot.group.rotation.y = bot.yaw;
  }

  function targetVisible(bot, target) {
    const dx = target.pos.x - bot.pos.x;
    const dz = target.pos.z - bot.pos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > SIGHT_RANGE * SIGHT_RANGE) return null;
    const dist = Math.sqrt(distSq);
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    const dot = (fx * dx + fz * dz) / Math.max(0.0001, dist);
    // The 100-degree cone applies at mid range; point-blank is always seen.
    if (dist > 3.5 && dot < CONE_COS) return null;
    const eyeX = bot.pos.x, eyeY = bot.pos.y + EYE, eyeZ = bot.pos.z;
    const aimY = target.pos.y + (target.height || 1.7) * 0.6;
    if (world.segmentHit(eyeX, eyeY, eyeZ, target.pos.x, aimY, target.pos.z) >= 0) return null;
    return { dist };
  }

  function leadDirection(bot, target, out) {
    const dx = target.pos.x - bot.pos.x;
    const dz = target.pos.z - bot.pos.z;
    const dy = target.pos.y + (target.height || 1.7) * 0.6 - (bot.pos.y + EYE);
    const dist = Math.hypot(dx, dz) || 0.001;
    out.set(dx / dist, dy / dist, dz / dist).normalize();
    return out;
  }

  const _dir = new THREE.Vector3();

  // One bot shot. `now` is the simulation clock, needed for the corner and stillness curves.
  function botFire(bot, target, now) {
    const weapon = WEAPONS[bot.weaponId];
    if (bot.reloadT > 0 || bot.mag <= 0) return;
    bot.mag -= 1;
    bot.fireCd = weapon.interval;

    const dist = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
    const movingX = target.velocityX || 0, movingZ = target.velocityZ || 0;
    const moving = movingX * movingX + movingZ * movingZ > 0.36;
    // Wide for the first moments after a fresh sighting, tightening once the bot holds still.
    const sinceAcquire = now - bot.acquireAt;
    let pHit = 0.60 - dist * 0.012 - (moving ? 0.20 : 0);
    if (sinceAcquire < CORNER_TIME) pHit -= CORNER_PENALTY * (1 - sinceAcquire / CORNER_TIME);
    pHit += Math.min(AIM_STILL_TIGHTEN, bot.aimStill * AIM_STILL_RATE);
    if (target.crouching) pHit -= 0.12;
    pHit = Math.max(0.06, Math.min(0.58, pHit));
    const fromX = bot.pos.x + Math.cos(bot.yaw) * 0.18;
    const fromY = bot.pos.y + 1.28;
    const fromZ = bot.pos.z - Math.sin(bot.yaw) * 0.18;
    leadDirection(bot, target, _dir);

    if (Math.random() < pHit) {
      // Part roll: mostly torso, sometimes the head, sometimes the legs.
      const roll = Math.random();
      const partCode = roll < 0.16 ? 1 : roll < 0.78 ? 0 : 2; // head=1, torso=0, legs=2
      const falloff = rangeFalloff(weapon, dist);
      const dmg = weapon.damage * (partCode === 1 ? weapon.headMult : partCode === 2 ? 0.75 : 1) * falloff;
      arsenal.spawnTracer(fromX, fromY, fromZ, target.pos.x, target.pos.y + (target.height || 1.7) * 0.6, target.pos.z);
      arsenal.noise(bot.pos.x, bot.pos.z, 'shot');
      target.takeDamage(dmg, partCode, bot);
      arsenal.spawnSpark(target.pos.x, target.pos.y + (target.height || 1.7) * 0.6, target.pos.z, false);
    } else {
      // Miss: punch the tracer past the target with a plausible offset.
      const miss = 0.9 + Math.random() * 1.6;
      const ox = (Math.random() - 0.5) * miss * 2;
      const oy = (Math.random() - 0.2) * miss;
      const oz = (Math.random() - 0.5) * miss * 2;
      arsenal.spawnTracer(fromX, fromY, fromZ, target.pos.x + ox, target.pos.y + 1.1 + oy, target.pos.z + oz);
      arsenal.noise(bot.pos.x, bot.pos.z, 'shot');
    }
  }

  // One think+act tick for a bot. entities: every damageable (player + bots). phase from rounds.
  function update(bot, dt, ctx) {
    if (!bot.alive) return;
    const now = ctx.time;
    const phase = ctx.phase;

    // React to the newest noise: face it; gunfire and blasts make them check angles.
    for (const n of noises) {
      const dx = n.x - bot.pos.x, dz = n.z - bot.pos.z;
      if (dx * dx + dz * dz > 18 * 18) continue;
      if (n.type === 'shot' || n.type === 'grenade' || n.type === 'bounce') {
        bot.heardYaw = Math.atan2(-dx, -dz);
        bot.heardAt = now;
      }
    }
    noises.length = 0;

    // Pick the most dangerous visible enemy.
    let target = null;
    let bestDist = Infinity;
    for (const other of ctx.targets) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const vis = targetVisible(bot, other);
      if (vis && vis.dist < bestDist) { bestDist = vis.dist; target = other; }
    }

    if (target) {
      if (bot.visibleTarget !== target) {
        const coverBonus = bot.lostTime > 0.25 ? REACT_COVER : 0; // it was behind cover
        bot.reactAt = now + Math.min(0.55, REACT_MIN + (bestDist / REACT_RANGE) * REACT_SPAN + coverBonus);
        bot.acquireAt = now;
        bot.aimStill = 0;
      }
      bot.visibleTarget = target;
      bot.lastSeenX = target.pos.x;
      bot.lastSeenZ = target.pos.z;
      bot.lostTime = 0;
    } else if (bot.visibleTarget) {
      bot.lostTime += dt;
      if (bot.lostTime > 1.4) bot.visibleTarget = null;
    }

    const inCombat = !!target;
    const lowHealth = bot.health < LOW_HP;

    // Weapon upkeep.
    if (bot.reloadT > 0) bot.reloadT -= dt;
    if (bot.fireCd > 0) bot.fireCd -= dt;
    if (bot.burstCd > 0) bot.burstCd -= dt;

    let desiredYaw = null;
    let speed = MOVE_SPEED;

    if (inCombat) {
      // Face the threat; hold at aim-ready range and strafe so it is not a standing duck.
      desiredYaw = Math.atan2(-(target.pos.x - bot.pos.x), -(target.pos.z - bot.pos.z));
      speed = bestDist > 7 ? MOVE_SPEED * 0.35 : 0; // creep in at range, stand to aim up close
      if (speed === 0) bot.aimStill += dt; // held still on target: aim settles gradually
      else bot.aimStill = 0;
      if (lowHealth) {
        // Hurt: break off and reposition instead of standing and trading.
        bot.retreatUntil = now + 3.2;
        bot.visibleTarget = null;
        bot.aimStill = 0;
      } else {
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeDir = -bot.strafeDir;
          bot.strafeTimer = 1.1 + Math.random() * 1.3;
        }
        // Fire 3-5 round bursts once the reaction delay has passed, then hold fire.
        if (phase === 'live' && bot.reloadT <= 0 && now >= bot.reactAt) {
          if (bot.mag <= 0) {
            bot.reloadT = WEAPONS[bot.weaponId].reload;
            bot.burstLeft = 0;
          } else if (bot.burstCd <= 0 && bot.fireCd <= 0) {
            if (bot.burstLeft <= 0) bot.burstLeft = 3 + Math.floor(Math.random() * 3);
            botFire(bot, target, now);
            bot.burstLeft -= 1;
            if (bot.burstLeft <= 0) bot.burstCd = 0.30 + Math.random() * 0.30;
          }
        }
      }
    } else if (bot.retreatUntil > now && bot.lastAttacker && bot.lastAttacker.alive) {
      // Fall back directly away from the shooter.
      desiredYaw = Math.atan2(-(bot.pos.x - bot.lastAttacker.pos.x), -(bot.pos.z - bot.lastAttacker.pos.z));
      speed = RETREAT_SPEED;
    } else if (bot.visibleTarget && bot.lostTime <= 1.4) {
      // Lost sight briefly: push to the last seen spot.
      desiredYaw = Math.atan2(-(bot.lastSeenX - bot.pos.x), -(bot.lastSeenZ - bot.pos.z));
      speed = MOVE_SPEED * 0.9;
    } else if (bot.heardAt && now - bot.heardAt < 2.6) {
      desiredYaw = bot.heardYaw;
      speed = MOVE_SPEED * 0.85;
    } else {
      // Objective: cinder rushes the planted bomb to defuse; attackers plant it.
      const objective = ctx.objective ? ctx.objective(bot) : null;
      const objKey = objective ? objective.x + ',' + objective.z : null;
      if (objKey && bot.objectiveKey !== objKey) {
        bot.objectiveKey = objKey;
        const from = nearestNode(bot.pos.x, bot.pos.z);
        const to = nearestNode(objective.x, objective.z);
        bot.forcedPath = findPath(from, to) || [];
        bot.forcedIdx = 0;
      } else if (!objKey) {
        bot.objectiveKey = null;
      }
      let nodeId = null;
      if (bot.forcedPath && bot.forcedIdx < bot.forcedPath.length) {
        nodeId = bot.forcedPath[bot.forcedIdx];
      } else if (!objective) {
        nodeId = bot.route[bot.routeIdx];
      }
      if (nodeId) {
        const node = NODE_INDEX.get(nodeId);
        const dx = node.x - bot.pos.x, dz = node.z - bot.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.15) {
          if (bot.forcedPath && bot.forcedIdx < bot.forcedPath.length) bot.forcedIdx += 1;
          else bot.routeIdx = (bot.routeIdx + 1) % bot.route.length;
        }
        desiredYaw = Math.atan2(-dx, -dz);
        speed = MOVE_SPEED;
      } else if (objective) {
        // Standing on the objective already (or the path collapsed to zero hops):
        // close the last metres straight in, then hold and defuse.
        const dx = objective.x - bot.pos.x, dz = objective.z - bot.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1.6) {
          desiredYaw = Math.atan2(-dx, -dz);
          speed = MOVE_SPEED;
        } else {
          speed = 0; // hold; rounds.js defuses while a cinder bot is on site
        }
      }
    }

    if (bot.reloadT <= 0 && bot.mag === 0 && bot.reserve > 0) {
      bot.reloadT = WEAPONS[bot.weaponId].reload;
      bot.burstLeft = 0;
    }
    if (bot.reloadT > 0 && bot.reloadT <= dt + 1 / 60) {
      const need = WEAPONS[bot.weaponId].mag - bot.mag;
      const take = Math.min(need, bot.reserve);
      bot.mag += take;
      bot.reserve -= take;
    }

    // Stuck? Slide sideways for a moment.
    bot.stuckTime += dt;
    if (bot.stuckTime > 0.6) {
      const moved = Math.hypot(bot.pos.x - bot.lastX, bot.pos.z - bot.lastZ);
      if (moved < 0.08 && speed > 0) {
        bot.strafeDir = -bot.strafeDir;
        bot.strafeTimer = 1.3; // commit to the sidestep so it actually clears corners
      }
      bot.lastX = bot.pos.x; bot.lastZ = bot.pos.z;
      bot.stuckTime = 0;
    }

    if (phase !== 'live') speed = 0;
    if (desiredYaw !== null) moveBot(bot, desiredYaw, speed, dt);
    else bot.group.rotation.y = bot.yaw;
  }

  return { bots, resetForRound, update };
}
