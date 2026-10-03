/* 陸軍棋引擎：盤面、走法、對撞、資訊推理。三版共用，差異全在 config。
 * 擴充規則一律掛在 V.rule.xxx（規則開關）上；原版沒有規則表，V.rule 是空物件，行為和改版前完全相同
 * （tests/regress-classic.js 逐盤比對）。
 * 實體棋盤相容：規則狀態只有「位置、faceUp 明棋、stunned 翻倒、dropUsed 已空降、S.broken 斷橋、S.ruined 已炸毀、S.quiet 判和計數」。
 * cand（推理）、rec（棋譜）、stats（統計）、cheat（作弊）屬於介面或紀錄，不是規則狀態。
 * 不用 ES module，讓 index.html 直接雙擊（file://）就能玩；Node 測試用 vm 載入。 */
(function (root) {
  "use strict";
  const LZ = root.LZ || (root.LZ = {});

  // ---------- 版本（variant）建構 ----------

  /** 規則組：沒給的開關用預設（全開）；舊兵力時新棋強制關閉 */
  function resolveRules(cfg, rulesIn) {
    const defs = cfg.ruleDefs || [];
    const rule = {};
    for (const d of defs) rule[d.id] = rulesIn && d.id in rulesIn ? !!rulesIn[d.id] : d.def !== undefined ? d.def : true;
    if (defs.length && !rule.newArmy) for (const d of defs) if (d.piece) rule[d.id] = false;
    return rule;
  }

  /**
   * 把 config 展開成引擎用的結構：節點、公路鄰接、鐵路線、棋種表。
   * 擴充版一律走地圖（shared/map.js）：沒給地圖就用 config 換算的標準地圖，結果和舊建法逐項相同。
   * 原版沒有規則表，繼續用下面的固定參數建法。
   */
  /** 擴充版的預設地圖：手工設計的標準地圖（maps-builtin.js）；沒載入時用 config 換算 */
  function defaultMap(cfg) {
    return LZ.standardMap ? LZ.standardMap(cfg.key) : LZ.mapFromConfig(cfg);
  }

  function buildVariant(cfg, rulesIn, map) {
    const rule = resolveRules(cfg, rulesIn);
    if ((cfg.ruleDefs || []).length && LZ.geometryFromMap) return buildFromMap(cfg, rule, map || defaultMap(cfg));
    const V = Object.assign({}, cfg);
    const { cols, rows } = cfg;
    V.cfg = cfg;
    V.rule = rule;
    V.ruleDefs = cfg.ruleDefs || [];
    V.half = cols * rows;
    V.nNodes = 2 * V.half;
    V.id = (side, col, row) => side * V.half + row * cols + col;

    const toSet = (list) => new Set((list || []).map(([c, r]) => r * cols + c));
    const campSet = toSet(cfg.camps);
    const hqSet = toSet(cfg.hqs);
    const forestSet = toSet(rule.forest ? cfg.forests : []);
    const bunkerSet = toSet(rule.bunker ? cfg.bunkers : []);
    V.nodes = [];
    for (let side = 0; side < 2; side++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const local = row * cols + col;
          V.nodes.push({
            id: V.id(side, col, row), side, col, row,
            // 全盤座標：上方（side 1）的後排在最上面，下方（side 0）的後排在最下面
            gx: col,
            gy: side === 0 ? rows + row : rows - 1 - row,
            camp: campSet.has(local),
            hq: hqSet.has(local),
            forest: forestSet.has(local),
            bunker: bunkerSet.has(local),
            rail: false,
          });
        }
      }
    }

    // 公路：半場內正交相鄰全通；行營四個斜角也通；過河口通
    const adj = Array.from({ length: V.nNodes }, () => new Set());
    const link = (a, b) => { adj[a].add(b); adj[b].add(a); };
    for (let side = 0; side < 2; side++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const a = V.id(side, col, row);
          if (col + 1 < cols) link(a, V.id(side, col + 1, row));
          if (row + 1 < rows) link(a, V.id(side, col, row + 1));
        }
      }
      for (const [c, r] of cfg.camps) {
        for (const dc of [-1, 1]) {
          for (const dr of [-1, 1]) {
            const nc = c + dc, nr = r + dr;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
              link(V.id(side, c, r), V.id(side, nc, nr));
            }
          }
        }
      }
    }
    for (const c of [...cfg.railCross, ...(cfg.roadCross || [])]) {
      link(V.id(0, c, 0), V.id(1, c, 0));
    }
    V.adj = adj.map((s) => [...s]);

    // 鐵路線：非工兵只能沿單一條線直走
    const lines = [];
    for (let side = 0; side < 2; side++) {
      for (const r of cfg.railRows) {
        const L = [];
        for (let c = 0; c < cols; c++) L.push(V.id(side, c, r));
        lines.push(L);
      }
    }
    const end = cfg.railColEnd;
    for (const c of cfg.railCols) {
      const down = [];
      for (let r = end; r >= 0; r--) down.push(V.id(0, c, r));
      const up = [];
      for (let r = 0; r <= end; r++) up.push(V.id(1, c, r));
      if (cfg.railCross.includes(c)) lines.push(down.concat(up));
      else { lines.push(down); lines.push(up); }
    }
    for (const c of cfg.railCross) {
      if (!cfg.railCols.includes(c)) lines.push([V.id(0, c, 0), V.id(1, c, 0)]);
    }
    V.lines = lines;
    V.lineIndex = Array.from({ length: V.nNodes }, () => []);
    const railAdj = Array.from({ length: V.nNodes }, () => new Set());
    lines.forEach((L, li) => {
      L.forEach((n, pos) => {
        V.lineIndex[n].push([li, pos]);
        V.nodes[n].rail = true;
        if (pos > 0) { railAdj[n].add(L[pos - 1]); railAdj[L[pos - 1]].add(n); }
      });
    });
    V.railAdj = railAdj.map((s) => [...s]);
    buildTypes(V, cfg, rule);
    return V;
  }

  /** 擴充版：從地圖建盤面 */
  function buildFromMap(cfg, rule, map) {
    const V = Object.assign({}, cfg);
    const G = LZ.geometryFromMap(map, rule);
    V.cfg = cfg;
    V.rule = rule;
    V.ruleDefs = cfg.ruleDefs || [];
    V.map = map;
    V.mapHash = LZ.mapHash(map);
    V.cols = map.cols;
    V.rows = map.rows;
    V.half = V.cols * V.rows;
    V.nNodes = 2 * V.half;
    V.id = (side, col, row) => side * V.half + row * V.cols + col;
    Object.assign(V, {
      nodes: G.nodes, adj: G.adj, lines: G.lines, lineGauge: G.lineGauge, lineIndex: G.lineIndex,
      railAdj: G.railAdj, railCross: G.railCross, roadCross: G.roadCross, railEdge: G.railEdge,
    });
    // 舊程式還會讀的清單（以我方半場為準）
    V.camps = V.nodes.filter((n) => n.side === 0 && n.camp).map((n) => [n.col, n.row]);
    V.hqs = V.nodes.filter((n) => n.side === 0 && n.hq).map((n) => [n.col, n.row]);
    buildTypes(V, cfg, rule);
    return V;
  }

  function buildTypes(V, cfg, rule) {
    // 棋種（依規則組過濾；舊兵力用 countOld）
    const oldArmy = V.ruleDefs.length > 0 && !rule.newArmy;
    const pieces = cfg.pieces
      .filter((p) => !p.rule || rule[p.rule])
      .map((p) => Object.assign({}, p, {
        // 舊兵力用 countOld；大翻新前的新兵力用 countPreV3（工兵 4、連長 2、排長 2）
        count: oldArmy && p.countOld != null ? p.countOld : V.ruleDefs.length && !rule.v3 && p.countPreV3 != null ? p.countPreV3 : p.count,
        // 大翻新前的舊棋譜用舊等級表
        rank: V.ruleDefs.length && !rule.v3 && p.rankOld != null ? p.rankOld : p.rank,
      }));
    V.pieces = pieces;
    V.types = pieces.map((p, i) => Object.assign({ idx: i, mobile: true }, p));
    for (const T of V.types) {
      if (T.kind === "flag" || T.kind === "mine" || T.kind === "radar") T.mobile = false;
    }
    V.typeByName = Object.create(null);
    for (const T of V.types) V.typeByName[T.name] = T;
    for (const [alias, name] of Object.entries(cfg.aliases || {})) {
      if (V.typeByName[name]) V.typeByName[alias] = V.typeByName[name];
    }
    V.fullMask = (1 << V.types.length) - 1;
    V.mobileMask = 0;
    for (const T of V.types) if (T.mobile) V.mobileMask |= 1 << T.idx;
    V.kindIdx = Object.create(null);
    for (const T of V.types) if (!(T.kind in V.kindIdx)) V.kindIdx[T.kind] = T.idx;
    V.armySize = V.types.reduce((s, T) => s + T.count, 0);

    // 碉堡加級：等級表往上一格（最高者 +1）
    const ladder = [...new Set(V.types.filter(rankedKind).map((T) => T.rank))].sort((a, b) => a - b);
    V.rankUp = V.types.map((T) => {
      const i = ladder.indexOf(T.rank);
      return i >= 0 && i + 1 < ladder.length ? ladder[i + 1] : T.rank + 1;
    });
  }

  /** 有比等級的棋（炸彈、地雷、軍旗、雷達站不比等級） */
  function rankedKind(T) {
    return T.kind !== "bomb" && T.kind !== "mine" && T.kind !== "flag" && T.kind !== "radar";
  }

  // ---------- 佈陣規則 ----------

  /** 某棋種能否在開局放在第 side 方的 (col,row)（row 0＝前線）；不對稱地圖要指定 side */
  function placementError(V, T, col, row, side = 0) {
    const nd = V.nodes[V.id(side, col, row)];
    const isCamp = nd.camp;
    const isHQ = nd.hq;
    if (nd.mountain) return "高山不能放棋";
    if (isCamp) return "行營開局必須空著";
    if (nd.swamp && V.rule.v3) return "沼澤開局不能放棋";
    if (nd.swamp && (T.kind === "tank" || T.kind === "mine" || T.kind === "flag" || T.kind === "radar")) {
      return `沼澤不能放${T.name}`;
    }
    if (T.kind === "flag" && !isHQ) return "軍旗必須放在大本營";
    if (T.kind === "mine" && row < V.rows - V.mineRows) return `地雷只能放最後 ${V.mineRows} 排`;
    if (T.kind === "bomb" && row === 0) return "炸彈不能放第一排";
    if (T.kind === "radar" && row === 0) return "雷達站不能放第一排";
    return null;
  }

  /** 開局位置對對手透露的資訊：在 (col,row) 開局的棋可能是哪些棋種 */
  function originMask(V, col, row, side = 0) {
    let m = 0;
    for (const T of V.types) {
      if (!placementError(V, T, col, row, side)) m |= 1 << T.idx;
    }
    return m;
  }

  // ---------- 對撞 ----------

  const NO_RULES = { rule: {}, nodes: [] };

  /** 防守方實際比較的等級（碉堡加級） */
  function defRank(V, D, to) {
    if (V.rule.bunker && !V.rule.v3 && to != null && V.nodes[to].bunker && rankedKind(D)) return V.rankUp[D.idx];
    return D.rank;
  }

  /**
   * A 攻擊站在 to 格的 D：flag（奪旗）、win（D 移除）、lose（A 移除）、both（同歸於盡）。
   * 只比等級或固定的剋制關係，沒有數值計算（實體棋盤相容）。
   */
  function resolveAt(V, A, D, to) {
    const R = V.rule;
    if (D.kind === "flag") return "flag";
    if (A.kind === "bomb" || D.kind === "bomb") return "both";
    if (D.kind === "mine") {
      if (A.kind === "engineer") return "win";
      // 坦克：大翻新後和一般棋一樣撞雷就移除；隱藏開關 tankMine（舊棋譜、實驗用）開著時坦克破雷
      if (A.kind === "tank" && R.tankMine) return "win";
      if (A.kind === "tank" && !R.v3) return "both";
      return "lose";
    }
    if (!R.v3) {
      // 大翻新前的特例（舊棋譜用）；大翻新後由等級比較得到相同結果
      if (D.kind === "radar") return "win";
      if (D.kind === "aa" && A.kind === "para") return "lose";
    }
    if (A.kind === "spy" && D.kind === "commander") return "win";
    const dr = defRank(V, D, to);
    if (A.rank > dr) return "win";
    if (A.rank < dr) return "lose";
    return "both";
  }

  /** 不看規則與地形的對撞（原版、舊程式用） */
  function resolve(A, D) {
    return resolveAt(NO_RULES, A, D, null);
  }

  /** 狙擊是否命中：目標實際等級比營長小；炸彈、地雷、軍旗一律不中 */
  function snipeHits(V, D, to) {
    if (D.kind === "bomb" || D.kind === "mine" || D.kind === "flag") return false;
    return (V.rule.v3 ? D.rank : defRank(V, D, to)) < V.snipeRank;
  }

  // ---------- 遊戲狀態 ----------

  function newStats() {
    const pair = () => [0, 0];
    return {
      kills: [{}, {}], drop: pair(), scout: pair(), snipe: pair(), snipeHit: pair(), blow: pair(),
      bunkerDef: pair(), forest: pair(), radar: pair(), tank2: pair(),
      swamp: pair(), village: pair(), tank3: pair(), narrow: pair(), gaugeStop: pair(),
      blast: pair(), hqEnter: pair(), hqExit: pair(), dropShot: pair(),
    };
  }

  function newGame(V) {
    return {
      V,
      phase: "deploy", // deploy | play | end
      board: new Array(V.nNodes).fill(null),
      turn: 0,
      human: 0,
      winner: null, // 0 | 1 | -1(和)
      endReason: "",
      ply: 0,
      quiet: 0, // 連續無對撞的步數（盤邊計數軌）
      lastMove: null,
      log: [],
      nextPid: 1,
      startGrids: [null, null],
      deadKnown: [new Array(V.types.length).fill(0), new Array(V.types.length).fill(0)],
      lost: [[], []], // 各方被移除的棋（棋種 idx），供統計
      broken: [], // 斷掉的橋（欄號）
      ruined: [], // 被工兵爆破的防護格（格子編號）
      illegal: [false, false], // 該方開局用了違規佈局（無視佈局條件）
      cheat: {
        infinite: false, reveal: false, feed: false, add: false, del: false, drag: false,
        swap: false, undo: false, ignorePlacement: false, used: false,
      },
      history: [],
      rec: [], // 棋譜
      recStart: null,
      stats: newStats(),
      _fx: {},
    };
  }

  function makePiece(S, t, side) {
    return {
      pid: S.nextPid++, t, side,
      moved: false, dropUsed: false, mark: null, faceUp: false, stunned: false,
      cand: [S.V.fullMask, S.V.fullMask], // cand[k]＝k 方眼中這顆棋可能的棋種
    };
  }

  /** grid[row][col]＝棋種 idx 或 -1；row 0 為前線 */
  function setSideGrid(S, side, grid) {
    const V = S.V;
    for (let row = 0; row < V.rows; row++) {
      for (let col = 0; col < V.cols; col++) {
        const n = V.id(side, col, row);
        const t = grid[row] ? grid[row][col] : -1;
        S.board[n] = t >= 0 ? makePiece(S, t, side) : null;
      }
    }
  }

  function sideGrid(S, side) {
    const V = S.V;
    const grid = [];
    for (let row = 0; row < V.rows; row++) {
      const line = [];
      for (let col = 0; col < V.cols; col++) {
        const p = S.board[V.id(side, col, row)];
        line.push(p && p.side === side ? p.t : -1);
      }
      grid.push(line);
    }
    return grid;
  }

  /** 檢查一方佈陣；strictCount=false 時只檢查位置（作弊改過棋時用） */
  function validateSide(S, side, strictCount = true) {
    const V = S.V;
    const counts = new Array(V.types.length).fill(0);
    for (let row = 0; row < V.rows; row++) {
      for (let col = 0; col < V.cols; col++) {
        const p = S.board[V.id(side, col, row)];
        if (!p || p.side !== side) continue;
        const T = V.types[p.t];
        counts[p.t]++;
        const err = placementError(V, T, col, row, side);
        if (err) return `${T.name}（第 ${row + 1} 列第 ${col + 1} 欄）：${err}`;
      }
    }
    if (strictCount) {
      for (const T of V.types) {
        if (counts[T.idx] !== T.count) return `${T.name} 應有 ${T.count} 顆，現在 ${counts[T.idx]} 顆`;
      }
    }
    return null;
  }

  function namesGrid(S, grid) {
    return grid.map((line) => line.map((t) => (t >= 0 ? S.V.types[t].name : "")));
  }

  function startPlay(S, first = 0) {
    const strict = !S.cheat.used;
    for (const side of [0, 1]) {
      const err = validateSide(S, side, strict);
      if (err && !S.cheat.ignorePlacement) return (side === S.human ? "我方佈陣：" : "敵方佈陣：") + err;
      S.illegal[side] = !!err;
    }
    const V = S.V;
    for (const nd of V.nodes) {
      const p = S.board[nd.id];
      if (!p) continue;
      // 違規佈局的一方，開局位置不透露任何資訊
      p.cand[1 - p.side] = S.illegal[p.side] ? V.fullMask : originMask(V, nd.col, nd.row, nd.side);
      p.cand[p.side] = 1 << p.t;
    }
    S.startGrids = [sideGrid(S, 0), sideGrid(S, 1)];
    S.phase = "play";
    S.turn = first;
    S.ply = 0;
    S.quiet = 0;
    S.lastMove = null;
    S.history = [];
    S.rec = [];
    S.stats = newStats();
    S.ruined = [];
    S.recStart = {
      first, human: S.human, rules: Object.assign({}, V.rule), illegal: S.illegal.slice(), cheatUsed: S.cheat.used,
      map: V.map || null,
      drawQuiet: S.drawQuiet != null && S.drawQuiet !== V.drawQuiet ? S.drawQuiet : undefined,
      grids: [namesGrid(S, S.startGrids[0]), namesGrid(S, S.startGrids[1])],
    };
    S.log.push("── 對戰開始 ──");
    updateRadar(S);
    checkStuck(S);
    return null;
  }

  // ---------- 走法 ----------

  /**
   * 防護格：裡面的棋不能被攻擊。原版、舊規則：行營。大翻新後：行營、碉堡，被工兵爆破過的除外。
   */
  function isProtected(S, n) {
    const V = S.V, nd = V.nodes[n], R = V.rule;
    if (!R.v3) return !!nd.camp;
    if (!(nd.camp || (R.bunker && nd.bunker))) return false;
    return !(S.ruined && S.ruined.includes(n));
  }

  /** 工兵能爆破的相鄰格：公路一格（含行營斜線，略過斷橋），或鐵路上一格 */
  function blastNbrs(S, n) {
    const V = S.V;
    return new Set([...roadNbrs(S, n), ...(V.nodes[n].rail && V.railAdj ? V.railAdj[n] || [] : [])]);
  }

  /**
   * 視線：從 n 看得到的格子（不含 n）。沿公路距離 dist 以內；目標在平原上時距離多 1；
   * 森林、村莊裡看不到。雷達站、防空炮共用
   */
  function sightCells(S, n, dist) {
    const V = S.V, R = V.rule;
    const pairs = R.plain ? roadDistances(S, n, dist + 1).filter(([m, d]) => d <= dist || V.nodes[m].plain) : roadDistances(S, n, dist);
    return pairs.map(([m]) => m).filter((m) => m !== n && !(R.forest && V.nodes[m].forest) && !(R.village && V.nodes[m].village));
  }

  /** 傘兵落在 to 時，哪些格子上的防空炮會開火（不看那格有沒有棋） */
  function aaCoverCells(S, to) {
    const V = S.V, R = V.rule;
    if (!R.aaSight) return V.adj[to];
    // 視線距離對稱：落點在防空炮的視線 1 以內（落點在平原時 2）
    const out = [];
    const reach = R.plain && V.nodes[to].plain ? 2 : 1;
    for (const [m, d] of roadDistances(S, to, reach)) if (m !== to && d <= reach) out.push(m);
    return out;
  }

  /** 公路鄰居（略過斷掉的橋） */
  function roadNbrs(S, n) {
    const V = S.V;
    if (!S.broken || !S.broken.length) return V.adj[n];
    const a = V.nodes[n];
    return V.adj[n].filter((m) => {
      const b = V.nodes[m];
      return a.side === b.side || !S.broken.includes(a.col);
    });
  }

  /** 從 n 沿公路正交方向 (dx,dy) 走一格的格子，沒有就回傳 -1 */
  function stepOrth(S, n, dx, dy) {
    const V = S.V;
    const a = V.nodes[n];
    for (const m of roadNbrs(S, n)) {
      const b = V.nodes[m];
      if (b.gx - a.gx === dx && b.gy - a.gy === dy) return m;
    }
    return -1;
  }
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /**
   * 以棋種 T 從 from 出發的所有合法動作（不看 board[from] 的真實棋種，供 AI 假設用）。
   * 回傳 [{to, kind}]，kind：move | attack | drop 空降 | scout 偵察 | snipe 狙擊 | blow 炸橋
   */
  function movesFor(S, from, T, side, dropUsed) {
    const V = S.V, B = S.board, R = V.rule;
    const out = [];
    if (!T.mobile) return out;
    // 大本營：大翻新後任何棋都能走出來（開關「棋可以走出大本營」）；否則進了就不能動
    if (V.nodes[from].hq && !(R.v3 && R.hqExit)) return out;
    const seen = new Set();
    const add = (to, kind) => { if (!seen.has(to)) { seen.add(to); out.push({ to, kind }); } };
    // 工兵爆破：相鄰（公路一格、含行營斜線，或鐵路一格）、沒被炸毀、裡面沒有自己棋的防護格（空的也可以）
    // 舊棋譜用的隱藏開關：blastFar＝沿鐵路走得到的都能炸；blastAny 關＝只能炸對方半場
    const blastTo = [];
    const canBlast = T.kind === "engineer" && R.v3 && R.blast;
    const blastNear = canBlast && !R.blastFar ? blastNbrs(S, from) : null;
    // 沼澤：坦克進不去（含攻擊沼澤裡的棋）；炸彈是步兵背的炸藥，可以進去
    const swampBan = R.swamp && T.kind === "tank";
    // 坦克走兩格時，中間那格除了要空，也不能是沼澤或森林（整段路要暢通）
    const tankBlocked = (n) => (R.swamp && V.nodes[n].swamp) || (R.forest && V.nodes[n].forest);
    // 回傳是否可以穿過（空格）
    const consider = (to) => {
      if (swampBan && V.nodes[to].swamp) return false;
      const q = B[to];
      if (canBlast && (!blastNear || blastNear.has(to)) && (R.blastAny || V.nodes[to].side !== side) && isProtected(S, to) && (!q || q.side !== side) && !blastTo.includes(to)) blastTo.push(to);
      if (!q) { add(to, "move"); return true; }
      if (q.side !== side && !isProtected(S, to)) add(to, "attack");
      return false;
    };
    // 村莊：從村莊出發，這一手只能走公路一格（不上鐵路、坦克不衝、不空降）
    const villageStart = R.village && V.nodes[from].village;

    for (const n of roadNbrs(S, from)) consider(n);

    if (V.nodes[from].rail && !villageStart) {
      if (T.kind === "engineer" && R.gauge && V.railEdge) {
        // 工兵可以轉彎；換軌站要停下；窄軌合計最多 3 格
        const used = new Map([[from, 0]]);
        const queue = [from];
        while (queue.length) {
          const u = queue.shift();
          if (u !== from && V.nodes[u].gaugeBreak) continue;
          for (const v of V.railAdj[u]) {
            const g = V.railEdge.get(u < v ? `${u}-${v}` : `${v}-${u}`);
            const k = used.get(u) + (g === "narrow" ? 1 : 0);
            if (k > 3 || (used.has(v) && used.get(v) <= k)) continue;
            used.set(v, k);
            if (consider(v)) queue.push(v);
          }
        }
      } else if (T.kind === "engineer") {
        const vis = new Set([from]);
        const queue = [from];
        while (queue.length) {
          const u = queue.shift();
          for (const v of V.railAdj[u]) {
            if (vis.has(v)) continue;
            vis.add(v);
            if (consider(v)) queue.push(v);
          }
        }
      } else {
        for (const [li, pos] of V.lineIndex[from]) {
          const L = V.lines[li];
          // 窄軌：最多 3 格，坦克不能上（鐵路線已在換軌站切開，所以會自然停在換軌站）
          const narrow = R.gauge && V.lineGauge && V.lineGauge[li] === "narrow";
          if (narrow && T.kind === "tank") continue;
          const cap = narrow ? 3 : Infinity;
          for (const dir of [-1, 1]) {
            for (let i = pos + dir, k = 1; i >= 0 && i < L.length && k <= cap; i += dir, k++) {
              if (!consider(L[i])) break;
            }
          }
        }
      }
    }

    // 窄軌可沿線轉彎：坦克、工兵以外的棋順著窄軌走，合計最多 3 格；換軌站要停下（起點除外）
    if (R.gauge && V.railEdge && V.nodes[from].rail && !villageStart && T.kind !== "tank" && T.kind !== "engineer") {
      const used = new Map([[from, 0]]);
      const queue = [from];
      while (queue.length) {
        const u = queue.shift();
        if (u !== from && V.nodes[u].gaugeBreak) continue;
        const k = used.get(u) + 1;
        if (k > 3) continue;
        for (const v of V.railAdj[u]) {
          if (used.has(v) || V.railEdge.get(u < v ? `${u}-${v}` : `${v}-${u}`) !== "narrow") continue;
          used.set(v, k);
          if (consider(v)) queue.push(v);
        }
      }
    }

    if (T.kind === "tank" && !villageStart) {
      if (R.tankTurn) {
        // 兩步正交，可以轉一次彎；第一步必須是空格
        for (const [dx, dy] of ORTH) {
          const m = stepOrth(S, from, dx, dy);
          if (m < 0 || B[m] || tankBlocked(m)) continue;
          for (const [ex, ey] of ORTH) {
            if (ex === -dx && ey === -dy) continue;
            const k = stepOrth(S, m, ex, ey);
            if (k >= 0) consider(k);
          }
        }
      } else {
        const a = V.nodes[from];
        for (const m of roadNbrs(S, from)) {
          const b = V.nodes[m];
          const dx = b.gx - a.gx, dy = b.gy - a.gy;
          if (Math.abs(dx) + Math.abs(dy) !== 1 || B[m] || tankBlocked(m)) continue;
          for (const k of roadNbrs(S, m)) {
            const c = V.nodes[k];
            if (c.gx - b.gx === dx && c.gy - b.gy === dy) consider(k);
          }
        }
      }
      // 平原：整段路（含起點、終點）都是平原時可以走 3 格；仍然最多轉一次彎、中間格要空
      if (R.plain && V.nodes[from].plain) {
        const plain = (n) => n >= 0 && V.nodes[n].plain;
        for (const d1 of ORTH) {
          const m1 = stepOrth(S, from, d1[0], d1[1]);
          if (!plain(m1) || B[m1]) continue;
          for (const d2 of ORTH) {
            if (d2[0] === -d1[0] && d2[1] === -d1[1]) continue;
            if (!R.tankTurn && d2 !== d1) continue;
            const m2 = stepOrth(S, m1, d2[0], d2[1]);
            if (!plain(m2) || B[m2]) continue;
            for (const d3 of ORTH) {
              if (d3[0] === -d2[0] && d3[1] === -d2[1]) continue;
              if ((d2 !== d1) + (d3 !== d2) > 1) continue;
              if (!R.tankTurn && d3 !== d1) continue;
              const k = stepOrth(S, m2, d3[0], d3[1]);
              if (plain(k) && k !== from) consider(k);
            }
          }
        }
      }
    }

    if (T.kind === "para" && !dropUsed && !villageStart) {
      // 防空：對方防空炮相鄰的格子不能空降
      let blocked = null;
      // 舊規則：防空炮旁的格子直接不能選（會洩漏防空炮的位置）；大翻新後改成落地時判定擊落
      if (R.aa && !R.v3) {
        blocked = new Set();
        for (let n = 0; n < B.length; n++) {
          const q = B[n];
          if (q && q.side !== side && V.types[q.t].kind === "aa") for (const m of V.adj[n]) blocked.add(m);
        }
      }
      for (const nd of V.nodes) {
        if (nd.side === side || nd.row >= V.dropRows || nd.camp || nd.hq || nd.mountain) continue;
        if (blocked && blocked.has(nd.id)) continue;
        // 沼澤、村莊不能空降；大翻新後只能落在一般格或平原
        if ((R.swamp && nd.swamp) || (R.village && nd.village)) continue;
        if (R.v3 && (nd.forest || nd.bunker)) continue;
        if (!B[nd.id] && !seen.has(nd.id)) { seen.add(nd.id); out.push({ to: nd.id, kind: "drop" }); }
      }
    }

    if (T.kind === "scout") {
      // 森林、村莊裡的棋看不到
      const hidden = (n) => (R.forest && V.nodes[n].forest) || (R.village && V.nodes[n].village);
      const canScout = (n) => {
        const q = B[n];
        return q && q.side !== side && popcount(q.cand[side]) > 1 && !hidden(n);
      };
      if (R.plain) {
        // 目標站在平原上時範圍多 1 格
        const base = R.scout2 ? 2 : 1;
        for (const [n, d] of roadDistances(S, from, base + 1)) {
          if (d <= base + (V.nodes[n].plain ? 1 : 0) && canScout(n)) out.push({ to: n, kind: "scout" });
        }
      } else if (R.scout2) {
        const near = new Set(roadNbrs(S, from));
        const ring = new Set(near);
        for (const m of near) for (const k of roadNbrs(S, m)) if (k !== from) ring.add(k);
        for (const n of ring) if (canScout(n)) out.push({ to: n, kind: "scout" });
      } else {
        for (const n of V.adj[from]) if (canScout(n)) out.push({ to: n, kind: "scout" });
      }
    }

    if (T.kind === "sniper" && R.sniper) {
      for (const [dx, dy] of ORTH) {
        const m = stepOrth(S, from, dx, dy);
        if (m < 0 || B[m]) continue;
        const k = stepOrth(S, m, dx, dy);
        if (k < 0) continue;
        const q = B[k];
        // 行營、森林、村莊裡的棋不能當目標（建築物、樹林擋住視線）
        if (q && q.side !== side && !isProtected(S, k) && !(R.forest && V.nodes[k].forest) && !(R.village && V.nodes[k].village)) {
          out.push({ to: k, kind: "snipe" });
        }
      }
    }

    for (const to of blastTo) out.push({ to, kind: "blast" });

    if (T.kind === "bomb" && R.bridgeBlow) {
      const a = V.nodes[from];
      if (a.row === 0 && (V.roadCross || []).includes(a.col) && !S.broken.includes(a.col)) {
        out.push({ to: V.id(1 - a.side, a.col, 0), kind: "blow" });
      }
    }
    return out;
  }

  /** 從 n 走公路的距離表（不看格子有沒有棋），回傳 [[格子, 距離], ...]，依發現順序、不含起點 */
  function roadDistances(S, n, maxD) {
    const dist = new Map([[n, 0]]);
    const order = [];
    let frontier = [n];
    for (let d = 1; d <= maxD; d++) {
      const next = [];
      for (const u of frontier) {
        for (const v of roadNbrs(S, u)) {
          if (dist.has(v)) continue;
          dist.set(v, d);
          order.push([v, d]);
          next.push(v);
        }
      }
      frontier = next;
    }
    return order;
  }

  function legalMoves(S, from) {
    const p = S.board[from];
    if (!p || p.stunned) return [];
    return movesFor(S, from, S.V.types[p.t], p.side, p.dropUsed);
  }

  function hasAnyMove(S, side) {
    const B = S.board;
    for (let n = 0; n < B.length; n++) {
      const p = B[n];
      if (p && p.side === side && legalMoves(S, n).length) return true;
    }
    return false;
  }

  function popcount(m) {
    let c = 0;
    while (m) { m &= m - 1; c++; }
    return c;
  }

  function singleType(m) {
    return popcount(m) === 1 ? 31 - Math.clz32(m) : -1;
  }

  // ---------- 執行 ----------

  function sideLabel(S, side) {
    return side === S.human ? "我方" : "敵方";
  }

  /** 翻成明棋：雙方都知道它是什麼（實體棋盤＝正面朝上） */
  function reveal(p) {
    p.faceUp = true;
    p.cand[0] = p.cand[1] = 1 << p.t;
  }

  /** 地形統計與音效用的事件旗標：換軌站停下、窄軌、坦克在平原走 3 格 */
  function terrainMoveStats(S, from, to, p, ev) {
    const V = S.V, R = V.rule;
    if (!R.gauge && !R.plain) return;
    if (V.adj[from].includes(to)) return;
    const kind = V.types[p.t].kind;
    let line = -1;
    for (const [li] of V.lineIndex[from]) if (V.lineIndex[to].some(([lj]) => lj === li)) line = li;
    if (line >= 0 || (kind === "engineer" && V.nodes[to].rail)) {
      if (R.gauge && V.nodes[to].gaugeBreak) { S.stats.gaugeStop[p.side]++; ev.gaugeStop = true; }
      // 窄軌：沿窄軌直線走，或工兵轉彎走到窄軌上的格子
      const onNarrow = (x) => V.railEdge && V.railAdj[x].some((y) => V.railEdge.get(x < y ? `${x}-${y}` : `${y}-${x}`) === "narrow");
      if (R.gauge && (line >= 0 ? V.lineGauge[line] === "narrow" : onNarrow(to))) { S.stats.narrow[p.side]++; ev.narrow = true; }
    } else if (R.gauge && kind !== "tank" && V.nodes[from].rail && V.nodes[to].rail) {
      // 不在同一條直線上、又不是相鄰：只可能是沿窄軌轉彎
      if (V.nodes[to].gaugeBreak) { S.stats.gaugeStop[p.side]++; ev.gaugeStop = true; }
      S.stats.narrow[p.side]++;
      ev.narrow = true;
    } else if (kind === "tank" && R.plain && V.nodes[from].plain && V.nodes[to].plain && !withinTwo(S, from, to)) {
      S.stats.tank3[p.side]++;
      ev.tank3 = true;
    }
  }
  /** 兩格以內（第一格要空）到得了嗎：分辨坦克平原的第 3 格 */
  function withinTwo(S, from, to) {
    for (const m of roadNbrs(S, from)) {
      if (m === to) return true;
      if (!S.board[m] && roadNbrs(S, m).includes(to)) return true;
    }
    return false;
  }

  /** 對手看到這步棋之後，能推得這顆棋是哪種特殊棋（工兵鐵路轉彎、坦克兩步）。這是推理，不翻明棋 */
  function revealByMovement(S, from, to, p) {
    const V = S.V;
    const T = V.types[p.t];
    if (T.kind !== "engineer" && T.kind !== "tank") return;
    const generic = movesFor(S, from, { kind: "normal", mobile: true }, p.side, true);
    if (!generic.some((m) => m.to === to)) {
      p.cand[1 - p.side] = 1 << p.t;
      if (T.kind === "tank" && S.stats) S.stats.tank2[p.side]++;
    }
  }

  function filterMask(V, mask, pred) {
    let out = 0;
    for (const T of V.types) {
      if (mask & (1 << T.idx) && pred(T)) out |= 1 << T.idx;
    }
    return out;
  }

  /** killer：造成移除的一方（統計用），可省略 */
  function removePiece(S, n, killer) {
    const p = S.board[n];
    if (!p) return;
    S.board[n] = null;
    S.lost[p.side].push(p.t);
    const obs = 1 - p.side;
    const known = singleType(p.cand[obs]);
    if (known >= 0) S.deadKnown[obs][known]++;
    const T = S.V.types[p.t];
    if (killer != null && S.stats) {
      const k = S.stats.kills[killer];
      k[T.name] = (k[T.name] || 0) + 1;
    }
    if (T.kind === "commander") S._fx.commanderDown = true;
    if (T.kind === "commander" && S.V.commanderRevealsFlag) {
      for (const q of S.board) {
        if (q && q.side === p.side && S.V.types[q.t].kind === "flag") {
          if (S.V.boardMode) reveal(q);
          else q.cand[obs] = 1 << q.t;
        }
      }
      S.log.push(`${sideLabel(S, p.side)}司令陣亡，亮出軍旗位置`);
    }
  }

  /** 雷達：相鄰敵棋（不在森林）翻成明棋 */
  function updateRadar(S) {
    const V = S.V;
    if (!V.rule.radar) return;
    const B = S.board;
    for (let n = 0; n < B.length; n++) {
      const r = B[n];
      if (!r || V.types[r.t].kind !== "radar") continue;
      // 範圍 1 格；目標站在平原上時 2 格。森林、村莊裡的看不到
      for (const m of sightCells(S, n, 1)) {
        const q = B[m];
        if (!q || q.side === r.side || q.faceUp) continue;
        reveal(q);
        S._fx.radar = true;
        S.stats.radar[r.side]++;
        S.log.push(`${sideLabel(S, r.side)}雷達站：揭露${r.side === S.human ? "一顆敵棋（" + V.types[q.t].name + "）" : "我方一顆棋"}`);
      }
    }
  }

  /**
   * 執行一個動作。mv＝legalMoves 回傳的元素。
   * 回傳事件 {kind, result?}，供 UI 顯示。
   */
  function applyMove(S, from, mv) {
    const V = S.V, B = S.board, R = V.rule;
    const p = B[from];
    const T = V.types[p.t];
    const opp = 1 - p.side;
    const ev = { kind: mv.kind, from, to: mv.to, side: p.side, attacker: p.t, defender: null, result: null };
    const who = sideLabel(S, p.side);
    const pieceName = (side, t) => (side === S.human || S.phase === "end" ? V.types[t].name : "？");
    const entry = { k: mv.kind, f: from, t: mv.to };
    // 只給音效／介面用的事件旗標（不影響規則）
    S._fx = {};
    if (S.cheat.infinite && p.side === S.human) entry.inf = true;
    S.rec.push(entry);
    // 這手開始前就翻倒的己方棋，這手結束時扶正
    const wasStunned = [];
    for (const q of B) if (q && q.side === p.side && q.stunned) wasStunned.push(q);
    const enter = (to) => {
      if (R.forest && V.nodes[to].forest) {
        p.stunned = true;
        S.stats.forest[p.side]++;
        ev.stun = "forest";
      }
      if (R.swamp && V.nodes[to].swamp) {
        p.stunned = true;
        S.stats.swamp[p.side]++;
        ev.stun = "swamp";
      }
      if (R.village && V.nodes[to].village) S.stats.village[p.side]++;
      // 攻進對方大本營，行蹤曝光
      if (R.v3 && R.hqExit && V.nodes[to].hq && V.nodes[to].side !== p.side) {
        if (V.boardMode) reveal(p); else p.cand[opp] = 1 << p.t;
        S.stats.hqEnter[p.side]++;
      }
    };

    if (mv.kind === "scout") {
      const q = B[mv.to];
      if (V.boardMode) { reveal(q); reveal(p); }
      else { q.cand[p.side] = 1 << q.t; p.cand[opp] = 1 << p.t; }
      ev.defender = q.t;
      S.stats.scout[p.side]++;
      if (V.boardMode) {
        // 兩顆都翻成明棋，名字雙方都知道，寫清楚
        const pos = (n) => { const nd = V.nodes[n]; return `${nd.side === S.human ? "我方" : "對方"} ${nd.row + 1}列${nd.col + 1}欄`; };
        S.log.push(`${who}偵察 ${pos(from)} → ${pos(mv.to)} 的${V.types[q.t].name}；兩顆都翻成明棋`);
      } else {
        S.log.push(`${who}偵察 → 揭露${p.side === S.human ? "：" + V.types[q.t].name : "我方一顆棋"}`);
      }
      S.quiet++;
    } else if (mv.kind === "move" || mv.kind === "drop") {
      if (mv.kind === "move") {
        if (V.nodes[from].hq) S.stats.hqExit[p.side]++;
        revealByMovement(S, from, mv.to, p);
        terrainMoveStats(S, from, mv.to, p, ev);
      }
      B[mv.to] = p;
      B[from] = null;
      p.moved = true;
      p.cand[opp] &= V.mobileMask;
      if (mv.kind === "drop") {
        p.dropUsed = true;
        if (V.boardMode) reveal(p);
        else p.cand[opp] = 1 << p.t;
        S.stats.drop[p.side]++;
        // 落點在對方防空炮的視線內：傘兵被擊落，防空炮開火暴露位置（翻成明棋）
        const aaAt = R.aa && R.v3 ? aaCoverCells(S, mv.to).find((m) => B[m] && B[m].side === opp && V.types[B[m].t].kind === "aa") : undefined;
        if (aaAt !== undefined) {
          reveal(B[aaAt]);
          removePiece(S, mv.to, opp);
          S.stats.dropShot[opp]++;
          ev.shotDown = true;
          ev.result = "lose";
          S.log.push(`${who}傘兵空降，被防空炮擊落`);
          S.quiet = 0;
        } else {
          if (R.dropStun) p.stunned = true;
          S.log.push(`${who}傘兵空降`);
        }
      }
      if (!ev.shotDown) {
        enter(mv.to);
        S.quiet++;
      }
    } else if (mv.kind === "snipe") {
      const q = B[mv.to];
      const D = V.types[q.t];
      const hit = snipeHits(V, D, mv.to);
      ev.defender = q.t;
      ev.result = hit ? "win" : "miss";
      reveal(p);
      q.cand[p.side] = filterMask(V, q.cand[p.side], (X) => snipeHits(V, X, mv.to) === hit);
      S.stats.snipe[p.side]++;
      S.log.push(`${who}狙擊手狙擊 ${pieceName(q.side, q.t)}：${hit ? "命中" : "失敗"}`);
      if (hit) {
        S.stats.snipeHit[p.side]++;
        removePiece(S, mv.to, p.side);
        S.quiet = 0;
      } else {
        S.quiet++;
      }
    } else if (mv.kind === "blast") {
      // 工兵爆破防護格：這格失去防護；工兵翻成明棋；裡面的棋不動
      if (!S.ruined) S.ruined = [];
      S.ruined.push(mv.to);
      if (V.boardMode) reveal(p); else p.cand[opp] = 1 << p.t;
      S.stats.blast[p.side]++;
      S._fx.blast = true;
      S.log.push(`${who}工兵爆破${V.nodes[mv.to].bunker ? "碉堡" : "行營"}`);
      S.quiet++;
    } else if (mv.kind === "blow") {
      const col = V.nodes[from].col;
      S.broken.push(col);
      S.stats.blow[p.side]++;
      removePiece(S, from);
      S.log.push(`${who}炸彈炸毀第 ${col + 1} 欄的橋`);
      S.quiet++;
    } else {
      const q = B[mv.to];
      const D = V.types[q.t];
      const r = resolveAt(V, T, D, mv.to);
      ev.defender = q.t;
      ev.result = r;
      if (R.bunker && V.nodes[mv.to].bunker) S.stats.bunkerDef[q.side]++;
      // 統計與音效：衝 3 格撞棋、沿窄軌撞棋也算用到地形（不影響規則）
      terrainMoveStats(S, from, mv.to, p, ev);
      // 雙方各自從結果推理對方的棋
      q.cand[p.side] = filterMask(V, q.cand[p.side], (X) => resolveAt(V, T, X, mv.to) === r);
      p.cand[opp] = filterMask(V, p.cand[opp] & V.mobileMask, (X) => resolveAt(V, X, D, mv.to) === r);
      revealByMovement(S, from, mv.to, p);
      p.moved = true;
      const verb = { flag: "奪下軍旗", win: "勝", lose: "敗", both: "同歸於盡" }[r];
      S.log.push(`${who}${pieceName(p.side, p.t)} 撞 ${pieceName(q.side, q.t)}：${verb}`);
      if (r === "flag") {
        B[mv.to] = null;
        S.lost[q.side].push(q.t);
        B[mv.to] = p;
        B[from] = null;
        S.lastMove = { from, to: mv.to, side: p.side, k: mv.kind };
        S.ply++;
        endGame(S, p.side, `${who}奪下軍旗`);
        entry.n = S.turn;
        return Object.assign(ev, S._fx);
      }
      if (r === "win") { removePiece(S, mv.to, p.side); B[mv.to] = p; B[from] = null; enter(mv.to); }
      else if (r === "lose") { removePiece(S, from, opp); }
      else { removePiece(S, mv.to, p.side); removePiece(S, from, opp); }
      S.quiet = 0;
    }

    for (const q of wasStunned) q.stunned = false;
    updateRadar(S);
    S.lastMove = { from, to: mv.to, side: p.side, k: mv.kind };
    S.ply++;
    if (S.cheat.infinite && p.side === S.human) {
      S.turn = S.human;
    } else {
      S.turn = opp;
    }
    if (drawLimit(S) && S.quiet >= drawLimit(S)) {
      endGame(S, -1, `連續 ${drawLimit(S)} 步沒有對撞，和棋`);
      entry.n = S.turn;
      return Object.assign(ev, S._fx);
    }
    checkStuck(S);
    entry.n = S.turn;
    return Object.assign(ev, S._fx);
  }

  /** 這盤的判和手數（連續幾手沒有對撞判和）；0＝不判和。沒設定時用版本預設 */
  function drawLimit(S) {
    return S.drawQuiet != null ? S.drawQuiet : S.V.drawQuiet;
  }

  /** 作弊：開戰後改和局條件（記進棋譜，複盤時在同一手生效） */
  function cheatSetDraw(S, n) {
    S.drawQuiet = n;
    S.cheat.used = true;
    if (S.phase !== "deploy") S.rec.push({ c: "draw", n });
    S.log.push(`【作弊】和局條件：${n ? `連續 ${n} 手沒有對撞判和` : "不判和"}`);
  }

  /** 輪到的一方無棋可動 → 判負；但只是棋都翻倒的話，跳過這回合（規格 C15） */
  function checkStuck(S, depth = 0) {
    if (S.phase !== "play") return;
    if (hasAnyMove(S, S.turn)) return;
    const side = S.turn;
    const stunned = S.board.filter((p) => p && p.side === side && p.stunned);
    if (stunned.length && depth < 2) {
      for (const p of stunned) p.stunned = false;
      S._fx.passed = true;
      S.log.push(`${sideLabel(S, side)}的棋都翻倒了，跳過這回合`);
      S.rec.push({ k: "pass", n: 1 - side });
      S.ply++;
      S.quiet++;
      S.turn = 1 - side;
      if (drawLimit(S) && S.quiet >= drawLimit(S)) {
        endGame(S, -1, `連續 ${drawLimit(S)} 步沒有對撞，和棋`);
        return;
      }
      checkStuck(S, depth + 1);
      return;
    }
    endGame(S, 1 - side, `${sideLabel(S, side)}無棋可動`);
  }

  function endGame(S, winner, reason) {
    S.phase = "end";
    S.winner = winner;
    S.endReason = reason;
    S.log.push(`── ${reason}。${winner === -1 ? "和棋" : winner === S.human ? "你贏了" : "電腦贏了"} ──`);
  }

  // ---------- 存檔點（悔棋用） ----------

  function snapshot(S) {
    return JSON.stringify({
      board: S.board, turn: S.turn, ply: S.ply, quiet: S.quiet, lastMove: S.lastMove,
      phase: S.phase, winner: S.winner, endReason: S.endReason, nextPid: S.nextPid,
      deadKnown: S.deadKnown, lost: S.lost, logLen: S.log.length,
      broken: S.broken, ruined: S.ruined || [], stats: S.stats, recLen: S.rec.length,
    });
  }

  function restore(S, snap) {
    const o = JSON.parse(snap);
    S.board = o.board; S.turn = o.turn; S.ply = o.ply; S.quiet = o.quiet;
    S.lastMove = o.lastMove; S.phase = o.phase; S.winner = o.winner;
    S.endReason = o.endReason; S.nextPid = o.nextPid; S.deadKnown = o.deadKnown; S.lost = o.lost;
    S.broken = o.broken || []; S.ruined = o.ruined || []; S.stats = o.stats || newStats();
    S.log.length = Math.min(S.log.length, o.logLen);
    S.rec.length = Math.min(S.rec.length, o.recLen || 0);
  }

  // ---------- 作弊（棋譜也記下來，複盤時重現） ----------

  /** 交換兩邊棋盤：每顆棋搬到對面同位置，並換所屬方；你改操控原本對方的部隊 */
  function swapSides(S) {
    const V = S.V;
    const next = new Array(V.nNodes).fill(null);
    for (const nd of V.nodes) {
      const p = S.board[nd.id];
      if (!p) continue;
      p.side = 1 - p.side;
      p.mark = null;
      // 交換後原有推理不再成立：只留明棋，以及「動過的棋不是地雷／軍旗」
      const base = p.faceUp ? 1 << p.t : p.moved ? V.mobileMask : V.fullMask;
      p.cand = [base, base];
      p.cand[p.side] = 1 << p.t;
      next[V.id(1 - nd.side, nd.col, nd.row)] = p;
    }
    S.board = next;
    S.startGrids = [S.startGrids[1], S.startGrids[0]];
    S.lost = [S.lost[1], S.lost[0]];
    S.illegal = [S.illegal[1], S.illegal[0]];
    S.deadKnown = [new Array(V.types.length).fill(0), new Array(V.types.length).fill(0)];
    S.lastMove = null;
    S.cheat.used = true;
    if (S.phase !== "deploy") S.rec.push({ c: "swap" });
    S.log.push("【作弊】交換兩邊棋盤");
  }

  function cheatAdd(S, n, t, side) {
    if (S.board[n]) return "該格已有棋";
    const p = makePiece(S, t, side);
    p.cand[side] = 1 << t;
    if (S.phase !== "deploy") p.moved = true;
    S.board[n] = p;
    S.cheat.used = true;
    if (S.phase !== "deploy") S.rec.push({ c: "add", n, t: S.V.types[t].name, s: side });
    S.log.push(`【作弊】添加${sideLabel(S, side)}${S.V.types[t].name}`);
    return null;
  }

  /** 作弊搬動：a 的棋搬到 b；b 有棋則互換 */
  function cheatMove(S, a, b) {
    if (a === b) return null;
    const pa = S.board[a];
    if (!pa) return "該格沒有棋";
    const pb = S.board[b];
    S.board[a] = pb || null;
    S.board[b] = pa;
    S.cheat.used = true;
    if (S.phase !== "deploy") S.rec.push({ c: "move", a, b });
    const nm = (p) => `${sideLabel(S, p.side)}${S.V.types[p.t].name}`;
    S.log.push(`【作弊】搬動${nm(pa)}${pb ? `，和${nm(pb)}互換` : ""}`);
    return null;
  }

  function cheatDelete(S, n) {
    const p = S.board[n];
    if (!p) return "該格沒有棋";
    S.board[n] = null;
    S.cheat.used = true;
    if (S.phase !== "deploy") S.rec.push({ c: "del", n });
    S.log.push(`【作弊】刪除${sideLabel(S, p.side)}${S.V.types[p.t].name}`);
    return null;
  }

  Object.assign(LZ, {
    resolveRules, buildVariant, placementError, originMask, resolve, resolveAt, defRank, snipeHits,
    rankedKind, newGame, makePiece, setSideGrid, sideGrid, validateSide, startPlay, movesFor, legalMoves,
    hasAnyMove, applyMove, popcount, singleType, snapshot, restore, swapSides, cheatAdd, cheatDelete,
    cheatMove, checkStuck, endGame, updateRadar, roadNbrs, roadDistances, reveal, sightCells, aaCoverCells, blastNbrs, namesGrid, newStats, drawLimit, cheatSetDraw, isProtected,
  });
})(typeof window !== "undefined" ? window : globalThis);
