// First-person weapon: a low-poly rifle held in the lower right of the frame.
// Receiver, barrel, handguard, stock, magazine and a front sight. Idle sway and
// walk bob ride on top; firing kicks the weapon back and up; reloading dips it;
// a muzzle flash (quad + point light) fires with the shot. Purely cosmetic: it
// never touches the collision or ray tests, which run in world/arsenal space.
import * as THREE from 'three';

export function createViewmodel(camera) {
  const group = new THREE.Group();
  group.name = 'viewmodel';
  camera.add(group);

  // Base hold: right of centre, below the view line, muzzle angled inward.
  const HOLD = new THREE.Vector3(0.34, -0.34, -0.72);
  const HOLD_ROT = new THREE.Euler(0.03, 0.09, 0);

  const receiverMat = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.42, metalness: 0.72 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x141920, roughness: 0.35, metalness: 0.85 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x3d2e20, roughness: 0.88, metalness: 0.02 });
  const magMat = new THREE.MeshStandardMaterial({ color: 0x2c333d, roughness: 0.5, metalness: 0.6 });
  const polymerMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.75, metalness: 0.12 });

  function part(geo, mat, x, y, z) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  }

  // Stock and receiver along -z. Units are metres in camera space; the rifle is
  // scaled up slightly because it sits close to the lens.
  group.scale.setScalar(1.15);
  part(new THREE.BoxGeometry(0.045, 0.075, 0.16), gripMat, 0, -0.012, 0.225);                 // stock
  part(new THREE.BoxGeometry(0.052, 0.095, 0.30), receiverMat, 0, 0, 0.02);                  // receiver
  part(new THREE.BoxGeometry(0.048, 0.06, 0.05), polymerMat, 0, -0.075, 0.055);              // pistol grip
  const mag = part(new THREE.BoxGeometry(0.042, 0.17, 0.075), magMat, 0, -0.13, -0.075);     // magazine
  mag.rotation.x = 0.22;
  part(new THREE.BoxGeometry(0.055, 0.055, 0.21), polymerMat, 0, 0.004, -0.24);              // handguard
  part(new THREE.CylinderGeometry(0.021, 0.021, 0.23, 10), barrelMat, 0, 0.012, -0.43)
    .rotation.x = Math.PI / 2;                                                               // barrel
  part(new THREE.CylinderGeometry(0.03, 0.03, 0.055, 10), barrelMat, 0, 0.012, -0.545)
    .rotation.x = Math.PI / 2;                                                               // muzzle brake
  part(new THREE.BoxGeometry(0.012, 0.045, 0.012), barrelMat, 0, 0.075, -0.5);               // front sight post
  part(new THREE.BoxGeometry(0.062, 0.03, 0.018), polymerMat, 0, 0.052, -0.5);               // sight base
  part(new THREE.BoxGeometry(0.04, 0.02, 0.05), polymerMat, 0, 0.062, 0.09);                 // rear sight
  part(new THREE.BoxGeometry(0.03, 0.028, 0.02), polymerMat, 0, 0.062, 0.135);               // charging handle

  // Muzzle flash: a two-quad star plus a short-range point light, both pooled here.
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
  flash.position.set(0, 0.012, -0.59);
  group.add(flash);
  const flashLight = new THREE.PointLight(0xffc06a, 0, 6, 2);
  flashLight.position.set(0, 0.05, -0.62);
  group.add(flashLight);

  group.position.copy(HOLD);
  group.rotation.copy(HOLD_ROT);

  // Animation state, decayed in place.
  let kick = 0;        // recoil, 0..1
  let reloadDip = 0;   // 0..1 while the reload animation is up
  let reloadTimer = 0;
  let reloadSpan = 1;
  let flashLife = 0;
  let bobPhase = 0;
  let swayTime = Math.random() * 10;

  function fire() {
    kick = Math.min(1, kick + 0.85);
    flashLife = 0.055;
    flash.rotation.z = Math.random() * Math.PI;
  }

  function reload(duration) {
    if (reloadTimer > 0) return;
    reloadSpan = Math.max(0.4, duration || 1.8);
    reloadTimer = reloadSpan;
  }

  function setVisible(visible) {
    group.visible = visible;
  }

  // dt real seconds; moveSpeed is horizontal ground speed; crouch lowers the gun.
  function update(dt, moveSpeed, crouching, onGround) {
    swayTime += dt;
    kick = Math.max(0, kick - dt * 5.2);
    flashLife = Math.max(0, flashLife - dt);

    // Walk bob only when moving on the ground.
    const bobRate = onGround ? Math.min(1, (moveSpeed || 0) / 5.3) : 0;
    bobPhase += dt * (6 + 7 * bobRate) * bobRate;
    const bobX = Math.sin(bobPhase) * 0.028 * bobRate;
    const bobY = Math.abs(Math.cos(bobPhase)) * 0.024 * bobRate;

    // Reload dip: down, inboard, rolled; eased in and out over the timer.
    if (reloadTimer > 0) {
      reloadTimer = Math.max(0, reloadTimer - dt);
      const t = 1 - reloadTimer / reloadSpan;
      reloadDip = Math.sin(Math.min(1, t * 1.15) * Math.PI) * (reloadTimer > 0 ? 1 : 0);
    } else {
      reloadDip = Math.max(0, reloadDip - dt * 6);
    }

    // Idle sway: two slow sines, small amplitude, slightly larger when airborne.
    const swayAmp = 1 + (onGround ? 0 : 1.6);
    const swayX = Math.sin(swayTime * 1.7) * 0.011 * swayAmp;
    const swayY = Math.cos(swayTime * 2.3) * 0.009 * swayAmp;

    group.position.set(
      HOLD.x + bobX + swayX + kick * 0.035,
      HOLD.y + bobY + swayY - kick * 0.075 - reloadDip * 0.16 + (crouching ? -0.035 : 0),
      HOLD.z + kick * 0.17 + reloadDip * 0.06,
    );
    group.rotation.set(
      HOLD_ROT.x + kick * 0.16 - reloadDip * 0.55,
      HOLD_ROT.y + swayX * 0.7 + reloadDip * 0.28,
      HOLD_ROT.z - bobX * 0.5 - reloadDip * 0.35,
    );

    // Flash: hard on for ~55 ms, then dark; light falls off faster.
    const f = flashLife > 0 ? 1 : 0;
    flashMat.opacity = f * (0.75 + Math.random() * 0.25);
    flash.scale.setScalar(0.8 + Math.random() * 0.55);
    flashLight.intensity = f * 3.4;
  }

  return { group, update, fire, reload, setVisible };
}
