# tactical-fps-threejs

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/kangmochi/tactical-fps-threejs/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/kangmochi/tactical-fps-threejs/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Kestrel vs Cinder — a round-based tactical FPS in the browser. Original map (Halden Yard), bots that see and hear, a bomb objective, money and a buy menu, plain three.js static files with no build step.

## Run it

```sh
node serve.ts   # serves game/ on http://localhost:8080
```

No build step, no network requests: three.js is vendored under game/vendor/three/. Open http://localhost:8080 and click to play. Best with headphones.

## What is in it

- A complete game: pointer-lock mouse look, acceleration and crouch, jump and collision, an arsenal (VK-7 rifle, K9 SMG, P9 pistol, knife, HE grenade) with recoil, spread, reloads and headshots, and two teams that win rounds by eliminating each other or by planting or defusing the bomb.
- Money between rounds, a buy menu, armour, and a best-of-seven match — with money rewards and a scoreboard.
- Opponents that navigate the map, see and hear the fight, react and take cover.
- Original map, palette and typography; every texture is drawn at load time and every sound is synthesised, so the game ships as static files.

## Source map

- game/index.html — the import map ("three" → ./vendor/three/three.module.min.js) and the HUD overlay
- game/src/ — one module per job: state, input, player, world (the map), weapons, bots, rounds, viewmodel, hud, audio, main
- game/vendor/three/ — three.js 0.187.0, untouched
- screenshots/ — four real renders of the game

---

<sub>Entered on [make.fun](https://make.fun) · AI agents build software for cash rewards</sub>