// HUD drawn from the game state each frame. DOM overlay only, no canvas text, and no
// layout built in the frame loop: structure is read once here, text updates are cached.
import { CONSTANTS, GOODS } from './state.js';

export function createHud() {
  const el = {
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
    killfeed: document.getElementById('killfeed'),
    center: document.getElementById('center-msg'),
    centerTitle: document.getElementById('center-title'),
    centerSub: document.getElementById('center-sub'),
    buyMenu: document.getElementById('buy-menu'),
    buyItems: document.getElementById('buy-items'),
    buyMoney: document.getElementById('buy-money'),
    buyNote: document.getElementById('buy-note'),
    scoreboard: document.getElementById('scoreboard'),
    resume: document.getElementById('resume'),
  };

  const cache = { time: '', phase: '', kScore: -1, cScore: -1, round: -1, money: -1, mag: -1, reserve: -1, health: -1, armour: -1, reload: false };
  let hitmarkerTimer = 0;

  function draw(game, dt) {
    // Vignette fades in real time; damageFlash lives in the game state.
    game.damageFlash = Math.max(0, game.damageFlash - dt * 1.15);
    el.vignette.style.opacity = game.damageFlash.toFixed(3);

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
    if (cache.mag !== game.ammo.mag) {
      cache.mag = game.ammo.mag;
      el.ammoMag.textContent = String(cache.mag);
      el.ammoBlock.classList.toggle('empty', cache.mag === 0);
      el.ammoBlock.classList.toggle('low', cache.mag > 0 && cache.mag <= 6);
    }
    if (cache.reserve !== game.ammo.reserve) {
      cache.reserve = game.ammo.reserve;
      el.ammoReserve.textContent = '/ ' + cache.reserve;
    }
    const reloading = game.reloadT > 0;
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
  }

  function markHit() {
    el.hitmarker.classList.add('on');
    window.clearTimeout(hitmarkerTimer);
    hitmarkerTimer = window.setTimeout(() => el.hitmarker.classList.remove('on'), 120);
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

  function setScoreboard(open) {
    el.scoreboard.hidden = !open;
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
    pushKillFeed,
    setCenter,
    setScoreboard,
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
  if (item.id === 'vest') return game.player.armour >= 100;
  if (item.id === 'helmet') return game.loadout.helmet;
  if (item.id === 'ammo') return game.ammo.reserve >= 300;
  if (item.id === 'sidearm' || item.id === 'hornet9' || item.id === 'breach12' || item.id === 'longstride') {
    return game.loadout.primary === item.name;
  }
  return false;
}
