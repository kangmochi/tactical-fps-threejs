// The one game state. Every module reads and writes this object; nothing keeps a
// shadow copy. Round flow, money and the HUD all live here.
export const CONSTANTS = {
  ROUND_TIME: 100,
  FREEZE_TIME: 12,
  ROUND_OVER_PAUSE: 5,
  WIN_TARGET: 4, // best of seven
  STARTING_MONEY: 800,
  MONEY_CAP: 16000,
  ROUND_WIN_BONUS: 3000,
  ROUND_LOSS_BONUS: 1900,
  KILL_BONUS: 300,
  PLANT_BONUS: 800,
  BOMB_FUSE: 40,
  PLANT_TIME: 3.2,
  DEFUSE_TIME: 5.0,
  HEARING_RANGE: 18,
};

export const GOODS = [
  { id: 'vk7', name: 'VK-7', kind: 'Rifle', price: 4200 },
  { id: 'k9', name: 'K9', kind: 'SMG', price: 1250 },
  { id: 'p9', name: 'P9', kind: 'Pistol', price: 200 },
  { id: 'he', name: 'HE Grenade', kind: 'Grenade', price: 300 },
  { id: 'vest', name: 'Kevlar Vest', kind: 'Armour', price: 650 },
  { id: 'helmet', name: 'Kevlar + Riot Helmet', kind: 'Armour', price: 1000 },
];

export const GUN_IDS = ['vk7', 'k9', 'p9'];
export const GUN_MAGS = { vk7: [30, 90], k9: [25, 100], p9: [12, 36] };

export function freshGuns() {
  return {
    vk7: { mag: 30, reserve: 90 },
    k9: { mag: 25, reserve: 100 },
    p9: { mag: 12, reserve: 36 },
  };
}

export const G = {
  phase: 'menu', // menu | freeze | live | round-over
  round: 1,
  playerTeam: 'kestrel',
  teams: {
    kestrel: { id: 'kestrel', name: 'KESTREL', short: 'KST', color: '#1fd3bd', score: 0 },
    cinder: { id: 'cinder', name: 'CINDER', short: 'CND', color: '#ff5a4e', score: 0 },
  },
  money: CONSTANTS.STARTING_MONEY,
  player: { health: 100, armour: 0 },
  owned: { p9: true },
  helmet: false,
  primary: 'p9',
  curWeapon: 'p9', // p9 | vk7 | k9 | knife | he
  guns: freshGuns(),
  grenades: 0,
  reloadT: 0,
  timers: { freeze: 0, round: 0, roundOver: 0 },
  roundWinner: null,
  roundEndReason: '',
  matchWinner: null,
  damageFlash: 0,
  stats: {
    player: { id: 'player', name: 'You', team: 'kestrel', kills: 0, deaths: 0, assists: 0 },
    ally: { id: 'ally', name: 'Kestrel Bot 1', team: 'kestrel', kills: 0, deaths: 0, assists: 0 },
    c1: { id: 'c1', name: 'Cinder Bot 1', team: 'cinder', kills: 0, deaths: 0, assists: 0 },
    c2: { id: 'c2', name: 'Cinder Bot 2', team: 'cinder', kills: 0, deaths: 0, assists: 0 },
  },
};

export function resetMatch() {
  G.round = 1;
  G.teams.kestrel.score = 0;
  G.teams.cinder.score = 0;
  G.money = CONSTANTS.STARTING_MONEY;
  G.roundWinner = null;
  G.roundEndReason = '';
  G.matchWinner = null;
  G.owned = { p9: true };
  G.helmet = false;
  G.primary = 'p9';
  G.curWeapon = 'p9';
  G.guns = freshGuns();
  G.grenades = 0;
  for (const id of Object.keys(G.stats)) {
    G.stats[id].kills = 0;
    G.stats[id].deaths = 0;
    G.stats[id].assists = 0;
  }
  beginFreeze();
}

// A new round starts: health and magazines come back; armour, money and guns are kept.
export function beginFreeze() {
  G.phase = 'freeze';
  G.timers.freeze = CONSTANTS.FREEZE_TIME;
  G.timers.round = CONSTANTS.ROUND_TIME;
  G.timers.roundOver = 0;
  G.roundWinner = null;
  G.roundEndReason = '';
  G.reloadT = 0;
  G.player.health = 100;
  G.curWeapon = G.owned[G.primary] ? G.primary : 'p9';
  for (const id of GUN_IDS) {
    if (G.owned[id]) G.guns[id].mag = GUN_MAGS[id][0];
  }
}

export function beginLive() {
  G.phase = 'live';
  G.timers.round = CONSTANTS.ROUND_TIME;
}

export function endRound(winnerId, reason) {
  G.phase = 'round-over';
  G.roundWinner = winnerId;
  G.roundEndReason = reason || '';
  G.timers.roundOver = 0;
  G.teams[winnerId].score += 1;
  const won = winnerId === G.playerTeam;
  G.money = Math.min(CONSTANTS.MONEY_CAP, G.money + (won ? CONSTANTS.ROUND_WIN_BONUS : CONSTANTS.ROUND_LOSS_BONUS));
  if (G.teams[winnerId].score >= CONSTANTS.WIN_TARGET) G.matchWinner = winnerId;
}

export function awardKillBonus() {
  G.money = Math.min(CONSTANTS.MONEY_CAP, G.money + CONSTANTS.KILL_BONUS);
}

export function awardPlantBonus() {
  G.money = Math.min(CONSTANTS.MONEY_CAP, G.money + CONSTANTS.PLANT_BONUS);
}

// Armour absorbs half of incoming damage until it is gone (kevlar stops bullets).
export function applyDamage(amount) {
  let remaining = amount;
  const armour = G.player.armour;
  if (armour > 0) {
    const absorbed = Math.min(armour, remaining * 0.5);
    G.player.armour -= absorbed;
    remaining -= absorbed;
  }
  G.player.health = Math.max(0, G.player.health - remaining);
  G.damageFlash = Math.min(1, G.damageFlash + remaining / 55 + 0.25);
  return G.player.health;
}

// Buy one item. Returns { ok, reason } so the HUD can explain a refusal.
export function buyGood(id) {
  const item = GOODS.find((g) => g.id === id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (GUN_IDS.includes(id)) {
    if (G.owned[id]) return { ok: false, reason: 'owned' };
  } else if (id === 'he') {
    if (G.grenades >= 2) return { ok: false, reason: 'full' };
  } else if (id === 'vest') {
    if (G.player.armour >= 100) return { ok: false, reason: 'owned' };
  } else if (id === 'helmet') {
    if (G.helmet) return { ok: false, reason: 'owned' };
  }
  if (G.money < item.price) return { ok: false, reason: 'money' };
  G.money -= item.price;
  switch (id) {
    case 'vk7':
    case 'k9':
    case 'p9':
      G.owned[id] = true;
      G.primary = id;
      G.curWeapon = id;
      G.guns[id] = { mag: GUN_MAGS[id][0], reserve: GUN_MAGS[id][1] };
      break;
    case 'he':
      G.grenades += 1;
      break;
    case 'vest':
      G.player.armour = 100;
      break;
    case 'helmet':
      G.helmet = true;
      G.player.armour = 100;
      break;
    default:
      break;
  }
  return { ok: true, reason: '' };
}
