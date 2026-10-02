/* 音效／音樂：Web Audio 合成，無外部音檔（同屬本專案 CC BY-SA 4.0） */
(function (root) {
  "use strict";
  const LZ = root.LZ;
  const STORE = "lzq-audio-muted";
  const STORE_MUSIC = "lzq-audio-music";

  let ctx = null;
  let muted = false;
  let musicOn = true;
  let master = null;
  let musicNodes = null;
  let unlocked = false;

  try {
    muted = JSON.parse(localStorage.getItem(STORE) || "false") === true;
    musicOn = JSON.parse(localStorage.getItem(STORE_MUSIC) || "true") !== false;
  } catch (e) { /* ignore */ }

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    unlocked = true;
    return ctx;
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(STORE, JSON.stringify(muted)); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx ? ctx.currentTime : 0, 0.03);
    if (muted) stopMusic();
    else if (musicOn) startMusic();
  }

  function setMusic(v) {
    musicOn = !!v;
    try { localStorage.setItem(STORE_MUSIC, JSON.stringify(musicOn)); } catch (e) { /* ignore */ }
    if (!musicOn || muted) stopMusic();
    else startMusic();
  }

  function tone(freq, t0, dur, type, gain, slideTo) {
    if (!ensure() || muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(t0, dur, gain) {
    if (!ensure() || muted) return;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1400;
    src.buffer = buf;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function beepUi() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    tone(660, t, 0.06, "triangle", 0.08);
  }

  function playMove(kind) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    if (kind === "drop") {
      tone(220, t, 0.12, "sine", 0.12, 110);
      noiseBurst(t + 0.02, 0.08, 0.05);
    } else if (kind === "scout") {
      tone(880, t, 0.05, "square", 0.05);
      tone(1320, t + 0.06, 0.08, "square", 0.04);
    } else if (kind === "blow") {
      noiseBurst(t, 0.35, 0.22);
      tone(90, t, 0.4, "sawtooth", 0.12, 40);
    } else {
      tone(320, t, 0.07, "triangle", 0.07);
      tone(240, t + 0.05, 0.08, "triangle", 0.05);
    }
  }

  function playCombat(result) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    if (result === "flag") {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.22, "sine", 0.12));
      return;
    }
    if (result === "win") {
      tone(392, t, 0.08, "square", 0.09);
      tone(523, t + 0.09, 0.14, "square", 0.08);
      return;
    }
    if (result === "lose") {
      tone(300, t, 0.1, "sawtooth", 0.08, 120);
      return;
    }
    if (result === "both" || result === "miss") {
      noiseBurst(t, 0.18, 0.12);
      tone(180, t, 0.16, "triangle", 0.07, 90);
      return;
    }
    playMove("move");
  }

  function playEvent(ev) {
    if (!ev) return;
    ensure();
    if (ev.kind === "attack" || (ev.result && (ev.kind === "snipe" || ev.result === "flag"))) {
      playCombat(ev.result || "win");
    } else if (ev.kind === "snipe") {
      playCombat(ev.result === "win" ? "win" : "miss");
    } else {
      playMove(ev.kind);
    }
  }

  function playOutcome(winner, humanSide) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    if (winner === -1) {
      tone(440, t, 0.2, "sine", 0.08);
      tone(330, t + 0.22, 0.28, "sine", 0.08);
      return;
    }
    if (winner === humanSide) {
      [523, 659, 784, 988, 1175].forEach((f, i) => tone(f, t + i * 0.11, 0.25, "sine", 0.11));
    } else {
      [392, 349, 294, 220].forEach((f, i) => tone(f, t + i * 0.14, 0.28, "triangle", 0.1));
    }
  }

  function playStart() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    tone(392, t, 0.1, "sine", 0.08);
    tone(523, t + 0.1, 0.12, "sine", 0.09);
    tone(659, t + 0.22, 0.18, "sine", 0.1);
    if (musicOn) startMusic();
  }

  function playDeploySwap() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    tone(480, t, 0.05, "triangle", 0.05);
    tone(560, t + 0.04, 0.06, "triangle", 0.045);
  }

  function stopMusic() {
    if (!musicNodes) return;
    try {
      musicNodes.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
      const nodes = musicNodes;
      setTimeout(() => {
        try { nodes.oscs.forEach((o) => o.stop()); } catch (e) { /* ignore */ }
      }, 500);
    } catch (e) { /* ignore */ }
    musicNodes = null;
  }

  function startMusic() {
    if (!ensure() || muted || !musicOn) return;
    if (musicNodes) return;
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.035, t0 + 1.2);
    g.connect(master);
    const base = [130.81, 164.81, 196.0, 246.94]; // soft C minor-ish pad
    const oscs = base.map((f, i) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = i % 2 ? "sine" : "triangle";
      o.frequency.value = f;
      og.gain.value = 0.22;
      o.connect(og);
      og.connect(g);
      o.start(t0);
      return o;
    });
    // slow melody ticks
    const mel = ctx.createOscillator();
    const mg = ctx.createGain();
    mel.type = "sine";
    mel.frequency.value = 392;
    mg.gain.value = 0.0001;
    mel.connect(mg);
    mg.connect(g);
    mel.start(t0);
    const notes = [392, 440, 349, 523, 392, 330, 349, 440];
    let step = 0;
    const tick = () => {
      if (!musicNodes || muted || !musicOn) return;
      const now = ctx.currentTime;
      const f = notes[step % notes.length];
      mel.frequency.setValueAtTime(f, now);
      mg.gain.cancelScheduledValues(now);
      mg.gain.setValueAtTime(0.0001, now);
      mg.gain.exponentialRampToValueAtTime(0.045, now + 0.03);
      mg.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      step++;
      musicNodes.timer = setTimeout(tick, 2200);
    };
    musicNodes = { gain: g, oscs: oscs.concat([mel]), timer: null };
    musicNodes.timer = setTimeout(tick, 800);
  }

  function unlock() {
    ensure();
    if (musicOn && !muted) startMusic();
  }

  LZ.audio = {
    unlock,
    beepUi,
    playEvent,
    playOutcome,
    playStart,
    playDeploySwap,
    setMuted,
    setMusic,
    isMuted: () => muted,
    isMusicOn: () => musicOn,
    ensure,
  };
})(typeof window !== "undefined" ? window : globalThis);
