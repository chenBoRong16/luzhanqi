/* 音效／音樂：Web Audio 合成，無外部音檔（同屬本專案 CC BY-SA 4.0）
 * 桌遊條件：音效只是電腦版的輔助；只依「你」在實體棋盤上也會知道的事發聲。
 *   例：你的棋撞到地雷和輸給大棋，裁判都只說「你輸了」，所以是同一個音效。 */
(function (root) {
  "use strict";
  const LZ = root.LZ;
  const STORE = "lzq-audio-muted";
  const STORE_MUSIC = "lzq-audio-music";
  const STORE_VOL = "lzq-audio-volume";

  let ctx = null;
  let muted = false;
  let musicOn = true;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let musicNodes = null;
  let unlocked = false;
  let vol = { sfx: 0.8, music: 0.6 };
  let theme = "default";
  let scene = "deploy"; // deploy | play | end
  const recent = []; // 事件音效時間戳（限速用）
  const MAX_PER_SEC = 3;

  try {
    muted = JSON.parse(localStorage.getItem(STORE) || "false") === true;
    musicOn = JSON.parse(localStorage.getItem(STORE_MUSIC) || "true") !== false;
    const v = JSON.parse(localStorage.getItem(STORE_VOL) || "null");
    if (v && typeof v.sfx === "number" && typeof v.music === "number") vol = v;
  } catch (e) { /* ignore */ }

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = vol.sfx;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = vol.music;
      musicBus.connect(master);
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

  /** 音量 0～1：which＝"sfx" 或 "music" */
  function setVolume(which, v) {
    vol[which] = Math.max(0, Math.min(1, Number(v) || 0));
    try { localStorage.setItem(STORE_VOL, JSON.stringify(vol)); } catch (e) { /* ignore */ }
    const bus = which === "sfx" ? sfxBus : musicBus;
    if (bus && ctx) bus.gain.setTargetAtTime(vol[which], ctx.currentTime, 0.05);
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
    g.connect(sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(t0, dur, gain, cutoff) {
    if (!ensure() || muted) return;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff || 1400;
    src.buffer = buf;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 事件音效限速：觀戰「快」時每秒最多 3 個，避免連續爆音 */
  function allow() {
    if (!ctx) return true;
    const now = ctx.currentTime;
    while (recent.length && now - recent[0] > 1) recent.shift();
    if (recent.length >= MAX_PER_SEC) return false;
    recent.push(now);
    return true;
  }

  function beepUi() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    tone(660, t, 0.06, "triangle", 0.08);
  }

  /** 輕提示音：作弊、匯入匯出、複盤翻頁等中性操作 */
  function tick() {
    if (!ensure() || muted) return;
    tone(1046, ctx.currentTime, 0.035, "sine", 0.035);
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
    } else if (kind === "blast") {
      // 工兵爆破：短促的兩聲爆炸
      noiseBurst(t, 0.2, 0.18);
      tone(120, t, 0.25, "sawtooth", 0.1, 50);
      noiseBurst(t + 0.18, 0.15, 0.12);
    } else {
      tone(320, t, 0.07, "triangle", 0.07);
      tone(240, t + 0.05, 0.08, "triangle", 0.05);
    }
  }

  /** result 以「你」的角度：win＝對你有利、lose＝對你不利 */
  function playCombat(result) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    if (result === "flag") {
      // 號角
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.22, "sawtooth", 0.07));
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.22, "sine", 0.1));
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

  /** 地形與公開事件的附加音效 */
  function playExtras(ev) {
    const t = ctx.currentTime + 0.12;
    if (ev.commanderDown) {
      // 低沉鼓聲：司令陣亡，軍旗翻成明棋
      tone(70, t, 0.5, "sine", 0.18, 45);
      noiseBurst(t, 0.25, 0.08, 400);
    }
    if (ev.radar) {
      tone(1568, t, 0.05, "sine", 0.04);
      tone(1568, t + 0.12, 0.05, "sine", 0.03);
    }
    if (ev.stun === "swamp") {
      // 陷入沼澤：悶響
      noiseBurst(t, 0.3, 0.08, 300);
      tone(110, t, 0.3, "sine", 0.06, 70);
    } else if (ev.stun === "forest") {
      // 走進森林：沙沙
      noiseBurst(t, 0.22, 0.05, 3200);
      noiseBurst(t + 0.12, 0.18, 0.04, 2600);
    }
    if (ev.gaugeStop) {
      // 換軌：金屬撞擊
      tone(1200, t, 0.08, "square", 0.05, 900);
      tone(800, t + 0.07, 0.12, "square", 0.04, 600);
    }
    if (ev.tank3) {
      // 坦克衝刺：引擎聲
      tone(60, t - 0.1, 0.45, "sawtooth", 0.07, 95);
      noiseBurst(t - 0.1, 0.4, 0.04, 600);
    }
    if (ev.passed) {
      tone(523, t, 0.12, "triangle", 0.05);
      tone(392, t + 0.12, 0.16, "triangle", 0.05);
    }
  }

  /**
   * 對局事件。humanSide：從誰的角度聽（只用這一方知道的資訊）。
   * 勝負只有「贏、輸、同歸、奪旗」四種聲音：撞雷＝輸給大棋，同歸＝炸彈。
   */
  function playEvent(ev, humanSide) {
    if (!ev) return;
    if (!ensure() || muted) return;
    if (!allow()) return;
    const mine = humanSide == null || ev.side === humanSide;
    const flipResult = (r) => (mine ? r : r === "win" ? "lose" : r === "lose" ? "win" : r);
    if (ev.kind === "attack" || ev.result === "flag") {
      playCombat(ev.result === "flag" ? "flag" : flipResult(ev.result || "win"));
    } else if (ev.kind === "snipe") {
      playCombat(flipResult(ev.result === "win" ? "win" : "miss"));
    } else {
      playMove(ev.kind);
    }
    playExtras(ev);
  }

  function playOutcome(winner, humanSide) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    setScene("end");
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
    setScene("play");
  }

  function playDeploySwap() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    tone(480, t, 0.05, "triangle", 0.05);
    tone(560, t + 0.04, 0.06, "triangle", 0.045);
  }

  /** 地圖編輯器操作音（音量比對局低） */
  function playEditor(kind) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const g = 0.6;
    switch (kind) {
      case "paint": tone(700, t, 0.03, "triangle", 0.03 * g); break;
      case "road": tone(500, t, 0.04, "square", 0.025 * g); tone(380, t + 0.03, 0.04, "square", 0.02 * g); break;
      case "rail": tone(900, t, 0.03, "square", 0.025 * g); tone(1100, t + 0.03, 0.03, "square", 0.02 * g); break;
      case "erase": noiseBurst(t, 0.06, 0.03 * g, 2000); break;
      case "brush": noiseBurst(t, 0.15, 0.04 * g, 1800); tone(523, t + 0.05, 0.1, "sine", 0.03 * g); break;
      case "undo": tone(600, t, 0.04, "sine", 0.03 * g, 450); break;
      case "save": tone(659, t, 0.06, "sine", 0.05 * g); tone(880, t + 0.07, 0.08, "sine", 0.05 * g); break;
      case "error": tone(220, t, 0.12, "sawtooth", 0.05 * g, 180); break;
      default: tick();
    }
  }

  // ---------- 背景音樂：主題 × 情境 ----------
  // 主題決定和弦與旋律音階；情境決定速度與亮度（佈陣平靜、對戰緊湊、結束收尾）
  const THEMES = {
    default: { pad: [130.81, 164.81, 196.0, 246.94], notes: [392, 440, 349, 523, 392, 330, 349, 440] }, // 使用者原本的主題
    classic: { pad: [130.81, 155.56, 196.0, 233.08], notes: [392, 349, 311, 349, 392, 466, 392, 349] },
    expanded0: { pad: [146.83, 174.61, 220.0, 261.63], notes: [440, 523, 440, 392, 349, 392, 440, 587] },
    expanded1: { pad: [123.47, 146.83, 185.0, 220.0], notes: [370, 440, 494, 440, 370, 330, 370, 554] },
    plain: { pad: [174.61, 220.0, 261.63, 329.63], notes: [523, 587, 659, 784, 659, 587, 523, 440] },
    swamp: { pad: [110.0, 130.81, 164.81, 207.65], notes: [330, 311, 262, 247, 262, 311, 330, 247] },
    forest: { pad: [130.81, 196.0, 261.63, 293.66], notes: [392, 440, 523, 440, 392, 330, 294, 330] },
    mountain: { pad: [98.0, 146.83, 196.0, 220.0], notes: [294, 392, 440, 392, 294, 262, 294, 220] },
  };
  const SCENES = { deploy: { every: 2600, level: 0.03 }, play: { every: 1700, level: 0.035 }, end: { every: 3200, level: 0.025 } };

  function setTheme(t) {
    const next = THEMES[t] ? t : "default";
    if (next === theme) return;
    theme = next;
    if (musicNodes) { stopMusic(); startMusic(); }
  }
  function setScene(s) {
    if (!SCENES[s] || s === scene) return;
    scene = s;
    if (musicNodes) { stopMusic(); startMusic(); }
    else if (musicOn && !muted && unlocked) startMusic();
  }

  function stopMusic() {
    if (!musicNodes) return;
    try {
      clearTimeout(musicNodes.timer);
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
    const TH = THEMES[theme] || THEMES.default;
    const SC = SCENES[scene] || SCENES.play;
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(SC.level, t0 + 1.2);
    g.connect(musicBus);
    const oscs = TH.pad.map((f, i) => {
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
    const mel = ctx.createOscillator();
    const mg = ctx.createGain();
    mel.type = scene === "play" ? "triangle" : "sine";
    mel.frequency.value = TH.notes[0];
    mg.gain.value = 0.0001;
    mel.connect(mg);
    mg.connect(g);
    mel.start(t0);
    let step = 0;
    const tickMel = () => {
      if (!musicNodes || muted || !musicOn) return;
      const now = ctx.currentTime;
      const f = TH.notes[step % TH.notes.length];
      mel.frequency.setValueAtTime(f, now);
      mg.gain.cancelScheduledValues(now);
      mg.gain.setValueAtTime(0.0001, now);
      mg.gain.exponentialRampToValueAtTime(0.045, now + 0.03);
      mg.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      step++;
      musicNodes.timer = setTimeout(tickMel, SC.every);
    };
    musicNodes = { gain: g, oscs: oscs.concat([mel]), timer: null };
    musicNodes.timer = setTimeout(tickMel, 800);
  }

  function unlock() {
    ensure();
    if (musicOn && !muted) startMusic();
  }

  LZ.audio = {
    unlock,
    beepUi,
    tick,
    playEvent,
    playOutcome,
    playStart,
    playDeploySwap,
    playEditor,
    setMuted,
    setMusic,
    setVolume,
    getVolume: () => Object.assign({}, vol),
    setTheme,
    setScene,
    isMuted: () => muted,
    isMusicOn: () => musicOn,
    ensure,
    THEMES: Object.keys(THEMES),
  };
})(typeof window !== "undefined" ? window : globalThis);
