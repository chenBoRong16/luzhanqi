/* 地圖模型：地圖檔 ↔ 引擎盤面結構；地圖檢查、雜湊、鏡像、區域筆刷、基礎地圖。
 * 地圖＝每格地形＋拆掉的公路＋鐵路（含軌距）＋每欄過河口。
 * 標準地圖轉成盤面結構後，和舊的固定參數建法逐項相同（tests/map-geometry-check.js）。
 * 桌遊條件：地形都是固定的格子屬性；規則只看格子種類和步數，不新增對局狀態。 */
(function (root) {
  "use strict";
  const LZ = root.LZ || (root.LZ = {});

  const MAP_FORMAT = "luzhanqi-map";
  // 地形代碼（檔案裡用一個字，好讀也好手改）
  const TERRAIN = {
    ".": "normal", 營: "camp", 本: "hq", 林: "forest", 沼: "swamp",
    原: "plain", 村: "village", 山: "mountain", 堡: "bunker",
  };
  const CODE = Object.fromEntries(Object.entries(TERRAIN).map(([k, v]) => [v, k]));
  const GAUGES = ["std", "wide", "narrow"]; // 標準軌、寬軌、窄軌
  const GAUGE_NAME = { std: "標準軌", wide: "寬軌", narrow: "窄軌" };
  const SIZE = { minCols: 7, maxCols: 11, minRows: 6, maxRows: 9 };
  const MUSIC_THEMES = ["default", "plain", "swamp", "forest", "mountain"];

  // ---------- 基礎地圖 ----------

  /**
   * 任意大小的「標準樣式」地圖：前線與後方各一條橫向鐵路，左、中、右三條縱向鐵路，
   * 左中右鐵路過河、靠邊兩座公路橋，行營交錯排列，大本營在最後一列中央兩側。
   * 7×7 時和現在的擴充版盤面完全相同。
   */
  function baseMap(cols, rows, opts = {}) {
    const level = opts.level || 0;
    const mid = Math.floor(cols / 2);
    const grid = Array.from({ length: rows }, () => new Array(cols).fill("."));
    for (let r = 1; r <= rows - 3; r++) {
      const inner = r % 2 === 1 ? 1 : 2;
      grid[r][inner] = "營";
      grid[r][cols - 1 - inner] = "營";
    }
    grid[rows - 1][mid - 1] = "本";
    grid[rows - 1][mid + 1] = "本";
    if (rows >= 5) { grid[3][2] = "林"; grid[3][cols - 3] = "林"; }
    if (level >= 1) { grid[0][1] = "堡"; grid[0][cols - 2] = "堡"; }
    const side = grid.map((r) => r.join(""));
    const backRail = rows - 2;
    const rails = [];
    for (let s = 0; s < 2; s++) {
      for (const r of [0, backRail]) {
        const path = [];
        for (let c = 0; c < cols; c++) path.push([s, c, r]);
        rails.push({ gauge: "std", path });
      }
    }
    for (const c of [0, mid, cols - 1]) {
      const path = [];
      for (let r = backRail; r >= 0; r--) path.push([0, c, r]);
      for (let r = 0; r <= backRail; r++) path.push([1, c, r]);
      rails.push({ gauge: "std", path });
    }
    const crossings = [];
    for (let c = 0; c < cols; c++) {
      crossings.push(c === 0 || c === mid || c === cols - 1 ? "rail" : c === 1 || c === cols - 2 ? "bridge" : "mountain");
    }
    return {
      format: MAP_FORMAT, version: 1, name: opts.name || "標準", variant: opts.variant || "",
      cols, rows, mirror: true, music: "default",
      cells: [side, side.slice()], roadsRemoved: [], rails, crossings,
    };
  }

  /** 舊的 config（固定欄列參數）→ 地圖檔 */
  function mapFromConfig(cfg, name) {
    const { cols, rows } = cfg;
    const grid = Array.from({ length: rows }, () => new Array(cols).fill("."));
    const paint = (list, code) => { for (const [c, r] of list || []) grid[r][c] = code; };
    paint(cfg.camps, "營");
    paint(cfg.hqs, "本");
    paint(cfg.forests, "林");
    paint(cfg.bunkers, "堡");
    const side = grid.map((r) => r.join(""));
    const rails = [];
    for (let s = 0; s < 2; s++) {
      for (const r of cfg.railRows) {
        const path = [];
        for (let c = 0; c < cols; c++) path.push([s, c, r]);
        rails.push({ gauge: "std", path });
      }
    }
    const end = cfg.railColEnd;
    for (const c of cfg.railCols) {
      const down = [];
      for (let r = end; r >= 0; r--) down.push([0, c, r]);
      const up = [];
      for (let r = 0; r <= end; r++) up.push([1, c, r]);
      if (cfg.railCross.includes(c)) rails.push({ gauge: "std", path: down.concat(up) });
      else { rails.push({ gauge: "std", path: down }); rails.push({ gauge: "std", path: up }); }
    }
    for (const c of cfg.railCross) {
      if (!cfg.railCols.includes(c)) rails.push({ gauge: "std", path: [[0, c, 0], [1, c, 0]] });
    }
    const crossings = [];
    for (let c = 0; c < cols; c++) {
      crossings.push(cfg.railCross.includes(c) ? "rail" : (cfg.roadCross || []).includes(c) ? "bridge" : "mountain");
    }
    return {
      format: MAP_FORMAT, version: 1, name: name || "標準", variant: cfg.key || "",
      cols, rows, mirror: true, music: "default",
      cells: [side, side.slice()], roadsRemoved: [], rails, crossings,
    };
  }

  // ---------- 地圖 → 盤面結構 ----------

  function edgeKey(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }

  /** 地圖的軌道段（相鄰兩格＋軌距），回傳 Map(edgeKey → gauge) */
  function railEdgesOf(map, id) {
    const out = new Map();
    for (const seg of map.rails || []) {
      for (let i = 1; i < seg.path.length; i++) {
        out.set(edgeKey(id(...seg.path[i - 1]), id(...seg.path[i])), seg.gauge || "std");
      }
    }
    return out;
  }

  /**
   * 地圖 → 盤面結構（節點、公路鄰接、鐵路線）。
   * rule：規則開關；地形效果關掉時，該格的旗標為 false（當一般格子），高山永遠不能通行。
   * 節點編號、鄰接的加入順序都和 engine 舊建法一致。
   */
  function geometryFromMap(map, rule = {}) {
    const { cols, rows } = map;
    const half = cols * rows;
    const id = (side, col, row) => side * half + row * cols + col;
    const terr = (side, col, row) => TERRAIN[map.cells[side][row][col]] || "normal";
    const on = (k) => rule[k] !== false; // 規則表沒有這個開關（例如試作）時視為開

    const nodes = [];
    for (let side = 0; side < 2; side++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const t = terr(side, col, row);
          nodes.push({
            id: id(side, col, row), side, col, row,
            gx: col, gy: side === 0 ? rows + row : rows - 1 - row,
            terrain: t,
            camp: t === "camp", hq: t === "hq",
            forest: t === "forest" && on("forest"),
            bunker: t === "bunker" && on("bunker"),
            swamp: t === "swamp" && on("swamp"),
            plain: t === "plain" && on("plain"),
            village: t === "village" && on("village"),
            mountain: t === "mountain",
            rail: false, gaugeBreak: false,
          });
        }
      }
    }

    const removed = new Set((map.roadsRemoved || []).map(([a, b]) => edgeKey(id(...a), id(...b))));
    const adj = Array.from({ length: 2 * half }, () => new Set());
    const link = (a, b) => {
      if (nodes[a].mountain || nodes[b].mountain || removed.has(edgeKey(a, b))) return;
      adj[a].add(b); adj[b].add(a);
    };
    for (let side = 0; side < 2; side++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const a = id(side, col, row);
          if (col + 1 < cols) link(a, id(side, col + 1, row));
          if (row + 1 < rows) link(a, id(side, col, row + 1));
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (terr(side, col, row) !== "camp") continue;
          for (const dc of [-1, 1]) {
            for (const dr of [-1, 1]) {
              const nc = col + dc, nr = row + dr;
              if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) link(id(side, col, row), id(side, nc, nr));
            }
          }
        }
      }
    }
    // 過河口：先鐵路欄、再公路橋欄（和舊建法順序一致）
    const railCross = [], roadCross = [];
    map.crossings.forEach((k, c) => { if (k === "rail") railCross.push(c); else if (k === "bridge") roadCross.push(c); });
    for (const c of [...railCross, ...roadCross]) link(id(0, c, 0), id(1, c, 0));

    // 鐵路：軌距規則關掉時，全部當成同一種軌距
    const raw = railEdgesOf(map, id);
    const railEdge = new Map();
    for (const [k, g] of raw) {
      const [a, b] = k.split("-").map(Number);
      if (nodes[a].mountain || nodes[b].mountain) continue;
      if (nodes[a].side !== nodes[b].side && !railCross.includes(nodes[a].col)) continue;
      railEdge.set(k, on("gauge") ? g : "std");
    }
    const lines = straightLines(nodes, railEdge);
    const lineIndex = Array.from({ length: 2 * half }, () => []);
    const railAdj = Array.from({ length: 2 * half }, () => new Set());
    lines.forEach((L, li) => {
      L.nodes.forEach((n, pos) => {
        lineIndex[n].push([li, pos]);
        nodes[n].rail = true;
        if (pos > 0) { railAdj[n].add(L.nodes[pos - 1]); railAdj[L.nodes[pos - 1]].add(n); }
      });
    });
    // 換軌站：同一格接了兩種以上軌距
    const gaugesAt = new Map();
    for (const [k, g] of railEdge) {
      for (const n of k.split("-").map(Number)) {
        if (!gaugesAt.has(n)) gaugesAt.set(n, new Set());
        gaugesAt.get(n).add(g);
      }
    }
    for (const [n, gs] of gaugesAt) nodes[n].gaugeBreak = gs.size > 1;
    return {
      nodes, adj: adj.map((s) => [...s]), lines: lines.map((L) => L.nodes), lineGauge: lines.map((L) => L.gauge),
      lineIndex, railAdj: railAdj.map((s) => [...s]), railCross, roadCross, railEdge,
    };
  }

  /** 把軌道切成最長的直線段；遇到軌距改變就切開（換軌站同時是兩段的端點） */
  function straightLines(nodes, railEdge) {
    const at = new Map(nodes.map((n) => [`${n.gx},${n.gy}`, n.id]));
    const lines = [];
    // 方向和舊建法一致：橫線由左往右、直線由下方（我方後排）往上
    for (const [dx, dy] of [[1, 0], [0, -1]]) {
      const used = new Set();
      for (const n of nodes) {
        const start = n.id;
        const next = (u) => at.get(`${nodes[u].gx + dx},${nodes[u].gy + dy}`);
        const prev = (u) => at.get(`${nodes[u].gx - dx},${nodes[u].gy - dy}`);
        const g = (a, b) => (a != null && b != null ? railEdge.get(edgeKey(a, b)) : undefined);
        const fwd = next(start);
        const gauge = g(start, fwd);
        if (!gauge || used.has(edgeKey(start, fwd))) continue;
        if (g(prev(start), start) === gauge) continue; // 只從線頭開始
        const path = [start];
        let u = start;
        while (true) {
          const v = next(u);
          if (g(u, v) !== gauge) break;
          used.add(edgeKey(u, v));
          path.push(v);
          u = v;
        }
        lines.push({ nodes: path, gauge });
      }
    }
    return lines;
  }

  // ---------- 雜湊、複製、鏡像 ----------

  /** 只取決定盤面的內容（名稱、音樂不算），排成固定格式 */
  function canonical(map) {
    const rails = [];
    const id = (s, c, r) => `${s},${c},${r}`;
    for (const seg of map.rails || []) {
      for (let i = 1; i < seg.path.length; i++) {
        const a = id(...seg.path[i - 1]), b = id(...seg.path[i]);
        rails.push(`${a < b ? a + "|" + b : b + "|" + a}|${seg.gauge || "std"}`);
      }
    }
    const roads = (map.roadsRemoved || []).map(([a, b]) => {
      const x = id(...a), y = id(...b);
      return x < y ? x + "|" + y : y + "|" + x;
    });
    return JSON.stringify({
      cols: map.cols, rows: map.rows, cells: map.cells, crossings: map.crossings,
      rails: [...new Set(rails)].sort(), roads: [...new Set(roads)].sort(),
    });
  }

  /** FNV-1a 32 位元 → 8 位十六進位 */
  function mapHash(map) {
    const s = canonical(map);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  function mapId(map) { return { name: map.name, hash: mapHash(map) }; }

  function cloneMap(map) { return JSON.parse(JSON.stringify(map)); }

  /** 以我方（side 0）為準，把對方半場改成鏡像：地形、拆掉的公路、半場內的鐵路都照抄；過河的鐵路保留 */
  function mirrorMap(map) {
    const m = cloneMap(map);
    m.cells[1] = m.cells[0].slice();
    const flip = ([s, c, r]) => [1 - s, c, r];
    m.roadsRemoved = (m.roadsRemoved || []).filter(([a, b]) => a[0] === 0 || b[0] === 0);
    for (const [a, b] of m.roadsRemoved.slice()) {
      if (a[0] === 0 && b[0] === 0) m.roadsRemoved.push([flip(a), flip(b)]);
    }
    const edges = [];
    for (const seg of m.rails || []) {
      for (let i = 1; i < seg.path.length; i++) edges.push({ a: seg.path[i - 1], b: seg.path[i], gauge: seg.gauge });
    }
    const keep = edges.filter((e) => e.a[0] === 0 && e.b[0] === 0);
    const cross = edges.filter((e) => e.a[0] !== e.b[0]);
    m.rails = [
      ...keep.map((e) => ({ gauge: e.gauge, path: [e.a, e.b] })),
      ...keep.map((e) => ({ gauge: e.gauge, path: [flip(e.a), flip(e.b)] })),
      ...cross.map((e) => ({ gauge: e.gauge, path: [e.a, e.b] })),
    ];
    m.mirror = true;
    return m;
  }

  /** 地圖是否左右兩國完全對稱（含軌距） */
  function isSymmetric(map) {
    return mapHash(map) === mapHash(mirrorMap(map));
  }

  // ---------- 檢查 ----------

  /**
   * 地圖能不能玩。回傳 [{msg, cells:[[side,col,row],...]}]，空陣列＝通過。
   * cfg：該版的 config（用來算兵力能不能放得下）；level：0 或 1。
   */
  function validateMap(map, cfg, level) {
    const errs = [];
    const err = (msg, cells = []) => errs.push({ msg, cells });
    const { cols, rows } = map;
    if (!(cols >= SIZE.minCols && cols <= SIZE.maxCols && rows >= SIZE.minRows && rows <= SIZE.maxRows)) {
      err(`大小要在 ${SIZE.minCols}～${SIZE.maxCols} 欄、${SIZE.minRows}～${SIZE.maxRows} 列之間`);
      return errs;
    }
    for (let s = 0; s < 2; s++) {
      if (!Array.isArray(map.cells[s]) || map.cells[s].length !== rows) { err(`第 ${s + 1} 方的列數不對`); return errs; }
      for (let r = 0; r < rows; r++) {
        const line = map.cells[s][r];
        if ([...line].length !== cols) { err(`第 ${s + 1} 方第 ${r + 1} 列格數不對`); return errs; }
        [...line].forEach((ch, c) => {
          if (!(ch in TERRAIN)) err(`不認得的地形「${ch}」`, [[s, c, r]]);
        });
      }
    }
    if (!Array.isArray(map.crossings) || map.crossings.length !== cols) { err("過河口數量要等於欄數"); return errs; }
    if (errs.length) return errs;

    const hq = [0, 1].map((s) => {
      const out = [];
      map.cells[s].forEach((line, r) => [...line].forEach((ch, c) => { if (ch === "本") out.push([s, c, r]); }));
      return out;
    });
    for (const s of [0, 1]) if (!hq[s].length) err(`${s === 0 ? "我方" : "對方"}沒有大本營`);
    if (!map.crossings.some((k) => k !== "mountain")) err("至少要有一個過河口");
    // 公路橋可能全被炸斷，雙方會完全隔開（只能拖成和局），所以至少要有一條鐵路過河
    else if (!(map.rails || []).some((r) => r.path.some((p, i) => i > 0 && p[0] !== r.path[i - 1][0]))) {
      err("至少要有一條鐵路過河（公路橋可能全被炸斷，雙方會完全隔開）");
    }

    // 鐵路：兩端要相鄰；不能經過沼澤、高山；過河只能走「鐵路」過河口
    const half = cols * rows;
    const id = (s, c, r) => s * half + r * cols + c;
    for (const seg of map.rails || []) {
      if (!GAUGES.includes(seg.gauge || "std")) err(`不認得的軌距「${seg.gauge}」`);
      for (let i = 0; i < seg.path.length; i++) {
        const [s, c, r] = seg.path[i];
        const ch = map.cells[s] && map.cells[s][r] ? [...map.cells[s][r]][c] : undefined;
        if (ch === "沼" || ch === "山") err(`鐵路不能經過${ch === "沼" ? "沼澤" : "高山"}`, [[s, c, r]]);
        if (i === 0) continue;
        const [s0, c0, r0] = seg.path[i - 1];
        const crossing = s0 !== s;
        const ok = crossing
          ? c0 === c && r0 === 0 && r === 0 && map.crossings[c] === "rail"
          : Math.abs(c0 - c) + Math.abs(r0 - r) === 1;
        if (!ok) err(crossing ? "鐵路過河只能走「鐵路」過河口" : "鐵路的兩格要相鄰", [[s0, c0, r0], [s, c, r]]);
      }
    }
    if (errs.length) return errs;

    // 連通：所有可以進入的格子要連成一片
    const G = geometryFromMap(map);
    const start = G.nodes.find((n) => !n.mountain);
    const seen = new Set([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const u = queue.shift();
      for (const v of G.adj[u]) if (!seen.has(v)) { seen.add(v); queue.push(v); }
    }
    const lonely = G.nodes.filter((n) => !n.mountain && !seen.has(n.id)).map((n) => [n.side, n.col, n.row]);
    if (lonely.length) err("有格子走不到（被高山、拆掉的公路圍住）", lonely);

    // 兵力放得下：用該版規則全開時的兵力，試排一次合法佈局
    if (cfg && !errs.length && LZ.buildVariant && LZ.randomGrid) {
      const V = LZ.buildVariant(cfg, undefined, map);
      for (const s of [0, 1]) {
        const g = tryLayout(V, s);
        if (!g) err(`${s === 0 ? "我方" : "對方"}的格子放不下整支兵力（${V.armySize} 顆；注意高山、沼澤、行營不能放的棋）`);
      }
    }
    return errs;
  }

  function tryLayout(V, side) {
    let seed = 12345;
    const rng = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    for (let k = 0; k < 5; k++) {
      try {
        const g = LZ.randomGrid(V, rng, side);
        if (g && !LZ.validateGrid(V, g, true, false, side)) return g;
      } catch (e) { /* 放不下 */ }
    }
    return null;
  }

  // ---------- 區域筆刷 ----------

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  function setCell(map, s, c, r, ch) {
    const line = [...map.cells[s][r]];
    line[c] = ch;
    map.cells[s][r] = line.join("");
  }
  function getCell(map, s, c, r) { return [...map.cells[s][r]][c]; }

  function connected(map) {
    const G = geometryFromMap(map);
    const start = G.nodes.find((n) => !n.mountain);
    if (!start) return false;
    const seen = new Set([start.id]);
    const q = [start.id];
    while (q.length) { const u = q.shift(); for (const v of G.adj[u]) if (!seen.has(v)) { seen.add(v); q.push(v); } }
    return G.nodes.every((n) => n.mountain || seen.has(n.id));
  }

  /** 把經過某格的鐵路拿掉（鋪了沼澤、高山時用） */
  function dropRailsAt(map, s, c, r) {
    const out = [];
    for (const seg of map.rails) {
      let cur = [];
      for (const p of seg.path) {
        if (p[0] === s && p[1] === c && p[2] === r) { if (cur.length > 1) out.push({ gauge: seg.gauge, path: cur }); cur = []; }
        else cur.push(p);
      }
      if (cur.length > 1) out.push({ gauge: seg.gauge, path: cur });
    }
    map.rails = out;
  }

  /** 範圍內的鐵路改成某種軌距（含跨範圍的那一段） */
  function regaugeIn(map, s, rect, gauge) {
    const inside = (p) => p[0] === s && p[1] >= rect.c0 && p[1] <= rect.c1 && p[2] >= rect.r0 && p[2] <= rect.r1;
    const out = [];
    for (const seg of map.rails) {
      for (let i = 1; i < seg.path.length; i++) {
        const a = seg.path[i - 1], b = seg.path[i];
        out.push({ gauge: inside(a) && inside(b) ? gauge : seg.gauge, path: [a, b] });
      }
    }
    map.rails = out;
  }

  /**
   * 區域筆刷：在第 s 方的矩形範圍（欄 c0～c1、列 r0～r1）套用。
   * kind：plain 偏遠平原、village 鄉村、swamp 沼澤地帶、forest 森林地帶、mountain 山地。
   * 大本營、行營（鄉村筆刷除外）不動；保證所有格子仍然連通。
   */
  function applyBrush(map0, s, rect, kind, seed = 1) {
    const map = cloneMap(map0);
    const rng = makeRng(seed);
    const cells = [];
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) cells.push([c, r]);
    const plainCell = (c, r) => [".", "原"].includes(getCell(map, s, c, r));
    if (kind === "plain") {
      for (const [c, r] of cells) if (plainCell(c, r) && rng() < 0.85) setCell(map, s, c, r, "原");
      // 偏遠：拆掉一半「連到非平原格」的公路（平原之間的路保留，坦克才跑得起來；拆了會斷開就不拆）
      for (const [c, r] of cells) {
        for (const [dc, dr] of [[1, 0], [0, 1]]) {
          const c2 = c + dc, r2 = r + dr;
          if (c2 > rect.c1 || r2 > rect.r1) continue;
          if (getCell(map, s, c, r) === "原" && getCell(map, s, c2, r2) === "原") continue;
          if (rng() > 0.5) continue;
          const e = [[s, c, r], [s, c2, r2]];
          map.roadsRemoved.push(e);
          if (!connected(map)) map.roadsRemoved.pop();
        }
      }
      // 遊戲性優先：偏遠平原不再改窄軌（模擬顯示換軌站太多會讓進攻停擺）
    } else if (kind === "village") {
      for (const [c, r] of cells) {
        const ch = getCell(map, s, c, r);
        if (ch === "營" && rng() < 0.5) setCell(map, s, c, r, ".");
        else if (plainCell(c, r) && rng() < 0.35) setCell(map, s, c, r, "村");
      }
    } else if (kind === "swamp" || kind === "forest") {
      const ch = kind === "swamp" ? "沼" : "林";
      for (const [c, r] of cells) {
        if (!plainCell(c, r) || rng() > 0.5) continue;
        setCell(map, s, c, r, ch);
        if (kind === "swamp") dropRailsAt(map, s, c, r);
      }
    } else if (kind === "mountain") {
      for (const [c, r] of cells) {
        if (!plainCell(c, r) || rng() > 0.3) continue;
        const before = cloneMap(map);
        setCell(map, s, c, r, "山");
        dropRailsAt(map, s, c, r);
        if (!connected(map)) { map.cells = before.cells; map.rails = before.rails; }
      }
      regaugeIn(map, s, rect, "narrow");
    }
    return map;
  }

  // ---------- 檔案 ----------

  function mapToJson(map) {
    const lines = ["{"];
    const keys = ["format", "version", "name", "variant", "cols", "rows", "mirror", "music"];
    for (const k of keys) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`);
    lines.push(`  "cells": [\n${map.cells.map((side) => "    [\n" + side.map((r) => "      " + JSON.stringify(r)).join(",\n") + "\n    ]").join(",\n")}\n  ],`);
    lines.push(`  "roadsRemoved": ${JSON.stringify(map.roadsRemoved || [])},`);
    lines.push(`  "rails": [\n${(map.rails || []).map((r) => "    " + JSON.stringify(r)).join(",\n")}\n  ],`);
    lines.push(`  "crossings": ${JSON.stringify(map.crossings)}`);
    lines.push("}");
    return lines.join("\n") + "\n";
  }

  function parseMap(text) {
    let d;
    try { d = typeof text === "string" ? JSON.parse(text) : text; } catch { return { error: "不是有效的 JSON" }; }
    if (!d || d.format !== MAP_FORMAT) return { error: "不是地圖檔" };
    if (!Array.isArray(d.cells) || d.cells.length !== 2) return { error: "地圖內容不完整" };
    const map = Object.assign({ roadsRemoved: [], rails: [], music: "default", mirror: false }, d);
    return { map };
  }

  Object.assign(LZ, {
    MAP_FORMAT, MAP_TERRAIN: TERRAIN, MAP_CODE: CODE, GAUGES, GAUGE_NAME, MAP_SIZE: SIZE, MUSIC_THEMES,
    baseMap, mapFromConfig, geometryFromMap, mapHash, mapId, cloneMap, mirrorMap, isSymmetric,
    validateMap, applyBrush, mapToJson, parseMap, mapEdgeKey: edgeKey,
  });
})(typeof window !== "undefined" ? window : globalThis);
