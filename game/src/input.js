// Keyboard and mouse. Pointer lock turns the mouse into look; action keys (reload, buy,
// scoreboard) arrive as one-frame pulses the main loop consumes. Escape leaves pointer
// lock and releases fire.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  function setKey(event, down) {
    if (down) {
      if (event.code === 'Space' || event.code === 'Tab' || event.code === 'KeyR' ||
          event.code === 'KeyB' || event.code === 'ControlLeft') event.preventDefault();
      if (!keys.has(event.code)) pressed.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => { keys.clear(); state.firing = false; });

  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  window.addEventListener('contextmenu', (event) => {
    if (state.locked) event.preventDefault();
  });

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { /* headless or denied: look stays idle */ });
    },
    // Look delta since the last call, zeroed.
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // One-frame pulses for action keys, consumed and cleared each frame.
    takePresses() {
      const out = new Set(pressed);
      pressed.clear();
      return out;
    },
  };
}
