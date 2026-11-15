// Synthesised sound: WebAudio oscillators and noise, no sample files. One gain per
// category (weapon / world / ui / bomb / stinger) into a master compressor, so the
// mix cannot clip. The context is created on the first user gesture.
export function createAudio() {
  let ctx = null;
  let noise = null;
  const buses = {};

  function ac() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      master.connect(comp).connect(ctx.destination);
      for (const [name, level] of [['weapon', 1], ['world', 0.9], ['ui', 0.8], ['bomb', 0.9], ['sting', 0.9]]) {
        const g = ctx.createGain();
        g.gain.value = level;
        g.connect(master);
        buses[name] = g;
      }
      // Pre-rendered 0.5 s of noise for bursts and explosions.
      const len = Math.floor(ctx.sampleRate * 0.5);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function burst(bus, when, duration, gain, lowpass) {
    const c = ac();
    if (!c || c.state === 'suspended') return;
    const t = c.currentTime + (when || 0);
    const src = c.createBufferSource();
    src.buffer = noise;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(lowpass || 5200, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);
    src.connect(filter).connect(g).connect(buses[bus]);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  function tone(bus, freq, type, duration, gain, when = 0, slideTo) {
    const c = ac();
    if (!c || c.state === 'suspended') return;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(buses[bus]);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() { ac(); if (ctx && ctx.state === 'suspended') ctx.resume(); },

    // --- Weapons. `kind` picks the receiver: rifle thumps, SMG snaps, pistol cracks. ---
    shot(kind) {
      if (kind === 'smg') {
        burst('weapon', 0, 0.09, 0.34, 7000);
        tone('weapon', 148, 'square', 0.05, 0.16);
      } else if (kind === 'pistol') {
        burst('weapon', 0, 0.11, 0.4, 8200);
        tone('weapon', 118, 'square', 0.07, 0.22, 0, 84);
      } else {
        burst('weapon', 0, 0.16, 0.52, 5600);
        tone('weapon', 66, 'square', 0.1, 0.3, 0, 46);
        tone('weapon', 210, 'sawtooth', 0.05, 0.1);
      }
    },
    slash() { tone('weapon', 340, 'triangle', 0.05, 0.14); },
    thump() { tone('weapon', 95, 'sine', 0.14, 0.2); },
    dry() { tone('weapon', 1900, 'square', 0.025, 0.07); },
    // Magazine out, then in: two soft mechanical clacks.
    reload() {
      tone('weapon', 420, 'square', 0.035, 0.1);
      tone('weapon', 300, 'square', 0.04, 0.09, 0.14);
      tone('weapon', 560, 'square', 0.04, 0.1, 0.42);
      tone('weapon', 760, 'square', 0.05, 0.11, 0.58);
    },

    // --- Hit feedback. ---
    hit() { tone('ui', 1450, 'sine', 0.05, 0.14); },      // body tick
    headshot() {                                          // headshot ding
      tone('ui', 2093, 'sine', 0.09, 0.16);
      tone('ui', 2637, 'sine', 0.16, 0.12, 0.055);
    },

    // --- World / movement. surface: 'concrete' | 'metal' | 'grit' ---
    footstep(surface) {
      if (surface === 'metal') {
        tone('world', 190 + Math.random() * 30, 'square', 0.028, 0.05);
        burst('world', 0, 0.03, 0.05, 2400);
      } else if (surface === 'grit') {
        burst('world', 0, 0.045, 0.08, 1800);
      } else {
        burst('world', 0, 0.035, 0.07, 1100);
        tone('world', 88, 'sine', 0.04, 0.05);
      }
    },
    bounce() { tone('world', 240, 'square', 0.04, 0.07); },

    buy() { tone('ui', 880, 'sine', 0.06, 0.11); tone('ui', 1320, 'sine', 0.07, 0.09, 0.07); },
    plant() { tone('bomb', 660, 'square', 0.06, 0.13); tone('bomb', 660, 'square', 0.06, 0.13, 0.18); },
    beep(freq) { tone('bomb', freq || 880, 'sine', 0.05, 0.11); },

    explode() {
      burst('weapon', 0, 0.65, 0.85, 3000);
      tone('weapon', 40, 'sine', 0.55, 0.42, 0, 26);
      tone('weapon', 58, 'sawtooth', 0.3, 0.16, 0.02);
    },

    // --- Round stingers. ---
    round() {
      tone('sting', 392, 'sine', 0.2, 0.16);
      tone('sting', 523.25, 'sine', 0.22, 0.15, 0.16);
      tone('sting', 659.25, 'sine', 0.34, 0.13, 0.32);
    },
    roundLoss() {
      tone('sting', 311, 'sine', 0.2, 0.15);
      tone('sting', 233, 'sine', 0.34, 0.14, 0.18);
    },
  };
}
