/* 走棋提醒：AI 覺得玩家自己下的這一步不好時，說明原因並指出更好的一步。
 * 用玩家這方看得到的資訊判斷（不偷看；上帝視角餵給己方時照用），軍旗模式不影響提醒。
 * 只提醒「明顯失誤」：先看原因（會被吃、軍旗被威脅、很可能撞輸、可能撞雷），再看和最好一步的分數差。 */
(function (root) {
  "use strict";
  const LZ = root.LZ || (root.LZ = {});

  // 門檻（依 tests/advice-calibrate.js 校準）：有具體原因時的分數差；沒有具體原因時要差更多才提醒
  const ADVICE = { gap: 5, bigGap: 60 };

  /** 同一局面用同一個亂數種子，判斷才會一致 */
  function seedOf(S) {
    let h = 2166136261;
    // 只用這方看得到的資訊：自己的棋種、對方棋子在推理中的可能棋種（不能用對方的真實棋種）
    const str = `${S.ply}|${S.turn}|${S.board.map((p) => (p ? `${p.side}${p.side === S.turn ? p.t : ""}:${p.cand[S.turn]}` : "-")).join(",")}`;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /** 提醒用的設定：照 AI 設置，但不加雜訊、軍旗模式用正常 */
  function adviceSettings(settings) {
    return Object.assign({}, settings, { noise: 0, flagMode: "normal" });
  }

  const same = (a, b) => a && b && a.from === b.from && a.mv.to === b.mv.to && a.mv.kind === b.mv.kind;

  /**
   * 由搜尋結果判斷 move 好不好。res 是 aiSearch／aiThink（opts.explain）的結果。
   * 回傳 { bad, reason, better, gap } 或 null（無法判斷，例如這一手不在結果裡）。
   */
  function judge(V, res, move) {
    if (!res || !res.scored || !res.pick) return null;
    const mine = res.scored.find((m) => same(m, move));
    if (!mine) return null;
    if (same(res.pick, move)) return { bad: false, gap: 0 };
    const best = res.scored.find((m) => same(m, res.pick)) || res.pick;
    const gap = best.score - mine.score;
    const w = mine.why || {};
    let reason = "";
    if (w.flagAfter && !w.flagNow) reason = "走完軍旗會被威脅";
    else if (move.mv.kind === "attack" && w.pMine >= 0.4) reason = "可能撞到地雷";
    else if (move.mv.kind === "attack" && w.pLose >= 0.6) reason = "這樣撞大概會輸";
    else if (w.danger != null && w.value >= 15 && w.danger >= w.value * 0.5) reason = "走過去很可能被吃";
    // 最好的那一步沒有同樣的問題，才算「明顯失誤」
    const bw = best.why || {};
    const bestHasIt = (reason === "走完軍旗會被威脅" && bw.flagAfter) ||
      (reason === "走過去很可能被吃" && bw.danger != null && bw.danger >= w.danger * 0.5) ||
      ((reason === "可能撞到地雷" || reason === "這樣撞大概會輸") && best.mv.kind === "attack" && (bw.pMine >= 0.4 || bw.pLose >= 0.6));
    let bad = false;
    if (reason && !bestHasIt && gap >= ADVICE.gap) bad = true;
    else if (gap >= ADVICE.bigGap) { bad = true; reason = "AI 有明顯更好的走法"; }
    return { bad, reason, better: bad ? best : null, gap };
  }

  /** 同步判斷（Node 測試、校準用）：用 side 這方的眼光評估 move */
  function adviceFor(S, side, settings, opts, move) {
    const res = LZ.aiSearch(S, side, LZ.aiRng(seedOf(S)), adviceSettings(settings),
      Object.assign({}, opts, { explain: true, extra: [move] }));
    return judge(S.V, res, move);
  }

  Object.assign(LZ, { AI_ADVICE: ADVICE, adviceFor, adviceJudge: judge, adviceSeed: seedOf, adviceSettings });
})(typeof window !== "undefined" ? window : globalThis);
