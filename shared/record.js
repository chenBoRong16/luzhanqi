/* 棋譜與複盤。
 * 棋譜＝開局（雙方佈局、規則組、先手）＋每一手（含作弊動作）。
 * 複盤用同一套 applyMove 從開局重播，所以重播結果和實際對局一定相同。 */
(function (root) {
  "use strict";
  const LZ = root.LZ || (root.LZ = {});

  const RECORD_FORMAT = "luzhanqi-record";

  function buildRecord(S, name) {
    const st = S.recStart;
    return {
      format: RECORD_FORMAT,
      variant: S.V.key,
      name: name || "對局",
      rules: st.rules,
      human: st.human,
      first: st.first,
      illegal: st.illegal,
      cheatUsed: !!st.cheatUsed,
      grids: st.grids,
      map: st.map || undefined, // 擴充版：整張地圖存進棋譜，換台電腦也能複盤
      drawQuiet: st.drawQuiet, // 和預設不同時才有（0＝不判和）
      moves: S.rec.slice(),
      result: S.phase === "end" ? { winner: S.winner, reason: S.endReason } : null,
    };
  }

  function parseRecord(text, V) {
    let d;
    try { d = JSON.parse(text); } catch { return { error: "不是有效的 JSON" }; }
    if (!d || d.format !== RECORD_FORMAT) return { error: "不是棋譜檔" };
    if (d.variant !== V.key) return { error: `這是「${d.variant}」的棋譜，不是本版的` };
    if (!Array.isArray(d.grids) || d.grids.length !== 2 || !Array.isArray(d.moves)) return { error: "棋譜內容不完整" };
    // 大翻新前的棋譜沒有 v3：照舊規則重播
    if (d.rules && !("v3" in d.rules)) d.rules = Object.assign({}, d.rules, { v3: false });
    return { rec: d };
  }

  /** 依棋譜的規則組與地圖建出複盤用的 variant（原版直接用目前的） */
  function variantForRecord(rec) {
    if (!LZ.CONFIG || !LZ.CONFIG.ruleDefs) return LZ.VARIANT;
    return LZ.buildVariant(LZ.CONFIG, rec.rules || undefined, rec.map || undefined);
  }

  /** 能看的步驟（略過「跳過回合」，那是重播時自動產生的） */
  function steps(rec) {
    return rec.moves.filter((e) => e.k !== "pass");
  }

  /**
   * 從開局重播到第 k 步（k＝0 是開局），回傳新的對局狀態。
   * V 必須是用棋譜的規則組建出來的 variant。
   */
  function replayTo(V, rec, k) {
    const S = LZ.newGame(V);
    S.human = rec.human;
    S.cheat.ignorePlacement = true; // 違規佈局也要能重播
    S.cheat.used = !!rec.cheatUsed;
    for (const side of [0, 1]) {
      const grid = rec.grids[side].map((line) => line.map((n) => {
        const t = LZ.nameToIdx(V, n);
        return t === undefined ? -1 : t;
      }));
      LZ.setSideGrid(S, side, grid);
    }
    if (rec.drawQuiet != null) S.drawQuiet = rec.drawQuiet;
    LZ.startPlay(S, rec.first);
    S.cheat.ignorePlacement = false;
    const list = steps(rec);
    for (let i = 0; i < k && i < list.length && S.phase !== "end"; i++) {
      const e = list[i];
      if (e.c === "add") LZ.cheatAdd(S, e.n, LZ.nameToIdx(V, e.t), e.s);
      else if (e.c === "del") LZ.cheatDelete(S, e.n);
      else if (e.c === "move") LZ.cheatMove(S, e.a, e.b);
      else if (e.c === "swap") LZ.swapSides(S);
      else if (e.c === "draw") LZ.cheatSetDraw(S, e.n);
      else {
        S.cheat.infinite = !!e.inf;
        LZ.applyMove(S, e.f, { to: e.t, kind: e.k });
      }
    }
    S.cheat.infinite = false;
    return S;
  }

  /** 第 i 步的文字說明 */
  function describe(V, rec, i) {
    const e = steps(rec)[i];
    if (!e) return "";
    const pos = (n) => {
      const nd = V.nodes[n];
      return `${nd.side === rec.human ? "下" : "上"}方 ${nd.row + 1}-${nd.col + 1}`;
    };
    if (e.c) return { add: "【作弊】添加", del: "【作弊】刪除", move: "【作弊】搬動", swap: "【作弊】交換兩邊棋盤" }[e.c];
    const verb = { move: "移動", attack: "攻擊", drop: "空降", scout: "偵察", snipe: "狙擊", blow: "炸橋" }[e.k] || e.k;
    return `${verb}：${pos(e.f)} → ${pos(e.t)}`;
  }

  Object.assign(LZ, { RECORD_FORMAT, buildRecord, parseRecord, replayTo, variantForRecord, recordSteps: steps, describeStep: describe });
})(typeof window !== "undefined" ? window : globalThis);
