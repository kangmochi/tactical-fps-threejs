// The one game state. Every module reads and writes this object; nothing keeps a
// shadow copy. Round flow, money and the HUD all live here.
export const CONSTANTS = {
  ROUND_TIME: 100,
  FREEZE_TIME: 12,
  ROUND_OVER_PAUSE: 4,
  WIN_TARGET: 13,
  STARTING_MONEY: 800,
  MONEY_CAP: 16000,
  ROUND_WIN_BONUS: 3250,
  ROUND_LOSS_BONUS: 1900,
  RELOAD_TIME: 1.9,
  MAG_SIZE: 30,
  RESERVE_START: 120,
};

export const GOODS = [
  { id: 'sidearm', name: 'K-77 Sidearm', kind: 'Sidearm', price: 300 },
  { id: 'hornet9', name: 'Hornet 9', kind: 'SMG', price: 1250 },
  { id: 'breach12', name: 'Breach-12', kind: 'Shotgun', price: 1100 },
  { id: 'longstride', name: 'Longstride-4', kind: 'Rifle', price: 4200 },
  { id: 'vest', name: 'Kevlar Vest', kind: 'Armour', price: 650 },
  { id: 'helmet', name: 'Kevlar + Riot Helmet', kind: 'Armour', price: 1000 },
  { id: 'ammo', name: 'Ammo Pack', kind: 'Supply', price: 200 },
];

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
  ammo: { mag: CONSTANTS.MAG_SIZE, reserve: CONSTANTS.RESERVE_START, magSize: CONSTANTS.MAG_SIZE },
  loadout: { primary: 'K-77 Sidearm', vest: false, helmet: false },
  reloadT: 0,
  timers: { freeze: 0, round: 0, roundOver: 0 },
  roundWinner: null,
  matchWinner: null,
  damageFlash: 0,
};

export function resetMatch() {
  G.round = 1;
  G.teams.kestrel.score = 0;
  G.teams.cinder.score = 0;
  G.money = CONSTANTS.STARTING_MONEY;
  G.roundWinner = null;
  G.matchWinner = null;
  G.loadout.primary = 'K-77 Sidearm';
  G.loadout.vest = false;
  G.loadout.helmet = false;
  beginFreeze();
}

// A new round starts: health, magazine and the freeze clock come back; armour is kept.
export function beginFreeze() {
  G.phase = 'freeze';
  G.timers.freeze = CONSTANTS.FREEZE_TIME;
  G.timers.round = CONSTANTS.ROUND_TIME;
  G.timers.roundOver = 0;
  G.roundWinner = null;
  G.reloadT = 0;
  G.player.health = 100;
  G.ammo.mag = G.ammo.magSize;
}

export function beginLive() {
  G.phase = 'live';
  G.timers.round = CONSTANTS.ROUND_TIME;
}

export function endRound(winnerId) {
  G.phase = 'round-over';
  G.roundWinner = winnerId;
  G.timers.roundOver = 0;
  G.teams[winnerId].score += 1;
  const won = winnerId === G.playerTeam;
  G.money = Math.min(CONSTANTS.MONEY_CAP, G.money + (won ? CONSTANTS.ROUND_WIN_BONUS : CONSTANTS.ROUND_LOSS_BONUS));
  if (G.teams[winnerId].score >= CONSTANTS.WIN_TARGET) G.matchWinner = winnerId;
}

// Armour absorbs half of incoming damage until it is gone (kevlar stops bullets, helmets do not).
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

export function startReload() {
  if (G.reloadT > 0) return false;
  if (G.ammo.mag >= G.ammo.magSize) return false;
  if (G.ammo.reserve <= 0) return false;
  G.reloadT = CONSTANTS.RELOAD_TIME;
  return true;
}

export function tickReload(dt) {
  if (G.reloadT <= 0) return;
  G.reloadT -= dt;
  if (G.reloadT > 0) return;
  G.reloadT = 0;
  const need = G.ammo.magSize - G.ammo.mag;
  const take = Math.min(need, G.ammo.reserve);
  G.ammo.mag += take;
  G.ammo.reserve -= take;
}

// Buy one item. Returns { ok, reason } so the HUD can explain a refusal.
export function buyGood(id) {
  const item = GOODS.find((g) => g.id === id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (id === 'vest' && G.player.armour >= 100) return { ok: false, reason: 'owned' };
  if (id === 'helmet' && G.loadout.helmet) return { ok: false, reason: 'owned' };
  if (id === 'ammo' && G.ammo.reserve >= 300) return { ok: false, reason: 'full' };
  if (G.money < item.price) return { ok: false, reason: 'money' };
  G.money -= item.price;
  switch (id) {
    case 'vest':
      G.player.armour = 100;
      G.loadout.vest = true;
      break;
    case 'helmet':
      G.player.armour = 100;
      G.loadout.helmet = true;
      break;
    case 'ammo':
      G.ammo.reserve = Math.min(300, G.ammo.reserve + 90);
      break;
    default:
      G.loadout.primary = item.name;
      break;
  }
  return { ok: true, reason: '' };
}
