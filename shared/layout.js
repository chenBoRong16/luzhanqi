/* 佈局：檔案格式、匯入匯出、隨機產生 */
(function (root) {
  "use strict";
  const LZ = root.LZ || (root.LZ = {});

  const FORMAT = "luzhanqi-layout";

  /** 名稱 → 棋種 idx；"" / "空" / "營" / "-" ＝空格 */
  function nameToIdx(V, name) {
    if (name == null) return -1;
    const s = String(name).trim();
    if (s === "" || s === "空" || s === "營" || s === "-" || s === "·") return -1;
    const T = V.typeByName[s];
    return T ? T.idx : undefined;
  }

  /** 引擎 grid（idx）→ 檔案 grid（名稱） */
  function gridToNames(V, grid) {
    return grid.map((line) => line.map((t) => (t >= 0 ? V.types[t].name : "")));
  }

  /** opts.illegal：佈局不合一般規則（無視佈局條件時產生），檔案上標記 */
  function buildFile(V, name, myGrid, enemyGrid, opts = {}) {
    const obj = {
      format: FORMAT,
      variant: V.key,
      name: name || "未命名佈局",
      說明: `grid 每列 ${V.cols} 格，第一列是前線（靠中間），最後一列是大本營那排；空字串是空格（行營開局必須空著）。棋名可用繁體或簡體`,
    };
    if (V.ruleDefs && V.ruleDefs.length) obj.rules = Object.assign({}, V.rule);
    if (V.map) obj.map = { name: V.map.name, hash: V.mapHash };
    if (opts.illegal) obj.illegal = true;
    obj.grid = gridToNames(V, myGrid);
    if (enemyGrid) obj.enemyGrid = gridToNames(V, enemyGrid);
    return obj;
  }

  /** 改版前的規則組：舊兵力、所有擴充規則關閉（讀沒有 rules 欄位的舊擴充版檔） */
  function legacyRules(V) {
    const r = {};
    for (const d of V.ruleDefs || []) r[d.id] = false;
    return r;
  }

  /**
   * 規則組是否相同。opts.pieceOnly：只比會改變兵力的開關（佈局檔只跟「有哪些棋」有關）。
   */
  function sameRules(V, rules, opts = {}) {
    const norm = LZ.resolveRules(V.cfg || V, rules);
    const defs = (V.ruleDefs || []).filter((d) => !opts.pieceOnly || d.piece || d.id === "newArmy");
    return defs.every((d) => !!norm[d.id] === !!V.rule[d.id]);
  }

  /** 把檔案的 grid 轉成引擎 grid，並檢查格式（棋數規則另由 validateGrid 檢查） */
  function parseGrid(V, raw, label) {
    if (!Array.isArray(raw) || raw.length !== V.rows) {
      return { error: `${label}：應有 ${V.rows} 列` };
    }
    const grid = [];
    for (let row = 0; row < V.rows; row++) {
      let line = raw[row];
      if (typeof line === "string") line = line.trim().split(/[\s,，]+/);
      if (!Array.isArray(line) || line.length !== V.cols) {
        return { error: `${label} 第 ${row + 1} 列：應有 ${V.cols} 格` };
      }
      const out = [];
      for (let col = 0; col < V.cols; col++) {
        const t = nameToIdx(V, line[col]);
        if (t === undefined) return { error: `${label} 第 ${row + 1} 列第 ${col + 1} 格：不認得「${line[col]}」` };
        out.push(t);
      }
      grid.push(out);
    }
    return { grid };
  }

  /** 舊格式 pieces: [[col,row,name],...] */
  function parseOldPieces(V, list, label) {
    if (!Array.isArray(list)) return { error: `${label}：格式不對` };
    const grid = Array.from({ length: V.rows }, () => new Array(V.cols).fill(-1));
    for (const it of list) {
      const [col, row, name] = it || [];
      if (!(col >= 0 && col < V.cols && row >= 0 && row < V.rows)) return { error: `${label}：座標超出盤面` };
      const t = nameToIdx(V, name);
      if (t === undefined || t < 0) return { error: `${label}：不認得「${name}」` };
      grid[row][col] = t;
    }
    return { grid };
  }

  function parseFile(V, text) {
    let data;
    try { data = JSON.parse(text); } catch { return { error: "不是有效的 JSON" }; }
    if (!data || typeof data !== "object") return { error: "檔案內容無效" };
    // 改版前的「擴充版」檔（variant: "expanded"）視為擴充版-0
    const legacyExpanded = data.variant === "expanded" && V.key === "expanded0";
    if (data.variant && data.variant !== V.key && !legacyExpanded) {
      const label = { classic: "原版", expanded: "改版前的擴充版", expanded0: "擴充版-0", expanded1: "擴充版-1" }[data.variant] || data.variant;
      return { error: `這是「${label}」的佈局，不是本版的` };
    }
    // 規則組：檔案沒寫就是改版前規則；和目前不同時先回報，讓介面切換規則後再讀一次
    let rules = null;
    if (V.ruleDefs && V.ruleDefs.length) {
      rules = data.rules && typeof data.rules === "object" ? data.rules : legacyRules(V);
      if (!sameRules(V, rules, { pieceOnly: true })) return { name: data.name || "", rules, illegal: !!data.illegal, rulesMismatch: true };
    }
    // 地圖：檔案沒寫就是標準地圖；和目前不同時先回報，讓介面切換地圖後再讀一次
    if (V.map) {
      const want = data.map && data.map.hash ? data.map : { name: "標準", hash: standardHash(V) };
      if (want.hash !== V.mapHash) return { name: data.name || "", rules, map: want, illegal: !!data.illegal, mapMismatch: true };
    }
    let mine, enemy;
    if (data.grid) {
      mine = parseGrid(V, data.grid, "grid");
      if (data.enemyGrid) enemy = parseGrid(V, data.enemyGrid, "enemyGrid");
    } else if (data.pieces) {
      const keys = Object.keys(data.pieces);
      const hs = String(data.humanSide ?? 0);
      mine = parseOldPieces(V, data.pieces[hs] ?? data.pieces[keys[0]], "pieces");
      const ek = keys.find((k) => k !== hs);
      if (ek) enemy = parseOldPieces(V, data.pieces[ek], "pieces(敵方)");
    } else {
      return { error: "找不到 grid" };
    }
    if (mine.error) return { error: mine.error };
    if (enemy && enemy.error) return { error: enemy.error };
    return { name: data.name || "", rules, illegal: !!data.illegal, grid: mine.grid, enemyGrid: enemy ? enemy.grid : null };
  }

  /** 檢查 grid 是否為合法開局；loose＝無視佈局條件（只要格式對就好）；side＝放在哪一方（不對稱地圖用） */
  function validateGrid(V, grid, strictCount = true, loose = false, side = 0) {
    if (loose) return null;
    const counts = new Array(V.types.length).fill(0);
    for (let row = 0; row < V.rows; row++) {
      for (let col = 0; col < V.cols; col++) {
        const t = grid[row][col];
        if (t < 0) continue;
        counts[t]++;
        const err = LZ.placementError(V, V.types[t], col, row, side);
        if (err) return `${V.types[t].name}（第 ${row + 1} 列第 ${col + 1} 欄）：${err}`;
      }
    }
    if (strictCount) {
      for (const T of V.types) {
        if (counts[T.idx] !== T.count) return `${T.name} 應有 ${T.count} 顆，檔案裡有 ${counts[T.idx]} 顆`;
      }
    }
    return null;
  }

  /** 這一版的標準地圖雜湊（舊檔沒寫地圖時，就是用標準地圖） */
  function standardHash(V) {
    if (!V.cfg || !LZ.mapFromConfig) return null;
    if (!V.cfg._stdHash) V.cfg._stdHash = LZ.mapHash(LZ.standardMap ? LZ.standardMap(V.cfg.key) : LZ.mapFromConfig(V.cfg));
    return V.cfg._stdHash;
  }

  /**
   * 預設佈局；舊兵力用舊佈局；目前規則組沒有的棋，格子留空。
   * 自訂地圖（不是標準地圖）沒有預設佈局：用固定種子產生一個合法的隨機佈局。
   */
  function defaultGrid(V, side = 0) {
    if (V.map && V.mapHash !== standardHash(V)) {
      let seed = 20261002;
      const rng = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
      return randomGrid(V, rng, side);
    }
    const src = V.ruleDefs && V.ruleDefs.length && !V.rule.newArmy ? V.defaultLayoutOld : V.defaultLayout;
    return src.map((line) => line.map((n) => {
      const t = nameToIdx(V, n);
      return t === undefined ? -1 : t;
    }));
  }

  // ---------- 隨機佈局（電腦開局用） ----------

  /** rng: () => [0,1)；side：放在哪一方（不對稱地圖的大本營、地形可能不同） */
  function randomGrid(V, rng = Math.random, side = 0) {
    const { cols, rows } = V;
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(-1));
    const free = new Set();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const nd = V.nodes[V.id(side, col, row)];
        if (!nd.camp && !nd.mountain) free.add(row * cols + col);
      }
    }
    const put = (t, cell) => { grid[Math.floor(cell / cols)][cell % cols] = t; free.delete(cell); };
    const ok = (T, cell) => free.has(cell) && !LZ.placementError(V, T, cell % cols, Math.floor(cell / cols), side);
    const hqs = V.nodes.filter((n) => n.side === side && n.hq).map((n) => [n.col, n.row]);
    const byKind = (k) => V.types.find((T) => T.kind === k);

    // 1. 軍旗：隨機一個大本營
    const flag = byKind("flag");
    if (!hqs.length) throw new Error("沒有大本營");
    const [fc, fr] = hqs[Math.floor(rng() * hqs.length)];
    put(flag.idx, fr * cols + fc);

    // 2. 地雷：先圍住軍旗（左右、前方），剩下隨機放在可放雷的位置
    const mine = byKind("mine");
    let mines = mine.count;
    const guard = [[fc - 1, fr], [fc + 1, fr], [fc, fr - 1]].filter(([c, r]) => c >= 0 && c < cols && r >= 0);
    for (const [c, r] of guard) {
      if (mines > 0 && rng() < 0.85 && ok(mine, r * cols + c)) { put(mine.idx, r * cols + c); mines--; }
    }
    while (mines > 0) {
      const opts = [...free].filter((cell) => ok(mine, cell));
      if (!opts.length) throw new Error("地雷放不下");
      put(mine.idx, opts[Math.floor(rng() * opts.length)]);
      mines--;
    }

    // 3. 其他棋：依偏好位置加權隨機
    // 炸彈、雷達站不能放第一排，先放，免得最後只剩第一排
    const constrained = (T) => T.kind === "bomb" || T.kind === "radar";
    const order = V.types
      .filter((T) => T.kind !== "flag" && T.kind !== "mine")
      .sort((a, b) => constrained(b) - constrained(a) || b.rank - a.rank);
    for (const T of order) {
      for (let k = 0; k < T.count; k++) {
        const opts = [...free].filter((cell) => ok(T, cell));
        let best = null, bestScore = -Infinity;
        for (const cell of opts) {
          const s = prefer(V, T, cell % cols, Math.floor(cell / cols), side) + rng() * 4;
          if (s > bestScore) { bestScore = s; best = cell; }
        }
        if (best == null) throw new Error(`${T.name}放不下`);
        put(T.idx, best);
      }
    }
    return grid;
  }

  /** 各棋種偏好的位置（越大越想放） */
  function prefer(V, T, col, row, side = 0) {
    const depth = row / (V.rows - 1); // 0 前線 → 1 後排
    const center = 1 - Math.abs(col - (V.cols - 1) / 2) / ((V.cols - 1) / 2);
    const isHQ = V.nodes[V.id(side, col, row)].hq;
    const onRail = V.railRows.includes(row) || V.railCols.includes(col);
    if (isHQ) return T.kind === "normal" && T.rank <= 3 ? 1 : -6; // 大本營的棋動不了，放小棋
    switch (T.kind) {
      case "commander": return 3 - Math.abs(depth - 0.4) * 6 + center;
      case "bomb": return 2 - Math.abs(depth - 0.55) * 5;
      case "engineer": return depth * 3 + (onRail ? 1 : 0);
      case "spy": return 2 - Math.abs(depth - 0.5) * 4;
      case "scout": return 2 - depth * 2;
      case "para": return 1 - Math.abs(depth - 0.3) * 3;
      case "tank": return 2 - Math.abs(depth - 0.3) * 4 + (onRail ? 0.5 : 0);
      case "aa": return 2 - Math.abs(depth - 0.45) * 4 + center;
      case "radar": return 2 - Math.abs(depth - 0.4) * 4 + center;
      case "sniper": return 2 - Math.abs(depth - 0.25) * 4;
      default:
        if (T.rank >= 7) return 2.5 - Math.abs(depth - 0.35) * 5 + (onRail ? 0.8 : 0);
        if (T.rank >= 5) return 2 - Math.abs(depth - 0.3) * 4;
        return 2 - depth * 3;
    }
  }

  /** 讓 grid 一列一行，好讀也好手改 */
  function prettyLayout(obj) {
    const rows = (g) => "[\n" + g.map((line) => "    " + JSON.stringify(line)).join(",\n") + "\n  ]";
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
      parts.push(`  ${JSON.stringify(k)}: ${k === "grid" || k === "enemyGrid" ? rows(v) : JSON.stringify(v)}`);
    }
    return "{\n" + parts.join(",\n") + "\n}\n";
  }

  Object.assign(LZ, { FORMAT, prettyLayout, nameToIdx, gridToNames, buildFile, parseFile, validateGrid, defaultGrid, randomGrid, legacyRules, sameRules, standardHash });
})(typeof window !== "undefined" ? window : globalThis);
