// HUD drawn from the game state each frame. DOM overlay only, no canvas text, and no
// layout built in the frame loop: structure is read once here, text updates are cached.
import { CONSTANTS, GOODS } from './state.js';
import { WEAPONS } from './weapons.js';

export function createHud() {
  const el = {
    weaponName: document.getElementById('weapon-name'),
    health: document.getElementById('hud-health'),
    healthBar: document.getElementById('hud-health-bar'),
    armour: document.getElementById('hud-armour'),
    armourBar: document.getElementById('hud-armour-bar'),
    money: document.getElementById('hud-money'),
    ammoBlock: document.getElementById('ammo'),
    ammoMag: document.getElementById('ammo-mag'),
    ammoReserve: document.getElementById('ammo-reserve'),
    reloadLabel: document.getElementById('reload-label'),
    timerBlock: document.getElementById('timer'),
    timerTime: document.getElementById('timer-time'),
    timerPhase: document.getElementById('timer-phase'),
    roundNumber: document.getElementById('round-number'),
    scoreKestrel: document.getElementById('score-kestrel'),
    scoreCinder: document.getElementById('score-cinder'),
    vignette: document.getElementById('vignette'),
    hitmarker: document.getElementById('hitmarker'),
    crosshair: document.getElementById('crosshair'),
    killfeed: document.getElementById('killfeed'),
    center: document.getElementById('center-msg'),
    centerTitle: document.getElementById('center-title'),
    centerSub: document.getElementById('center-sub'),
    buyMenu: document.getElementById('buy-menu'),
    buyItems: document.getElementById('buy-items'),
    buyMoney: document.getElementById('buy-money'),
    buyNote: document.getElementById('buy-note'),
    scoreboard: document.getElementById('scoreboard'),
    sbRound: document.getElementById('sb-round'),
    sbKestrelRows: document.getElementById('sb-kestrel-rows'),
    sbCinderRows: document.getElementById('sb-cinder-rows'),
    sbKestrelScore: document.getElementById('sb-kestrel-score'),
    sbCinderScore: document.getElementById('sb-cinder-score'),
    bombStatus: document.getElementById('bomb-status'),
    bombText: document.getElementById('bomb-text'),
    holdWrap: document.getElementById('hold-wrap'),
    holdLabel: document.getElementById('hold-label'),
    holdFill: document.getElementById('hold-fill'),
    resume: document.getElementById('resume'),
  };

  const cache = {
    time: '', phase: '', kScore: -1, cScore: -1, round: -1, money: -1,
    mag: -1, reserve: -1, health: -1, armour: -1, reload: false,
    weapon: '', bomb: '', hold: -1, spread: -1,
  };
  let hitmarkerTimer = 0;

  function isGun(id) {
    return id === 'vk7' || id === 'k9' || id === 'p9';
  }

  function draw(game, dt, spreadPx) {
    // Vignette fades in real time; damageFlash lives in the game state.
    game.damageFlash = Math.max(0, game.damageFlash - dt * 1.15);
    el.vignette.style.opacity = game.damageFlash.toFixed(3);

    // Dynamic crosshair: the gap follows the live spread in pixels.
    if (spreadPx !== undefined && Math.abs(spreadPx - cache.spread) > 0.4) {
      cache.spread = spreadPx;
      el.crosshair.style.setProperty('--gap', spreadPx.toFixed(1) + 'px');
    }

    if (cache.health !== (game.player.health | 0)) {
      cache.health = game.player.health | 0;
      el.health.textContent = String(cache.health);
      el.healthBar.style.transform = `scaleX(${cache.health / 100})`;
      el.healthBar.classList.toggle('low', cache.health <= 30);
    }
    if (cache.armour !== (game.player.armour | 0)) {
      cache.armour = game.player.armour | 0;
      el.armour.textContent = String(cache.armour);
      el.armourBar.style.transform = `scaleX(${cache.armour / 100})`;
    }
    if (cache.money !== game.money) {
      cache.money = game.money;
      el.money.textContent = '$' + game.money.toLocaleString('en-US');
    }

    // Weapon name + ammo readout.
    const gun = isGun(game.curWeapon);
    const mag = gun ? game.guns[game.curWeapon].mag : -1;
    const reserve = gun ? game.guns[game.curWeapon].reserve : -1;
    if (cache.weapon !== game.curWeapon + ':' + game.grenades) {
      cache.weapon = game.curWeapon + ':' + game.grenades;
      if (gun) el.weaponName.textContent = WEAPONS[game.curWeapon].name;
      else if (game.curWeapon === 'knife') el.weaponName.textContent = 'KNIFE';
      else el.weaponName.textContent = 'HE GRENADE ×' + game.grenades;
    }
    if (cache.mag !== mag) {
      cache.mag = mag;
      el.ammoMag.textContent = mag >= 0 ? String(mag) : '—';
      el.ammoBlock.classList.toggle('empty', mag === 0);
      el.ammoBlock.classList.toggle('low', mag > 0 && mag <= 6);
    }
    if (cache.reserve !== reserve) {
      cache.reserve = reserve;
      el.ammoReserve.textContent = reserve >= 0 ? '/ ' + reserve : '';
    }
    const reloading = gun && game.reloadT > 0;
    if (cache.reload !== reloading) {
      cache.reload = reloading;
      el.reloadLabel.hidden = !reloading;
    }

    // Timer: MM:SS of whatever phase is running.
    let seconds;
    let phaseLabel;
    if (game.phase === 'freeze') {
      seconds = Math.ceil(game.timers.freeze);
      phaseLabel = 'BUY PHASE';
    } else if (game.phase === 'live') {
      seconds = Math.ceil(game.timers.round);
      phaseLabel = 'LIVE';
    } else if (game.phase === 'round-over') {
      seconds = Math.ceil(Math.max(0, CONSTANTS.ROUND_OVER_PAUSE - game.timers.roundOver));
      phaseLabel = 'ROUND OVER';
    } else {
      seconds = 0;
      phaseLabel = 'STANDBY';
    }
    const time = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    if (cache.time !== time) {
      cache.time = time;
      el.timerTime.textContent = time;
      el.timerBlock.classList.toggle('critical', game.phase === 'live' && seconds <= 10);
    }
    if (cache.phase !== phaseLabel) {
      cache.phase = phaseLabel;
      el.timerPhase.textContent = phaseLabel;
    }
    if (cache.round !== game.round) {
      cache.round = game.round;
      el.roundNumber.textContent = 'ROUND ' + cache.round;
    }
    if (cache.kScore !== game.teams.kestrel.score) {
      cache.kScore = game.teams.kestrel.score;
      el.scoreKestrel.textContent = String(cache.kScore);
    }
    if (cache.cScore !== game.teams.cinder.score) {
      cache.cScore = game.teams.cinder.score;
      el.scoreCinder.textContent = String(cache.cScore);
    }

    // Bomb chip under the timer.
    const bomb = game.bombState;
    if (bomb && bomb.planted) {
      const bs = Math.ceil(bomb.timer);
      const label = 'BOMB · SITE ' + bomb.site + ' · 0:' + String(Math.max(0, bs)).padStart(2, '0');
      if (cache.bomb !== label) {
        cache.bomb = label;
        el.bombText.textContent = label;
        el.bombStatus.hidden = false;
        el.bombStatus.classList.toggle('critical', bs <= 10);
      }
    } else if (cache.bomb !== '') {
      cache.bomb = '';
      el.bombStatus.hidden = true;
    }

    // Hold-to-plant / defuse progress bar.
    const holding = bomb && bomb.holding;
    const progress = bomb ? Math.max(bomb.plantProgress, bomb.defuseProgress) : 0;
    if (holding) {
      const pct = Math.round(progress * 200); // half-percent resolution
      if (cache.hold !== pct || el.holdLabel.textContent !== bomb.holdLabel) {
        cache.hold = pct;
        el.holdWrap.hidden = false;
        el.holdLabel.textContent = bomb.holdLabel;
        el.holdFill.style.transform = `scaleX(${progress})`;
      }
    } else if (cache.hold !== -1) {
      cache.hold = -1;
      el.holdWrap.hidden = true;
    }
  }

  function markHit() {
    el.hitmarker.classList.add('on');
    window.clearTimeout(hitmarkerTimer);
    hitmarkerTimer = window.setTimeout(() => el.hitmarker.classList.remove('on'), 120);
  }

  function markKill() {
    el.hitmarker.classList.add('kill');
    window.clearTimeout(hitmarkerTimer);
    hitmarkerTimer = window.setTimeout(() => el.hitmarker.classList.remove('kill', 'on'), 200);
  }

  function pushKillFeed(html) {
    const entry = document.createElement('div');
    entry.className = 'kf-entry';
    entry.innerHTML = html;
    el.killfeed.prepend(entry);
    while (el.killfeed.children.length > 4) el.killfeed.lastChild.remove();
    window.setTimeout(() => entry.remove(), 5000);
  }

  function setCenter(title, sub) {
    el.centerTitle.textContent = title;
    el.centerSub.textContent = sub || '';
    el.center.hidden = !title;
  }

  function setScoreboard(open, game) {
    el.scoreboard.hidden = !open;
    if (open && game) refreshScoreboard(game);
  }

  // Rebuild the two team tables from G.stats. Called on open and after every kill.
  function refreshScoreboard(game) {
    el.sbRound.textContent = 'HALDEN YARD · FIRST TO ' + CONSTANTS.WIN_TARGET;
    el.sbKestrelScore.textContent = String(game.teams.kestrel.score);
    el.sbCinderScore.textContent = String(game.teams.cinder.score);
    el.sbKestrelRows.innerHTML = buildRows(game, 'kestrel');
    el.sbCinderRows.innerHTML = buildRows(game, 'cinder');
  }

  function buildRows(game, team) {
    let html = '';
    for (const id of Object.keys(game.stats)) {
      const row = game.stats[id];
      if (row.team !== team) continue;
      const you = row.id === 'player';
      html += `<tr><td class="${you ? 'sb-you' : ''}">${row.name}</td>` +
        `<td>${row.kills}</td><td>${row.deaths}</td><td>${row.assists}</td></tr>`;
    }
    return html;
  }

  function setBuyMenu(open, game) {
    el.buyMenu.hidden = !open;
    if (open) renderBuy(game);
  }

  function renderBuy(game) {
    el.buyMoney.textContent = '$' + game.money.toLocaleString('en-US');
    el.buyNote.textContent = '';
    let html = '';
    for (const item of GOODS) {
      const owned = isOwned(game, item);
      const affordable = game.money >= item.price;
      const state = owned ? 'OWNED' : (affordable ? '' : 'NO FUNDS');
      html += `<li class="buy-item${affordable || owned ? '' : ' broke'}">` +
        `<span class="buy-kind">${item.kind}</span>` +
        `<span class="buy-name">${item.name}</span>` +
        `<span class="buy-state">${state}</span>` +
        `<button type="button" class="buy-button" data-id="${item.id}" ${owned ? 'disabled' : ''}>` +
        `$${item.price.toLocaleString('en-US')}</button></li>`;
    }
    el.buyItems.innerHTML = html;
  }

  function buyNote(text) {
    el.buyNote.textContent = text || '';
  }

  return {
    draw,
    markHit,
    markKill,
    pushKillFeed,
    setCenter,
    setScoreboard,
    refreshScoreboard,
    setBuyMenu,
    renderBuy,
    buyNote,
    onBuyClick(handler) {
      el.buyItems.addEventListener('click', (event) => {
        const button = event.target.closest('.buy-button');
        if (button && !button.disabled) handler(button.dataset.id);
      });
    },
    elements: el,
  };
}

function isOwned(game, item) {
  if (item.id === 'vk7' || item.id === 'k9' || item.id === 'p9') return !!game.owned[item.id];
  if (item.id === 'he') return game.grenades >= 2;
  if (item.id === 'vest') return game.player.armour >= 100;
  if (item.id === 'helmet') return game.helmet;
  return false;
}
