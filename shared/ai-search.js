/* 電腦的「思考深度」：在深度 1（ai.js 只看這一步）之上往下推演。
 * 對方的暗棋不偷看：從 cand[我方]（推理出的可能棋種）與剩餘兵力抽樣，
 * 在抽樣出的盤面上走幾手，看子力增減與軍旗安危，再把各次抽樣平均。
 * 深度定的是「算多少」，不是「算幾秒」：同局面、同設定、同亂數一定下同一步；
 * 長考上限或「立刻下」只會讓它提早交出目前最好的一步。 */
(function (root) {
  "use strict";
  const LZ = root.LZ || (root.LZ = {});

  /**
   * 各深度的推演量。samples：抽幾種對方暗棋；top：細算幾個候選手（深度 1 分數最高者）；
   * plies：每個候選往下推幾手（含自己這手）；extend／extendTop：分數最高的幾個再多推幾手。
   */
  const DEPTHS = {
    1: { name: "即時", samples: 0, top: 0, plies: 1 },
    2: { name: "看回應", samples: 1, top: 8, plies: 2 },
    3: { name: "推演", samples: 6, top: 8, plies: 3 },
    4: { name: "深推演", samples: 12, top: 10, plies: 3, extend: 2, extendTop: 3 },
    5: { name: "長考", samples: 24, top: 14, plies: 3, extend: 2, extendTop: 5 },
  };
  const MAX_DEPTH = 5;
  // 推演結果（我這手之後的子力增減）併入深度 1 分數的權重；likely：只抽一次時取最可能的棋種
  const TUNE = { lineWeight: 1.2, likely: true };

  function xorshift(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /** 推演用的盤面複本：棋子各自複製，log／棋譜另開，不碰原本的局面 */
  function simClone(S) {
    const board = S.board.map((p) => (p ? Object.assign({}, p, { cand: p.cand.slice() }) : null));
    return {
      V: S.V, phase: S.phase, board, turn: S.turn, human: S.human, winner: S.winner, endReason: "",
      ply: S.ply, quiet: S.quiet, lastMove: S.lastMove, log: [], nextPid: S.nextPid,
      startGrids: S.startGrids, deadKnown: S.deadKnown.map((a) => a.slice()), lost: [[], []],
      broken: S.broken.slice(), illegal: S.illegal, cheat: S.cheat, history: [], rec: [], recStart: null,
      drawQuiet: S.drawQuiet, stats: LZ.newStats(), _fx: {}, lastMoves: S.lastMoves ? S.lastMoves.slice() : [null, null],
    };
  }

  /**
   * 抽一種「對方暗棋可能是這樣」：回傳 [[格子, 棋種], ...]。
   * 只用 cand[side] 與 side 知道的陣亡數；likely＝true 時每顆取最可能的棋種（深度 2 用）。
   */
  function sampleWorld(S, side, rnd, likely) {
    const V = S.V, B = S.board;
    const left = V.types.map((T) => T.count - S.deadKnown[side][T.idx]);
    const hidden = [];
    for (let n = 0; n < B.length; n++) {
      const q = B[n];
      if (!q || q.side === side) continue;
      const single = LZ.singleType(q.cand[side]);
      if (single >= 0) left[single]--;
      else hidden.push(n);
    }
    // 限制最多（可能棋種最少）的先抽，比較不會抽到矛盾
    hidden.sort((a, b) => LZ.popcount(B[a].cand[side]) - LZ.popcount(B[b].cand[side]) || a - b);
    const out = [];
    let strict = true;
    for (const n of hidden) {
      const mask = B[n].cand[side];
      const opts = [];
      let total = 0;
      for (const T of V.types) {
        if (!(mask & (1 << T.idx))) continue;
        const w = strict ? left[T.idx] : Math.max(0.2, left[T.idx]);
        if (w > 0) { opts.push([T.idx, w]); total += w; }
      }
      if (!opts.length) {
        // 推理矛盾（例如作弊改過盤面）：之後的棋改用不管剩餘兵力的抽法
        strict = false;
        for (const T of V.types) if (mask & (1 << T.idx)) { opts.push([T.idx, 1]); total += 1; }
        if (!opts.length) { opts.push([V.types.findIndex((T) => T.mobile), 1]); total = 1; }
      }
      let t = opts[0][0];
      if (likely) {
        let bw = -1;
        for (const [i, w] of opts) if (w > bw) { bw = w; t = i; }
      } else {
        let r = rnd() * total;
        for (const [i, w] of opts) { r -= w; if (r <= 0) { t = i; break; } }
      }
      left[t]--;
      out.push([n, t]);
    }
    return out;
  }

  /** 把抽樣結果放上複本：對方那顆棋的真實棋種換成抽到的（side 自己的推理 cand[side] 不變） */
  function applyWorld(sim, world) {
    for (const [n, t] of world) {
      const q = sim.board[n];
      q.t = t;
      q.cand[q.side] = 1 << t;
    }
  }

  /** side 眼中的子力差（複本裡用的是抽樣後的棋種）；分出勝負時給極大值 */
  function material(sim, side) {
    if (sim.phase === "end") {
      if (sim.winner === side) return LZ.AI_FLAG_VALUE;
      if (sim.winner === 1 - side) return -LZ.AI_FLAG_VALUE;
    }
    const V = sim.V;
    let m = 0;
    for (const q of sim.board) {
      if (!q) continue;
      const T = V.types[q.t];
      if (T.kind === "flag") continue;
      m += q.side === side ? T.value : -T.value;
    }
    return m;
  }

  function play(sim, pick) {
    sim.lastMoves[sim.board[pick.from].side] = { from: pick.from, to: pick.mv.to };
    LZ.applyMove(sim, pick.from, pick.mv);
  }

  /** 推演用的大腦：不加雜訊（假設對方夠聰明，自己往下想時也不亂想） */
  function quietBrain(V, base) {
    return Object.assign({}, base, { noise: 0 });
  }

  /**
   * 推演一條線：sim 已走完我方候選手，接著輪流用深度 1 挑最好的一手，共 extra 手。
   * 回傳 side 眼中的子力差。
   */
  function playLine(sim, side, extra, brains, rnd, omniscient) {
    for (let k = 0; k < extra && sim.phase === "play"; k++) {
      const who = sim.turn;
      const pick = LZ.aiScoreMoves(sim, who, rnd, who === side ? brains.me : brains.foe,
        { omniscient: who === side && omniscient });
      if (!pick) break;
      play(sim, pick);
    }
    return material(sim, side);
  }

  /** 深度 d 的推演量（以「一次深度 1 評分」為單位），供估計時間 */
  function workUnits(depth) {
    const P = DEPTHS[depth] || DEPTHS[1];
    if (!P.samples) return 1;
    let u = 1 + P.samples * P.top * (P.plies - 1);
    if (P.extend) u += P.samples * P.extendTop * P.extend;
    return u;
  }

  /** 把設定整理成合法值（壞資料修正成預設） */
  function clampDepth(d) {
    d = Math.round(Number(d));
    return d >= 1 && d <= MAX_DEPTH ? d : 1;
  }

  /**
   * 產生器：每算完一個候選（或一次抽樣）就讓出一次。完成時 return {pick, ...}。
   * 外面可以隨時停下，用 state.best() 取目前最好的一步。
   */
  function* searchGen(S, side, rng, settings, opts, state) {
    const V = S.V;
    const depth = clampDepth(settings.depth);
    const style = settings.style || opts.style || "balanced";
    const L = LZ.aiResolveBrain(V, settings, style);
    const omniscient = !!opts.omniscient;
    const list = [];
    const rootPick = LZ.aiScoreMoves(S, side, rng, L, { omniscient, out: list, explain: !!opts.explain });
    state.rootPick = rootPick;
    state.best = () => rootPick;
    const P = DEPTHS[depth];
    // 只有一步可走等情況不必推演；這種「秒下」不拿來估計速度
    state.list = list;
    // 避免輸而改走的保留手（ai.js 標 held）不再推演推翻
    if (!rootPick || rootPick.held || !P.samples || list.length <= 1) { state.early = !!P.samples; return { pick: rootPick, depth, list }; }
    const rnd = xorshift(Math.floor(rng() * 4294967296));
    const order = list.map((c, i) => [c, i]);
    order.sort((a, b) => b[0].score - a[0].score || a[1] - b[1]);
    const top = order.slice(0, P.top).map(([c]) => c);
    // opts.extra：另外要評估的手（走棋提醒用：玩家這一手），用同一批抽樣比較
    for (const x of opts.extra || []) {
      const c = list.find((m) => m.from === x.from && m.mv.to === x.mv.to && m.mv.kind === x.mv.kind);
      if (c && !top.includes(c)) top.push(c);
    }
    const cands = top.map((c) => ({ c, sum: 0, n: 0, extSum: 0, extN: 0 }));
    state.cands = cands;
    const brains = {
      me: quietBrain(V, L),
      foe: quietBrain(V, LZ.aiResolveBrain(V, "hardest", "balanced")),
    };
    const W = TUNE.lineWeight;
    const total = (c) => c.c.score + W * (c.extN ? c.extSum / c.extN : c.n ? c.sum / c.n : 0);
    state.total = total;
    // 只比較已推演過的候選；全都還沒算到時用深度 1 的結果
    state.best = () => {
      let b = null, bs = -Infinity;
      for (const c of cands) {
        if (!c.n) continue;
        const s = total(c);
        if (s > bs) { bs = s; b = c; }
      }
      return b ? Object.assign({}, b.c, { score: bs }) : rootPick;
    };
    // 抽樣一開始就全部抽好：多評估幾手也不會改變抽到的情況
    const worlds = [];
    for (let s = 0; s < P.samples; s++) worlds.push(omniscient ? [] : sampleWorld(S, side, rnd, P.samples === 1 && TUNE.likely));
    for (const world of worlds) {
      for (const c of cands) {
        const sim = simClone(S);
        applyWorld(sim, world);
        play(sim, c.c);
        const after = material(sim, side);
        c.sum += playLine(sim, side, P.plies - 1, brains, rnd, omniscient) - after;
        c.n++;
        state.done++;
        yield;
      }
    }
    if (P.extend) {
      // 分數最高的幾個候選，在同樣的抽樣上多推幾手，取代原本較短的結果
      const ranked = cands.slice().sort((a, b) => total(b) - total(a));
      for (const c of ranked.slice(0, P.extendTop)) {
        for (const world of worlds) {
          const sim = simClone(S);
          applyWorld(sim, world);
          play(sim, c.c);
          const after = material(sim, side);
          c.extSum += playLine(sim, side, P.plies - 1 + P.extend, brains, rnd, omniscient) - after;
          c.extN++;
          state.done++;
          yield;
        }
      }
    }
    return { pick: state.best(), depth, list };
  }

  /**
   * 每單位推演約幾毫秒（依版本＋盤面大小記錄實測值）。
   * 還沒量過時的預設值依實測校準：原版棋種少、走法簡單，比擴充版便宜很多。
   */
  const perf = {};
  const perfKey = (V) => `${V.key}|${V.nNodes}`;
  function msPerUnit(V) {
    return perf[perfKey(V)] || V.nNodes * (V.ruleDefs && V.ruleDefs.length ? 0.045 : 0.012);
  }
  function recordPerf(V, units, ms) {
    if (units < 3 || ms <= 0) return;
    const k = perfKey(V);
    const v = ms / units;
    perf[k] = perf[k] ? perf[k] * 0.7 + v * 0.3 : v;
  }
  /** 這個深度一手大約要幾秒 */
  function estimateSeconds(V, depth) {
    return (workUnits(clampDepth(depth)) * msPerUnit(V)) / 1000;
  }

  /** 搜尋結束時每一手的分數：推演過的用推演後的分數，其餘用深度 1 分數 */
  function scoredOf(state) {
    const out = new Map();
    for (const m of state.list || []) out.set(m, m.score);
    if (state.cands && state.total) for (const c of state.cands) if (c.n) out.set(c.c, state.total(c));
    return [...out].map(([m, score]) => ({ from: m.from, mv: m.mv, score, why: m.why, held: m.held }));
  }

  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  /**
   * 同步搜尋（Node 測試、統計用）。opts.limitMs：時間上限（測試用；0 或省略＝不限）。
   * 回傳 {pick, ms, timedOut, depth}。
   */
  function search(S, side, rng, settings, opts = {}) {
    const t0 = now();
    const state = { done: 0, best: () => null };
    const gen = searchGen(S, side, rng, settings, opts, state);
    let r, timedOut = false;
    for (;;) {
      r = gen.next();
      if (r.done) break;
      if (opts.limitMs > 0 && now() - t0 >= opts.limitMs) { timedOut = true; break; }
    }
    const pick = r.done ? r.value.pick : state.best();
    const ms = now() - t0;
    if (!timedOut && r.done && !state.early) recordPerf(S.V, workUnits(clampDepth(settings.depth)), ms);
    return { pick, ms, timedOut, depth: clampDepth(settings.depth), scored: opts.explain ? scoredOf(state) : null };
  }

  /**
   * 瀏覽器用：分段思考，不卡畫面。onDone({pick, ms, timedOut, stopped})。
   * 回傳控制柄：cancel()（作廢，不呼叫 onDone）、stop()（立刻下）、elapsed()。
   * settings.limit：長考上限秒數（0＝不限）。
   */
  /**
   * 讓出一下再繼續。用 MessageChannel 而不是 setTimeout：分頁在背景時，
   * 瀏覽器會把連續的 setTimeout 限流到每秒甚至每分鐘一次，電腦就會想很久。
   */
  function makeDefer() {
    if (typeof MessageChannel === "undefined") return (f) => setTimeout(f, 0);
    const ch = new MessageChannel();
    let fn = null;
    ch.port1.onmessage = () => { const f = fn; fn = null; if (f) f(); };
    return (f) => { fn = f; ch.port2.postMessage(0); };
  }

  function think(S, side, rng, settings, opts, onDone) {
    const t0 = now();
    const state = { done: 0, best: () => null };
    const gen = searchGen(S, side, rng, settings, opts, state);
    const limitMs = settings.limit > 0 ? settings.limit * 1000 : 0;
    const slice = opts.sliceMs || 30;
    const defer = makeDefer();
    let over = false, stopReq = false, running = false;
    const finish = (pick, timedOut, stopped) => {
      over = true;
      const ms = now() - t0;
      if (!timedOut && !stopped && !state.early) recordPerf(S.V, workUnits(clampDepth(settings.depth)), ms);
      onDone({ pick, ms, timedOut, stopped, depth: clampDepth(settings.depth), scored: opts.explain ? scoredOf(state) : null });
    };
    const step = () => {
      if (over) return;
      running = true;
      const s0 = now();
      try {
        for (;;) {
          let r;
          try { r = gen.next(); } catch (e) {
            // 推演出錯時退回深度 1 的結果，不讓電腦卡住
            if (typeof console !== "undefined") console.error(e);
            finish(state.rootPick || LZ.aiChooseMove(S, side, rng, Object.assign({}, settings, { depth: 1 }), opts), false, false);
            return;
          }
          if (r.done) { finish(r.value.pick, false, false); return; }
          if (stopReq) { finish(state.best(), false, true); return; }
          if (limitMs && now() - t0 >= limitMs) { finish(state.best(), true, false); return; }
          if (now() - s0 >= slice) break;
        }
      } finally {
        running = false;
      }
      defer(step);
    };
    defer(step);
    return {
      cancel() { over = true; },
      stop() { stopReq = true; },
      elapsed: () => now() - t0,
      get running() { return !over || running; },
    };
  }

  Object.assign(LZ, {
    AI_DEPTHS: DEPTHS,
    AI_SEARCH_TUNE: TUNE,
    AI_MAX_DEPTH: MAX_DEPTH,
    aiSearch: search,
    aiThink: think,
    aiEstimateSeconds: estimateSeconds,
    aiWorkUnits: workUnits,
    aiSampleWorld: sampleWorld,
    aiRng: xorshift,
  });
})(typeof window !== "undefined" ? window : globalThis);
