// The round and the bomb. Owns the phase machine (freeze -> live -> round-over), the
// bomb (carry, plant with a 3.2 s hold, 40 s fuse, defuse with a 5 s hold), the money
// flow (+3000 win / +1900 loss / +300 kill / +800 plant, capped) and the stats that
// feed the scoreboard and the kill feed. Banners and sounds go through the HUD and
// the audio it is handed; nothing here draws.
import * as THREE from 'three';
import {
  G, CONSTANTS, beginFreeze, beginLive, endRound, awardKillBonus, awardPlantBonus,
} from './state.js';

export function createRounds({ scene, world, hud, audio, arsenal, onMatchEnd }) {
  // Bomb mesh: a squat cylinder with a blinking tip light. Built once, shown when planted.
  const bombGroup = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.24, 0.34, 10),
    new THREE.MeshStandardMaterial({ color: 0x402f16, roughness: 0.45, metalness: 0.6 }),
  );
  bombBody.position.y = 0.17;
  const bombTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xff3b30, emissiveIntensity: 2 }),
  );
  bombTip.position.y = 0.37;
  const bombLight = new THREE.PointLight(0xff3b30, 0, 6, 1.8);
  bombLight.position.y = 0.6;
  bombGroup.add(bombBody, bombTip, bombLight);
  bombGroup.visible = false;
  scene.add(bombGroup);

  const S = {
    planted: false,
    site: null, // 'A' | 'B'
    timer: 0,
    carrierId: 'player', // 'player' | 'ally'
    plantProgress: 0,
    defuseProgress: 0,
    beepTimer: 0,
    blink: 0,
    detonated: false,
  };

  // Shared view of the bomb for the HUD. Read-only for everyone else.
  G.bombState = { planted: false, site: null, timer: 0, carrierId: 'player', plantProgress: 0, defuseProgress: 0, holding: false, holdLabel: '' };

  function resetBomb() {
    S.planted = false;
    S.site = null;
    S.timer = 0;
    S.carrierId = 'player';
    S.plantProgress = 0;
    S.defuseProgress = 0;
    S.beepTimer = 0;
    S.blink = 0;
    S.detonated = false;
    bombGroup.visible = false;
    bombLight.intensity = 0;
  }

  function syncHudState(holding, holdLabel) {
    G.bombState.planted = S.planted;
    G.bombState.site = S.site;
    G.bombState.timer = Math.max(0, S.timer);
    G.bombState.carrierId = S.carrierId;
    G.bombState.plantProgress = S.plantProgress;
    G.bombState.defuseProgress = S.defuseProgress;
    G.bombState.holding = !!holding;
    G.bombState.holdLabel = holdLabel || '';
  }

  function siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const site = world.sites[key];
      const dx = x - site.x, dz = z - site.z;
      if (dx * dx + dz * dz <= site.radius * site.radius) return key;
    }
    return null;
  }

  function sitePos(key) {
    const site = world.sites[key];
    return { x: site.x, z: site.z };
  }

  function bombDetonate(targets) {
    if (S.detonated) return;
    S.detonated = true;
    const site = sitePos(S.site);
    arsenal.spawnBoom(site.x, 1.2, site.z);
    arsenal.noise(site.x, site.z, 'grenade');
    audio.explode();
    for (const target of targets) {
      if (!target.alive) continue;
      const dx = target.pos.x - site.x, dz = target.pos.z - site.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 9.5) continue;
      const open = world.segmentHit(site.x, 1.2, site.z, target.pos.x, target.pos.y + 1, target.pos.z) < 0;
      const base = 320 * (1 - dist / 9.5) + 30;
      target.takeDamage(open ? base : base * 0.3, 0, null);
    }
    bombGroup.visible = false;
    bombLight.intensity = 0;
    endRound('kestrel', 'BOMB DETONATED');
  }

  // Called by main when any damageable dies. Updates the scoreboard stats and the feed.
  function noteKill(victim, killer, targets) {
    if (G.stats[victim.id]) G.stats[victim.id].deaths += 1;
    if (killer && G.stats[killer.id]) G.stats[killer.id].kills += 1;
    const assister = victim.lastDamagedBy && victim.lastDamagedBy !== killer ? victim.lastDamagedBy : null;
    if (assister && G.stats[assister.id]) G.stats[assister.id].assists += 1;
    if (killer && killer.team === 'kestrel') awardKillBonus();
    const killerName = killer ? killer.name : 'The bomb';
    hud.pushKillFeed(
      `<span class="team-${killer ? killer.team : 'cinder'}">${killerName}</span> ▸ <span class="team-${victim.team}">${victim.name}</span>`,
    );
    arsenal.noise(victim.pos.x, victim.pos.z, 'kill');
  }

  function endForWipe(targets) {
    let kestrelAlive = 0, cinderAlive = 0;
    for (const t of targets) {
      if (!t.alive) continue;
      if (t.team === 'kestrel') kestrelAlive += 1; else cinderAlive += 1;
    }
    if (cinderAlive === 0) return endRound('kestrel', 'ELIMINATION');
    if (kestrelAlive === 0 && !S.planted) return endRound('cinder', 'ELIMINATION');
    return null;
  }

  // One simulation step of the round machine and the bomb. Returns nothing.
  function update(dt, ctx) {
    // ctx: { targets, playerEntity, phaseTime... } — everything live flows through here.
    const targets = ctx.targets;

    if (G.phase === 'freeze') {
      G.timers.freeze -= dt;
      syncHudState(false, '');
      if (G.timers.freeze <= 0) {
        beginLive();
        hud.setCenter('', '');
      }
      return;
    }

    if (G.phase === 'round-over') {
      syncHudState(false, '');
      if (G.matchWinner) return;
      G.timers.roundOver += dt;
      if (G.timers.roundOver >= CONSTANTS.ROUND_OVER_PAUSE) {
        G.round += 1;
        beginFreeze();
        resetBomb();
        ctx.onRoundReset();
        hud.setCenter('FREEZE', 'Plant at a site — hold E  ·  press B to buy');
      }
      return;
    }

    if (G.phase !== 'live') {
      syncHudState(false, '');
      return;
    }

    G.timers.round -= dt;

    // Bomb logic.
    const player = ctx.playerEntity;
    const ally = targets.find((t) => t.id === 'ally');
    if (!S.planted) {
      // Carrier bookkeeping: player carries; if the player dies, the ally picks it up.
      if (S.carrierId === 'player' && player && !player.alive && ally && ally.alive) {
        S.carrierId = 'ally';
        hud.pushKillFeed('<span class="team-kestrel">Kestrel Bot 1</span> takes the bomb');
      } else if (S.carrierId === 'ally' && ally && !ally.alive && player && player.alive) {
        S.carrierId = 'player';
      }
      const carrier = S.carrierId === 'player' ? player : ally;
      if (carrier && carrier.alive) {
        const siteKey = siteAt(carrier.pos.x, carrier.pos.z);
        if (siteKey) {
          const isPlayer = S.carrierId === 'player';
          const wantsPlant = isPlayer ? ctx.holdKey : true;
          if (wantsPlant) {
            S.plantProgress = Math.min(1, S.plantProgress + dt / CONSTANTS.PLANT_TIME);
            if (S.plantProgress >= 1) {
              S.planted = true;
              S.site = siteKey;
              S.timer = CONSTANTS.BOMB_FUSE;
              S.plantProgress = 0;
              const p = sitePos(siteKey);
              bombGroup.position.set(p.x, 0, p.z);
              bombGroup.visible = true;
              bombLight.intensity = 30;
              hud.pushKillFeed(`<span class="team-kestrel">KESTREL</span> plant the bomb at ${siteKey}`);
              audio.plant();
              arsenal.noise(p.x, p.z, 'kill');
              if (isPlayer) awardPlantBonus();
            }
            syncHudState(true, `PLANTING — SITE ${siteKey}`);
            return;
          }
        }
      }
      if (S.plantProgress > 0 && !ctx.holdKey && S.carrierId === 'player') {
        S.plantProgress = Math.max(0, S.plantProgress - dt * 1.5);
      } else if (S.carrierId === 'ally') {
        // Bot planting but not at a site this frame — progress decays.
        S.plantProgress = Math.max(0, S.plantProgress - dt * 0.8);
      }
    } else {
      // Planted: tick the fuse, blink, and let cinder defuse it on site.
      S.timer -= dt;
      S.blink += dt;
      const pulse = (Math.sin(S.blink * (S.timer < 10 ? 14 : 6)) + 1) / 2;
      bombLight.intensity = 8 + pulse * 40;
      bombTip.material.emissiveIntensity = 1 + pulse * 3;

      // Beeps, accelerating as the fuse runs down.
      S.beepTimer -= dt;
      if (S.beepTimer <= 0) {
        audio.beep(S.timer < 10 ? 1250 : 880);
        S.beepTimer = S.timer < 10 ? 0.28 : 0.62;
      }

      const site = world.sites[S.site];
      let defusers = 0;
      for (const t of targets) {
        if (!t.alive || t.team !== 'cinder') continue;
        const dx = t.pos.x - site.x, dz = t.pos.z - site.z;
        if (dx * dx + dz * dz <= site.radius * site.radius) defusers += 1;
      }
      if (defusers > 0) {
        S.defuseProgress = Math.min(1, S.defuseProgress + dt / CONSTANTS.DEFUSE_TIME);
        syncHudState(true, 'CINDER DEFUSING');
        if (S.defuseProgress >= 1) {
          bombGroup.visible = false;
          bombLight.intensity = 0;
          endRound('cinder', 'BOMB DEFUSED');
          return;
        }
      } else {
        S.defuseProgress = Math.max(0, S.defuseProgress - dt / CONSTANTS.DEFUSE_TIME);
        syncHudState(false, '');
      }

      if (S.timer <= 0) {
        syncHudState(false, '');
        bombDetonate(targets);
        return;
      }
    }

    // Clock expiry: the defence holds the yard.
    if (G.timers.round <= 0) {
      G.timers.round = 0;
      endRound('cinder', 'TIME EXPIRED');
      return;
    }

    // Elimination.
    endForWipe(targets);
  }

  // Called from main right after endRound so the banner shows who won and why.
  function announceRoundEnd(matchAgainButton) {
    const winner = G.teams[G.roundWinner];
    if (G.matchWinner) {
      hud.setCenter(
        `${G.teams[G.matchWinner].name} TAKE THE MATCH`,
        `${G.teams.kestrel.score} — ${G.teams.cinder.score}`,
      );
      if (matchAgainButton) matchAgainButton.hidden = false;
      hud.pushKillFeed(`<span class="team-${G.matchWinner}">${G.teams[G.matchWinner].name}</span> win the match`);
    } else {
      hud.setCenter(
        `${winner.name} TAKE THE ROUND`,
        `${G.roundEndReason}${G.roundEndReason ? ' · ' : ''}${G.teams.kestrel.score} — ${G.teams.cinder.score}`,
      );
      hud.pushKillFeed(`<span class="team-${winner.id}">${winner.name}</span> — ${G.roundEndReason.toLowerCase()}`);
    }
    audio.round();
  }

  return {
    update,
    noteKill,
    announceRoundEnd,
    resetBomb,
    // Debug view of the bomb's internals for headless testing; not used by gameplay code.
    state: S,
    // The bots ask this every tick: where should I be? Null when nothing to do.
    objective(bot) {
      if (S.planted) {
        if (bot.team === 'cinder') return sitePos(S.site);
        return null;
      }
      if (S.carrierId === 'ally' && bot.id === 'ally') {
        // Bring it to the nearer site.
        const a = world.sites.A, b = world.sites.B;
        const da = (a.x - bot.pos.x) ** 2 + (a.z - bot.pos.z) ** 2;
        const db = (b.x - bot.pos.x) ** 2 + (b.z - bot.pos.z) ** 2;
        return da <= db ? { x: a.x, z: a.z } : { x: b.x, z: b.z };
      }
      return null;
    },
    get carrierId() { return S.carrierId; },
    get planted() { return S.planted; },
  };
}
