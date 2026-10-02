/* 電腦對手。只用自己看得到的資訊：對方棋子的真實棋種一律不讀，
 * 只讀 piece.cand[我方]（從開局位置、移動方式、對撞結果推理出來的可能棋種）。 */
(function (root) {
  "use strict";
  const LZ = root.LZ || (root.LZ = {});

  const FLAG_VALUE = 100000;
  const FLAG_DANGER = 50000;

  // 上帝視角餵給電腦時為 true：對方的棋直接當成已知
  let omniscient = false;
  /** side 眼中敵棋 q 可能的棋種（位元遮罩） */
  const knownMask = (q, side) => (omniscient ? 1 << q.t : q.cand[side]);

  /** 敵棋 q 在 side 眼中的棋種機率分佈：[[T, p], ...] */
  function distribution(S, q, side, flagHolders) {
    const V = S.V;
    const mask = knownMask(q, side);
    const single = LZ.singleType(mask);
    if (single >= 0) return [[V.types[single], 1]];
    const out = [];
    let flagP = 0;
    const flagT = V.types[V.kindIdx.flag];
    if (flagT && mask & (1 << flagT.idx)) flagP = 1 / Math.max(1, flagHolders);
    let total = 0;
    for (const T of V.types) {
      if (!(mask & (1 << T.idx)) || T.kind === "flag") continue;
      const w = Math.max(0.2, T.count - S.deadKnown[side][T.idx]);
      out.push([T, w]);
      total += w;
    }
    for (const e of out) e[1] = total ? (e[1] / total) * (1 - flagP) : 0;
    if (flagP) out.push([flagT, total ? flagP : 1]);
    return out;
  }

  /**
   * 敵棋可能攻擊到的格子（棋種未知：一般走法 ∪ 可能是工兵／坦克時的走法）。
   * touched＝這次計算看過的所有格子；盤面只在 touched 以外變動時，結果不變（供快取判斷）。
   */
  function threatReach(S, n, q, side) {
    const V = S.V;
    const attacks = new Set(), touched = new Set();
    const mask = knownMask(q, side) & V.mobileMask;
    // 翻倒的敵棋下一回合不能動，也就打不到人
    if (!mask || V.nodes[n].hq || q.stunned) return { attacks, touched };
    const scan = (T) => {
      for (const m of LZ.movesFor(S, n, T, q.side, true)) {
        touched.add(m.to);
        if (m.kind === "attack") attacks.add(m.to);
      }
    };
    scan(GENERIC);
    for (const kind of ["engineer", "tank"]) {
      const idx = V.kindIdx[kind];
      if (idx != null && mask & (1 << idx)) scan(V.types[idx]);
    }
    return { attacks, touched };
  }
  const GENERIC = { kind: "normal", mobile: true };

  /** 站在 node 的我方棋種 MT 被敵棋（分佈 dist）攻擊時的期望損失 */
  function expectedLoss(V, MT, dist, node) {
    let loss = 0;
    for (const [T, p] of dist) {
      if (!T.mobile) continue;
      const r = LZ.resolveAt(V, T, MT, node);
      if (r === "win" || r === "flag") loss += p * MT.value;
      else if (r === "both") loss += p * Math.max(0, MT.value - T.value);
    }
    return loss;
  }

  function attackEV(V, MT, dist, to) {
    let ev = 0;
    for (const [T, p] of dist) {
      const r = LZ.resolveAt(V, MT, T, to);
      if (r === "flag") ev += p * FLAG_VALUE;
      else if (r === "win") ev += p * (T.value + 2);
      else if (r === "lose") ev -= p * MT.value;
      else ev += p * (T.value - MT.value);
    }
    return ev;
  }

  /** 目標分佈有多「糊」：1＝已知，越大越不確定 */
  function ambiguity(dist) {
    if (dist.length <= 1) return 1;
    let h = 0;
    for (const [, p] of dist) if (p > 0) h -= p * Math.log2(p);
    return 1 + h; // 約 1～4
  }

  function pOfKinds(dist, pred) {
    let s = 0;
    for (const [T, p] of dist) if (pred(T)) s += p;
    return s;
  }

  /** 推進程度：從己方後排 0 到對方後排 2*rows-1 */
  function advance(V, n, side) {
    const nd = V.nodes[n];
    return nd.side === side ? V.rows - 1 - nd.row : V.rows + nd.row;
  }

  /**
   * 難度參數（實力／穩定度）。
   * noise：隨機擾動；attack：攻擊期望值；danger：避險；flag：護旗。
   * 不明棋下 danger 過高會過度逃竄；最難應更準而非更膽小。
   */
  const LEVELS = {
    easy: { name: "簡單", noise: 30, attack: 0.5, danger: 0, flag: 0 },
    medium: { name: "中等", noise: 18, attack: 0.75, danger: 0.08, flag: 1 },
    hard: { name: "困難", noise: 7, attack: 1, danger: 0.28, flag: 1 },
    // 最難：極低雜訊；其餘靠 smart 分支加強，不單靠提高 danger
    hardest: { name: "最難", noise: 1.2, attack: 1.15, danger: 0.24, flag: 1.05, smart: true },
  };

  /**
   * 個性（風格倍率，乘在難度參數上）。
   * push／camp／scout／snipe／drop／blow／bomb／trade 只影響對應行為偏好。
   */
  const PERSONAS = {
    balanced: {
      name: "均衡", blurb: "攻守大致平均",
      noise: 1, attack: 1, danger: 1, flag: 1,
      push: 1, camp: 1, scout: 1, snipe: 1, drop: 1, blow: 1, bomb: 1, trade: 1,
    },
    aggressive: {
      name: "猛攻", blurb: "愛打、少躲",
      noise: 1, attack: 1.35, danger: 0.55, flag: 0.85,
      push: 1.25, camp: 0.7, scout: 0.85, snipe: 1.15, drop: 1.2, blow: 1.1, bomb: 1.25, trade: 1.15,
    },
    cautious: {
      name: "穩守", blurb: "惜子、重避險",
      noise: 0.85, attack: 0.75, danger: 1.55, flag: 1.25,
      push: 0.55, camp: 1.6, scout: 1.1, snipe: 0.85, drop: 0.6, blow: 0.8, bomb: 0.7, trade: 0.7,
    },
    rusher: {
      name: "衝鋒", blurb: "往前擠、愛空降",
      noise: 1.1, attack: 1.1, danger: 0.7, flag: 0.9,
      push: 2.1, camp: 0.6, scout: 0.8, snipe: 0.9, drop: 1.8, blow: 1.2, bomb: 1, trade: 1,
    },
    defender: {
      name: "護旗", blurb: "死守己方半場與軍旗",
      noise: 0.9, attack: 0.85, danger: 1.25, flag: 1.7,
      push: 0.35, camp: 1.9, scout: 1, snipe: 1, drop: 0.4, blow: 0.7, bomb: 1.1, trade: 0.85,
    },
    prober: {
      name: "試探", blurb: "愛偵察／狙擊摸底",
      noise: 1, attack: 0.9, danger: 1.05, flag: 1,
      push: 0.85, camp: 1.1, scout: 2.2, snipe: 1.6, drop: 0.9, blow: 0.9, bomb: 0.9, trade: 0.9,
    },
    gambler: {
      name: "賭徒", blurb: "亂、愛換子與炸彈",
      noise: 1.8, attack: 1.15, danger: 0.65, flag: 0.8,
      push: 1.15, camp: 0.8, scout: 0.9, snipe: 1.1, drop: 1.15, blow: 1.3, bomb: 1.7, trade: 1.6,
    },
  };

  function resolveBrain(V, level, style) {
    const base = Object.assign({}, LEVELS[level] || LEVELS.hardest, (V.aiLevels || {})[level]);
    const P = PERSONAS[style] || PERSONAS.balanced;
    return {
      levelKey: level,
      levelName: base.name,
      styleName: P.name,
      styleBlurb: P.blurb,
      smart: !!base.smart,
      noise: base.noise * (P.noise ?? 1),
      attack: base.attack * P.attack,
      danger: base.danger * P.danger,
      flag: base.flag * P.flag,
      push: P.push,
      camp: P.camp,
      scout: P.scout,
      snipe: P.snipe,
      drop: P.drop,
      blow: P.blow,
      bomb: P.bomb,
      trade: P.trade,
    };
  }

  /** opts.omniscient：上帝視角餵給電腦；opts.style：個性鍵（見 AI_PERSONAS） */
  function chooseMove(S, side, rng = Math.random, level = "hardest", opts = {}) {
    omniscient = !!opts.omniscient;
    try {
      return chooseMoveInner(S, side, rng, level, opts.style || "balanced");
    } finally {
      omniscient = false;
    }
  }

  function chooseMoveInner(S, side, rng, level, style) {
    const V = S.V, B = S.board;
    const L = resolveBrain(V, level, style);
    const enemies = [];
    let flagHolders = 0;
    const flagIdx = V.kindIdx.flag;
    for (let n = 0; n < B.length; n++) {
      const q = B[n];
      if (q && q.side !== side) {
        enemies.push(n);
        if (knownMask(q, side) & (1 << flagIdx)) flagHolders++;
      }
    }
    const distCache = new Map();
    const distOf = (n) => {
      const q = B[n];
      if (!distCache.has(q.pid)) distCache.set(q.pid, distribution(S, q, side, flagHolders));
      return distCache.get(q.pid);
    };

    let myFlag = -1;
    for (let n = 0; n < B.length; n++) {
      const p = B[n];
      if (p && p.side === side && V.types[p.t].kind === "flag") myFlag = n;
    }

    // 每顆敵棋在目前盤面的威脅範圍；假設走法只動到 from/to，沒碰到的就沿用
    const baseReach = new Map();
    for (const e of enemies) baseReach.set(e, threatReach(S, e, B[e], side));
    const reachOf = (e, changed) => {
      const b = baseReach.get(e);
      if (!changed) return b;
      for (const c of changed) if (b.touched.has(c)) return threatReach(S, e, B[e], side);
      return b;
    };

    /** n 格的我方棋種 MT 會被打的最大期望損失 */
    const dangerAt = (n, MT, changed) => {
      let worst = 0;
      for (const e of enemies) {
        if (!B[e] || B[e].side === side) continue;
        if (reachOf(e, changed).attacks.has(n)) worst = Math.max(worst, expectedLoss(V, MT, distOf(e), n));
      }
      return worst;
    };
    const flagThreatened = (changed) => {
      if (myFlag < 0) return false;
      for (const e of enemies) {
        if (B[e] && B[e].side !== side && reachOf(e, changed).attacks.has(myFlag)) return true;
      }
      return false;
    };
    const threatenedNow = flagThreatened(null);
    const flagThreats = new Set();
    if (threatenedNow) {
      for (const e of enemies) if (baseReach.get(e).attacks.has(myFlag)) flagThreats.add(e);
    }
    const lastBySide = S.lastMoves ? S.lastMoves[side] : null;

    /** 全盤己方「被吃期望」總壓（最難用來比走前／走後） */
    const boardPressure = (changed) => {
      if (!L.smart) return 0;
      let sum = 0;
      for (let n = 0; n < B.length; n++) {
        const q = B[n];
        if (!q || q.side !== side) continue;
        const T = V.types[q.t];
        if (!T.mobile && T.kind !== "flag") continue;
        const d = dangerAt(n, T, changed);
        if (d <= 0) continue;
        sum += d * (0.35 + T.value / 120);
        if (T.kind === "flag") sum += d * 8;
      }
      return sum;
    };
    const pressureNow = boardPressure(null);

    let best = null, bestScore = -Infinity;
    for (let from = 0; from < B.length; from++) {
      const p = B[from];
      if (!p || p.side !== side) continue;
      const MT = V.types[p.t];
      const moves = LZ.legalMoves(S, from);
      if (!moves.length) continue;
      const dangerFrom = dangerAt(from, MT, null);
      for (const mv of moves) {
        let score = rng() * L.noise;
        if (mv.kind === "attack") {
          const dist = distOf(mv.to);
          const amb = ambiguity(dist);
          let ev = attackEV(V, MT, dist, mv.to);
          if (L.smart) {
            // 只對「很糊 + 超高價值子」略保守，避免大子亂撞；不要全面縮手
            if (amb > 2.2 && MT.value >= 75) ev -= (amb - 2.2) * 6;
            const pMine = pOfKinds(dist, (T) => T.kind === "mine");
            if (pMine > 0.08) {
              if (MT.kind === "engineer") ev += pMine * 32;
              else if (MT.kind === "tank" && V.rule && V.rule.tankMine) ev += pMine * 24;
              else if (MT.kind !== "bomb") ev -= pMine * (18 + MT.value * 0.35);
            }
            if (MT.kind === "spy") {
              ev += pOfKinds(dist, (T) => T.kind === "commander") * 60;
            }
            // 已知必輸才重罰（不明棋的「可能輸」不要當自殺）
            if (dist.length === 1) {
              const r0 = LZ.resolveAt(V, MT, dist[0][0], mv.to);
              if (r0 === "lose") ev -= MT.value * 0.9;
              if (r0 === "flag" || r0 === "win") ev += 8;
            }
          }
          score += ev * L.attack;
          if (MT.kind === "bomb") score += 6 * (L.bomb - 1);
          // 賭徒／猛攻：同歸於盡略加分
          if (L.trade !== 1) {
            let pBoth = 0;
            for (const [T, pr] of dist) {
              if (LZ.resolveAt(V, MT, T, mv.to) === "both") pBoth += pr;
            }
            score += pBoth * 10 * (L.trade - 1);
          }
          if (flagThreats.has(mv.to)) {
            let pRemove = 0;
            for (const [T, pr] of dist) {
              const r = LZ.resolveAt(V, MT, T, mv.to);
              if (r === "win" || r === "both") pRemove += pr;
            }
            score += pRemove * FLAG_DANGER * L.flag;
          }
          // 打贏後留在原地的風險
          let pWin = 0;
          for (const [T, pr] of dist) {
            const r = LZ.resolveAt(V, MT, T, mv.to);
            if (r === "win" || r === "flag") pWin += pr;
          }
          if (pWin > 0) {
            const saved = B[mv.to];
            B[mv.to] = p; B[from] = null;
            score -= pWin * dangerAt(mv.to, MT, [from, mv.to]) * 0.7 * L.danger;
            // 吃子後若能明顯減輕全盤壓力（例如清掉威脅旗的子）略加分
            if (L.smart && flagThreats.has(mv.to)) {
              score += (pressureNow - boardPressure([from, mv.to])) * 0.08;
            }
            B[from] = p; B[mv.to] = saved;
          }
          score += dangerFrom * 0.5 * L.danger;
          score += S.quiet > V.drawQuiet * 0.6 ? 10 : 0;
          if (L.smart && V.nodes[mv.to].hq) {
            score += pOfKinds(dist, (T) => T.kind === "flag") * 45;
          }
        } else if (mv.kind === "scout") {
          const q = B[mv.to];
          let ev = 0;
          for (const [T, pr] of distOf(mv.to)) ev += pr * T.value;
          const amb = ambiguity(distOf(mv.to));
          score += (6 + ev * 0.15 + (knownMask(q, side) & (1 << flagIdx) ? 40 : 0)) * L.scout;
          // 最難：越糊的棋越值得偵察
          if (L.smart) score += (amb - 1) * 4 * L.scout;
          score -= dangerFrom * 0.6 * L.danger;
        } else if (mv.kind === "snipe") {
          // 狙擊：命中就賺到目標；不論中不中都會暴露自己
          let ev = 0;
          for (const [T, pr] of distOf(mv.to)) if (LZ.snipeHits(V, T, mv.to)) ev += pr * (T.value + 2);
          score += (ev * L.attack - (p.faceUp ? 0 : 3)) * L.snipe;
          if (flagThreats.has(mv.to)) {
            let pHit = 0;
            for (const [T, pr] of distOf(mv.to)) if (LZ.snipeHits(V, T, mv.to)) pHit += pr;
            score += pHit * FLAG_DANGER * L.flag;
          }
          score -= dangerFrom * 0.3 * L.danger;
          score += S.quiet > V.drawQuiet * 0.6 ? 10 : 0;
        } else if (mv.kind === "blow") {
          // 炸橋：對岸橋頭附近的敵棋越多越值得；炸彈本身快被吃時也值得
          let near = 0;
          for (const e of enemies) {
            if (e === mv.to || V.adj[mv.to].includes(e)) near++;
          }
          score += (16 * near - MT.value * 0.35 + dangerFrom * 0.5 * L.danger) * L.blow;
          if (threatenedNow) score -= FLAG_DANGER * L.flag;
        } else {
          // move / drop
          B[mv.to] = p; B[from] = null;
          const dTo = dangerAt(mv.to, MT, [from, mv.to]);
          const threatAfter = flagThreatened([from, mv.to]);
          const pressAfter = L.smart ? boardPressure([from, mv.to]) : 0;
          B[from] = p; B[mv.to] = null;
          // 空降落地、走進森林或沼澤會翻倒一回合，逃不掉，危險加重
          const stunAfter = (mv.kind === "drop" && V.rule.dropStun) || (V.rule.forest && V.nodes[mv.to].forest)
            || (V.rule.swamp && V.nodes[mv.to].swamp);
          score += (dangerFrom - dTo * (stunAfter ? 1.5 : 1)) * 0.8 * L.danger;
          if (L.smart) {
            // 只有「這顆棋自己很危險」時，才用減壓鼓勵逃走／換位
            if (dangerFrom > MT.value * 0.45) {
              score += (pressureNow - pressAfter) * 0.1;
            }
            // 明顯送死：目標格幾乎必死，且現在相對安全
            if (dTo >= MT.value * 0.95 && dangerFrom < MT.value * 0.25 && MT.value >= 25) {
              score -= 12;
            }
          }
          if (stunAfter) score -= 1;
          if (threatAfter) score -= FLAG_DANGER * L.flag;
          const gain = advance(V, mv.to, side) - advance(V, from, side);
          const pushBase = MT.kind === "engineer" ? 0.3 : MT.kind === "commander" ? 0.4 : MT.rank <= 4 ? 1.6 : 1;
          score += gain * pushBase * L.push;
          if (V.nodes[mv.to].camp) score += 2.5 * L.camp;
          // 村莊：大子受威脅時躲進去（不會被偵察、雷達看到）；平時不加分，免得進進出出空轉
          if (V.rule.village && V.nodes[mv.to].village && MT.value >= 35 && dangerFrom > 0 && !V.nodes[from].village) score += 2 * L.camp;
          if (V.nodes[from].camp) score -= 1.5 * L.camp;
          if (V.nodes[mv.to].hq && V.nodes[mv.to].side === side) score -= 40;
          if (mv.kind === "drop") score += 3 * L.drop;
          // 炸彈守橋頭：橋還在、對岸有敵棋時，走到橋頭準備炸橋
          if (MT.kind === "bomb" && V.rule.bridgeBlow) {
            const t = V.nodes[mv.to];
            if (t.side === side && t.row === 0 && (V.roadCross || []).includes(t.col) && !S.broken.includes(t.col)) {
              const far = V.id(1 - side, t.col, 0);
              let near = 0;
              for (const e of enemies) if (e === far || V.adj[far].includes(e)) near++;
              score += (3 + 3 * near) * L.bomb;
            }
          }
          if (lastBySide && lastBySide.to === from && lastBySide.from === mv.to) score -= 6;
          // 最難：工兵往對方後排（排雷／摸旗）略加分
          if (L.smart && MT.kind === "engineer" && V.nodes[mv.to].side !== side) {
            score += (V.nodes[mv.to].row >= V.rows - 3 ? 4 : 1.5);
          }
        }
        // 軍旗已被威脅時，偵察不能解圍；移動的情況已由 threatAfter 處理
        if (threatenedNow && mv.kind === "scout") score -= FLAG_DANGER * L.flag;
        if (score > bestScore) { bestScore = score; best = { from, mv }; }
      }
    }
    return best;
  }

  /** 讓電腦走一步；回傳事件或 null */
  function aiTurn(S, side, rng, level, opts) {
    const pick = chooseMove(S, side, rng, level, opts);
    if (!pick) return null;
    if (!S.lastMoves) S.lastMoves = [null, null];
    S.lastMoves[side] = { from: pick.from, to: pick.mv.to };
    return LZ.applyMove(S, pick.from, pick.mv);
  }

  Object.assign(LZ, {
    AI_LEVELS: LEVELS,
    AI_PERSONAS: PERSONAS,
    aiResolveBrain: resolveBrain,
    aiChooseMove: chooseMove,
    aiTurn,
  });
})(typeof window !== "undefined" ? window : globalThis);
