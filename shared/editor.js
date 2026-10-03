/* 地圖編輯器：格子筆刷、公路剪刀、鐵路筆（含軌距）、過河口、區域筆刷、鏡像、復原重做、即時檢查、匯入匯出、試玩。
 * 盤面用 board-draw.js 畫，和對局時看到的完全一樣。 */
(function (root) {
  "use strict";
  const LZ = root.LZ;

  const TERRAIN_TOOLS = [
    { ch: ".", name: "一般" }, { ch: "營", name: "行營" }, { ch: "本", name: "大本營" },
    { ch: "原", name: "平原" }, { ch: "村", name: "村莊" }, { ch: "林", name: "森林" },
    { ch: "沼", name: "沼澤" }, { ch: "山", name: "高山" }, { ch: "堡", name: "碉堡" },
  ];
  const BRUSHES = [
    { kind: "plain", name: "偏遠平原" }, { kind: "village", name: "鄉村" }, { kind: "swamp", name: "沼澤地帶" },
    { kind: "forest", name: "森林地帶" }, { kind: "mountain", name: "山地" },
  ];
  const MUSIC_NAME = { default: "預設", plain: "平原", swamp: "沼澤", forest: "森林", mountain: "山地" };

  function storage(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* 沒有 localStorage 也能用，只是不能存 */ }
    return null;
  }

  function mountEditor(app) {
    const params = new URLSearchParams(location.search);
    const key = params.get("v") === "expanded1" ? "expanded1" : "expanded0";
    const level = key === "expanded1" ? 1 : 0;
    const CFG = LZ.expandedConfig({ level });
    CFG.key = key;
    CFG.title = `陸軍棋 · ${level ? "擴充版-1" : "擴充版-0"}`;
    const MAPS_KEY = `lzq-${key}-maps`;
    const MAP_KEY = `lzq-${key}-map`;
    const DRAFT_KEY = `lzq-${key}-editor-draft`;
    const playUrl = `../${level ? "擴充版-1" : "擴充版-0"}/index.html`;

    const builtins = () => LZ.builtinMaps(level, key);
    const savedMaps = () => (storage(MAPS_KEY) || []).filter((m) => m && m.format === LZ.MAP_FORMAT);

    const st = {
      map: null, undo: [], redo: [],
      tool: "paint", terrain: "原", gauge: "std", brush: "plain", railErase: false, mirror: true,
      drag: null, errors: [], seed: 1,
    };
    const draft = storage(DRAFT_KEY);
    st.map = draft && draft.format === LZ.MAP_FORMAT ? draft : LZ.cloneMap(builtins()[0]);
    st.mirror = st.map.mirror !== false;

    app.innerHTML = `
      <header class="topbar">
        <a class="back" href="../index.html">← 選版本</a>
        <h1>地圖編輯器</h1>
        <div class="seg small" data-group="variant">
          <button type="button" data-variant="expanded0">擴充版-0</button>
          <button type="button" data-variant="expanded1">擴充版-1</button>
        </div>
        <button type="button" class="ghost" data-act="help">說明</button>
      </header>
      <main class="layout editor">
        <section class="board-area">
          <div class="board"><svg class="lines" aria-hidden="true"></svg><svg class="edit-layer"></svg></div>
        </section>
        <aside class="panel">
          <div class="card">
            <div class="card-title">地圖</div>
            <label class="field">名稱 <input type="text" data-f="name" maxlength="30"></label>
            <div class="row wrap">
              <label class="field small">欄 <input type="number" data-f="cols" min="${LZ.MAP_SIZE.minCols}" max="${LZ.MAP_SIZE.maxCols}"></label>
              <label class="field small">列 <input type="number" data-f="rows" min="${LZ.MAP_SIZE.minRows}" max="${LZ.MAP_SIZE.maxRows}"></label>
              <button type="button" class="small" data-act="resize">套用大小（重設地圖）</button>
            </div>
            <label class="check"><input type="checkbox" data-f="mirror"> 鏡像：改一邊，另一邊自動跟著（兩國對稱）</label>
            <label class="field">音樂主題 <select data-f="music">${LZ.MUSIC_THEMES.map((m) => `<option value="${m}">${MUSIC_NAME[m]}</option>`).join("")}</select></label>
            <div class="row wrap">
              <select data-f="open"></select>
              <button type="button" class="small" data-act="open">打開</button>
            </div>
          </div>
          <div class="card">
            <div class="card-title">工具</div>
            <div class="seg wrap" data-group="tool">
              <button type="button" data-tool="paint">格子筆刷</button>
              <button type="button" data-tool="road">公路剪刀</button>
              <button type="button" data-tool="rail">鐵路筆</button>
              <button type="button" data-tool="cross">過河口</button>
              <button type="button" data-tool="region">區域筆刷</button>
            </div>
            <div class="tool-opts" data-opts="paint">
              <div class="seg wrap">${TERRAIN_TOOLS.filter((t) => !t.level || t.level <= level).map((t) => `<button type="button" data-terrain="${t.ch}">${t.name}</button>`).join("")}</div>
              <p class="muted">點或拖曳塗格子。</p>
            </div>
            <div class="tool-opts" data-opts="road"><p class="muted">點兩格之間的公路：拆掉或接回。拆掉的公路以紅色虛線顯示。</p></div>
            <div class="tool-opts" data-opts="rail">
              <div class="seg wrap">${LZ.GAUGES.map((g) => `<button type="button" data-gauge="${g}">${LZ.GAUGE_NAME[g]}</button>`).join("")}</div>
              <label class="check"><input type="checkbox" data-f="railErase"> 橡皮擦（拖過的鐵路刪掉）</label>
              <p class="muted">從一格拖到相鄰格就鋪一段鐵路。不能鋪進沼澤、高山。</p>
            </div>
            <div class="tool-opts" data-opts="cross"><p class="muted">點河界上的欄位，依序切換：鐵路 → 公路橋 → 山（不通）。</p></div>
            <div class="tool-opts" data-opts="region">
              <div class="seg wrap">${BRUSHES.map((b) => `<button type="button" data-brush="${b.kind}">${b.name}</button>`).join("")}</div>
              <p class="muted">在同一方框選一塊範圍後套用；大本營、行營不會被覆蓋，也保證不會出現走不到的格子。之後可以逐格再改。</p>
            </div>
            <div class="row wrap">
              <button type="button" class="small" data-act="undo">復原</button>
              <button type="button" class="small" data-act="redo">重做</button>
              <button type="button" class="small" data-act="reset">清回標準樣式</button>
            </div>
          </div>
          <div class="card check-card"></div>
          <div class="card">
            <div class="card-title">存檔與試玩</div>
            <div class="row wrap">
              <button type="button" class="primary" data-act="play">試玩這張地圖</button>
              <button type="button" data-act="save">存到瀏覽器</button>
            </div>
            <div class="row wrap">
              <button type="button" data-act="export">匯出地圖</button>
              <button type="button" data-act="import">匯入地圖</button>
            </div>
            <p class="muted" data-f="msg"></p>
          </div>
          <div class="card legend-card"></div>
        </aside>
      </main>
      <div class="modal-back" hidden><div class="modal" role="dialog" aria-modal="true"></div></div>`;

    const $ = (sel) => app.querySelector(sel);
    const elBoard = $(".board");
    const elSvg = $(".lines");
    const elEdit = $(".edit-layer");
    const elCheck = $(".check-card");
    const elLegend = $(".legend-card");
    const elMsg = $('[data-f="msg"]');
    const elModalBack = $(".modal-back");
    const elModal = $(".modal");
    let V = null, G = null;

    const sfx = (k) => { if (LZ.audio && LZ.audio.playEditor) LZ.audio.playEditor(k); };

    // ---------- 地圖操作 ----------
    function commit(next, sound) {
      st.undo.push(JSON.stringify(st.map));
      if (st.undo.length > 200) st.undo.shift();
      st.redo = [];
      st.map = next;
      if (sound) sfx(sound);
      render();
    }
    function edit(fn, sound) {
      const m = LZ.cloneMap(st.map);
      fn(m);
      m.mirror = st.mirror;
      commit(m, sound);
    }
    const setCell = (m, s, c, r, ch) => { const a = [...m.cells[s][r]]; a[c] = ch; m.cells[s][r] = a.join(""); };
    const getCell = (m, s, c, r) => [...m.cells[s][r]][c];
    const sides = (s) => (st.mirror ? [s, 1 - s] : [s]);

    function railEdges(m) {
      const E = new Map();
      for (const seg of m.rails) {
        for (let i = 1; i < seg.path.length; i++) {
          const a = seg.path[i - 1], b = seg.path[i];
          E.set(ekey(a, b), { a, b, gauge: seg.gauge || "std" });
        }
      }
      return E;
    }
    function ekey(a, b) {
      const x = a.join(","), y = b.join(",");
      return x < y ? `${x}|${y}` : `${y}|${x}`;
    }
    function setRails(m, E) { m.rails = [...E.values()].map((e) => ({ gauge: e.gauge, path: [e.a, e.b] })); }
    const flip = (p) => [1 - p[0], p[1], p[2]];

    function paintCell(s, c, r) {
      const ch = st.terrain;
      if (getCell(st.map, s, c, r) === ch && (!st.mirror || getCell(st.map, 1 - s, c, r) === ch)) return;
      edit((m) => {
        for (const sd of sides(s)) {
          setCell(m, sd, c, r, ch);
          if (ch === "沼" || ch === "山") {
            const E = railEdges(m);
            for (const [k, e] of E) if ((e.a[0] === sd && e.a[1] === c && e.a[2] === r) || (e.b[0] === sd && e.b[1] === c && e.b[2] === r)) E.delete(k);
            setRails(m, E);
          }
        }
      }, "paint");
    }

    function toggleRoad(a, b) {
      edit((m) => {
        const pairs = [[a, b]];
        if (st.mirror && a[0] === b[0]) pairs.push([flip(a), flip(b)]);
        for (const [x, y] of pairs) {
          const k = ekey(x, y);
          const i = m.roadsRemoved.findIndex(([p, q]) => ekey(p, q) === k);
          if (i >= 0) m.roadsRemoved.splice(i, 1);
          else m.roadsRemoved.push([x, y]);
        }
      }, "road");
    }

    function railStep(a, b) {
      const E = railEdges(st.map);
      const k = ekey(a, b);
      if (st.railErase ? !E.has(k) : E.get(k) && E.get(k).gauge === st.gauge) return;
      edit((m) => {
        const F = railEdges(m);
        const pairs = [[a, b]];
        if (st.mirror && a[0] === b[0]) pairs.push([flip(a), flip(b)]);
        for (const [x, y] of pairs) {
          if (st.railErase) F.delete(ekey(x, y));
          else F.set(ekey(x, y), { a: x, b: y, gauge: st.gauge });
        }
        setRails(m, F);
      }, st.railErase ? "erase" : "rail");
    }

    function cycleCross(c) {
      const order = ["rail", "bridge", "mountain"];
      edit((m) => {
        m.crossings[c] = order[(order.indexOf(m.crossings[c]) + 1) % order.length];
      }, "road");
    }

    function applyRegion(s, rect) {
      st.seed = (st.seed * 7 + 3) % 9973;
      let m = LZ.applyBrush(st.map, s, rect, st.brush, st.seed);
      if (st.mirror) m = s === 0 ? LZ.mirrorMap(m) : swapSides(LZ.mirrorMap(swapSides(m)));
      m.mirror = st.mirror;
      commit(m, "brush");
    }
    /** 交換兩方（用來以對方為準做鏡像） */
    function swapSides(m) {
      const x = LZ.cloneMap(m);
      x.cells = [x.cells[1], x.cells[0]];
      const fl = (p) => [1 - p[0], p[1], p[2]];
      x.roadsRemoved = x.roadsRemoved.map(([a, b]) => [fl(a), fl(b)]);
      x.rails = x.rails.map((r) => ({ gauge: r.gauge, path: r.path.map(fl) }));
      return x;
    }

    // ---------- 畫面 ----------
    function render() {
      storage(DRAFT_KEY, st.map);
      V = LZ.buildVariant(CFG, undefined, st.map);
      G = LZ.boardGeom(V);
      elBoard.style.aspectRatio = `${G.W}/${G.H}`;
      elBoard.style.setProperty("--ar", G.W / G.H);
      elBoard.style.setProperty("--u", `calc(100cqw / ${G.W})`);
      elSvg.setAttribute("viewBox", `0 0 ${G.W} ${G.H}`);
      elEdit.setAttribute("viewBox", `0 0 ${G.W} ${G.H}`);
      elSvg.innerHTML = LZ.drawBoard(V);
      st.errors = LZ.validateMap(st.map, CFG, level);
      drawEditLayer();
      renderPanel();
    }

    function drawEditLayer() {
      const { px, py, RIVER, RH } = G;
      const parts = [];
      const id = (s, c, r) => V.id(s, c, r);
      // 拆掉的公路：紅色虛線
      for (const [a, b] of st.map.roadsRemoved) {
        const x = id(...a), y = id(...b);
        parts.push(`<line class="ed-removed" x1="${px(x)}" y1="${py(x)}" x2="${px(y)}" y2="${py(y)}"/>`);
      }
      // 錯誤格子
      const bad = new Set();
      for (const e of st.errors) for (const p of e.cells || []) bad.add(id(...p));
      for (const n of bad) parts.push(`<rect class="ed-bad" x="${px(n) - 48}" y="${py(n) - 28}" width="96" height="56" rx="8"/>`);
      // 公路剪刀的點擊區：半場內每對正交相鄰格
      if (st.tool === "road") {
        for (let s = 0; s < 2; s++) {
          for (let r = 0; r < V.rows; r++) {
            for (let c = 0; c < V.cols; c++) {
              for (const [dc, dr] of [[1, 0], [0, 1]]) {
                const c2 = c + dc, r2 = r + dr;
                if (c2 >= V.cols || r2 >= V.rows) continue;
                const a = id(s, c, r), b = id(s, c2, r2);
                parts.push(`<line class="ed-hit-road" data-a="${s},${c},${r}" data-b="${s},${c2},${r2}" x1="${px(a)}" y1="${py(a)}" x2="${px(b)}" y2="${py(b)}"/>`);
              }
            }
          }
        }
      }
      // 過河口的點擊區
      if (st.tool === "cross") {
        const ry = V.rows * RH;
        for (let c = 0; c < V.cols; c++) {
          const x = px(id(0, c, 0));
          parts.push(`<rect class="ed-hit-cross" data-col="${c}" x="${x - 46}" y="${ry + 4}" width="92" height="${RIVER - 8}" rx="8"/>`);
          parts.push(`<text class="ed-cross-label" x="${x}" y="${ry + RIVER - 10}">${{ rail: "鐵路", bridge: "橋", mountain: "山" }[st.map.crossings[c]]}</text>`);
        }
      }
      // 格子點擊區（筆刷、鐵路、區域）
      if (st.tool === "paint" || st.tool === "rail" || st.tool === "region") {
        for (const nd of V.nodes) {
          parts.push(`<rect class="ed-hit-cell" data-cell="${nd.side},${nd.col},${nd.row}" x="${px(nd.id) - 50}" y="${py(nd.id) - 30}" width="100" height="60"/>`);
        }
      }
      // 區域框選
      if (st.drag && st.drag.rect) {
        const { s, c0, r0, c1, r1 } = st.drag.rect;
        const xs = [px(id(s, c0, r0)), px(id(s, c1, r1))], ys = [py(id(s, c0, r0)), py(id(s, c1, r1))];
        parts.push(`<rect class="ed-region" x="${Math.min(...xs) - 48}" y="${Math.min(...ys) - 28}" width="${Math.abs(xs[1] - xs[0]) + 96}" height="${Math.abs(ys[1] - ys[0]) + 56}" rx="8"/>`);
      }
      elEdit.innerHTML = parts.join("");
    }

    function renderPanel() {
      $('[data-f="name"]').value = st.map.name || "";
      $('[data-f="cols"]').value = st.map.cols;
      $('[data-f="rows"]').value = st.map.rows;
      $('[data-f="mirror"]').checked = st.mirror;
      $('[data-f="music"]').value = st.map.music || "default";
      $('[data-f="railErase"]').checked = st.railErase;
      for (const b of app.querySelectorAll("[data-variant]")) b.classList.toggle("on", b.dataset.variant === key);
      for (const b of app.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === st.tool);
      for (const b of app.querySelectorAll("[data-terrain]")) b.classList.toggle("on", b.dataset.terrain === st.terrain);
      for (const b of app.querySelectorAll("[data-gauge]")) b.classList.toggle("on", b.dataset.gauge === st.gauge);
      for (const b of app.querySelectorAll("[data-brush]")) b.classList.toggle("on", b.dataset.brush === st.brush);
      for (const el of app.querySelectorAll("[data-opts]")) el.hidden = el.dataset.opts !== st.tool;
      $('[data-act="undo"]').disabled = !st.undo.length;
      $('[data-act="redo"]').disabled = !st.redo.length;
      const sel = $('[data-f="open"]');
      const list = builtins().map((m) => ({ m, label: m.name })).concat(savedMaps().map((m) => ({ m, label: "★ " + m.name })));
      sel.innerHTML = list.map((x, i) => `<option value="${i}">${x.label}（${x.m.cols}×${x.m.rows}）</option>`).join("");
      sel._list = list;
      const sym = LZ.isSymmetric(st.map);
      elCheck.innerHTML = st.errors.length
        ? `<div class="card-title">檢查：<span class="bad-c">不能玩</span></div><ul class="legend">${st.errors.map((e) => `<li>${e.msg}</li>`).join("")}</ul><p class="muted">紅框是出問題的格子。</p>`
        : `<div class="card-title">檢查：<span class="ok-c">可以玩</span></div><p class="muted">${st.map.cols}×${st.map.rows}，${sym ? "兩國對稱" : "不對稱（會在對局中標示）"}。</p>`;
      elLegend.innerHTML = `<div class="card-title">圖例</div>${LZ.terrainLegendHtml(V) || '<p class="muted">這張地圖只有基本地形。</p>'}`;
    }

    // ---------- 指標操作 ----------
    const parseP = (s) => s.split(",").map(Number);
    function hitAt(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return el && elEdit.contains(el) ? el : null;
    }
    elEdit.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (LZ.audio) LZ.audio.unlock();
      const el = hitAt(e);
      if (!el) return;
      e.preventDefault();
      if (st.tool === "road" && el.dataset.a) return toggleRoad(parseP(el.dataset.a), parseP(el.dataset.b));
      if (st.tool === "cross" && el.dataset.col != null) return cycleCross(Number(el.dataset.col));
      if (!el.dataset.cell) return;
      const p = parseP(el.dataset.cell);
      try { elEdit.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件沒有真正的指標，略過 */ }
      if (st.tool === "paint") { st.drag = { last: p }; paintCell(...p); }
      else if (st.tool === "rail") st.drag = { last: p };
      else if (st.tool === "region") { st.drag = { start: p, rect: { s: p[0], c0: p[1], r0: p[2], c1: p[1], r1: p[2] } }; drawEditLayer(); }
    });
    elEdit.addEventListener("pointermove", (e) => {
      if (!st.drag) return;
      // 指標被捕捉時 elementFromPoint 仍可用；暫時讓點擊區接收
      const el = hitAt(e);
      if (!el || !el.dataset.cell) return;
      const p = parseP(el.dataset.cell);
      const last = st.drag.last;
      if (st.tool === "paint") {
        if (last && p.join() === last.join()) return;
        st.drag.last = p;
        paintCell(...p);
      } else if (st.tool === "rail") {
        if (!last || p.join() === last.join()) return;
        const adjacent = (last[0] === p[0] && Math.abs(last[1] - p[1]) + Math.abs(last[2] - p[2]) === 1)
          || (last[0] !== p[0] && last[1] === p[1] && last[2] === 0 && p[2] === 0);
        if (adjacent) railStep(last, p);
        st.drag.last = p;
      } else if (st.tool === "region") {
        const s = st.drag.start;
        if (p[0] !== s[0]) return;
        st.drag.rect = { s: s[0], c0: Math.min(s[1], p[1]), r0: Math.min(s[2], p[2]), c1: Math.max(s[1], p[1]), r1: Math.max(s[2], p[2]) };
        drawEditLayer();
      }
    });
    const endDrag = () => {
      if (!st.drag) return;
      const d = st.drag;
      st.drag = null;
      if (st.tool === "region" && d.rect) applyRegion(d.rect.s, d.rect);
      else drawEditLayer();
    };
    // 放開滑鼠時不一定在編輯層上（或指標捕捉被釋放），整個視窗都要收
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    elEdit.addEventListener("lostpointercapture", endDrag);

    // ---------- 按鈕 ----------
    app.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || elModal.contains(b)) return;
      if (LZ.audio) LZ.audio.unlock();
      if (b.dataset.variant && b.dataset.variant !== key) { location.search = `?v=${b.dataset.variant}`; return; }
      if (b.dataset.tool) { st.tool = b.dataset.tool; return render(); }
      if (b.dataset.terrain) { st.terrain = b.dataset.terrain; return renderPanel(); }
      if (b.dataset.gauge) { st.gauge = b.dataset.gauge; st.railErase = false; return renderPanel(); }
      if (b.dataset.brush) { st.brush = b.dataset.brush; return renderPanel(); }
      elMsg.textContent = "";
      switch (b.dataset.act) {
        case "undo":
          if (!st.undo.length) return;
          st.redo.push(JSON.stringify(st.map));
          st.map = JSON.parse(st.undo.pop());
          sfx("undo");
          return render();
        case "redo":
          if (!st.redo.length) return;
          st.undo.push(JSON.stringify(st.map));
          st.map = JSON.parse(st.redo.pop());
          sfx("undo");
          return render();
        case "reset":
          return commit(Object.assign(LZ.baseMap(st.map.cols, st.map.rows, { level, variant: key, name: st.map.name }), { mirror: st.mirror }), "paint");
        case "resize": {
          const cols = clamp(Number($('[data-f="cols"]').value), LZ.MAP_SIZE.minCols, LZ.MAP_SIZE.maxCols);
          const rows = clamp(Number($('[data-f="rows"]').value), LZ.MAP_SIZE.minRows, LZ.MAP_SIZE.maxRows);
          return commit(LZ.baseMap(cols, rows, { level, variant: key, name: st.map.name }), "paint");
        }
        case "open": {
          const sel = $('[data-f="open"]');
          const x = sel._list[Number(sel.value)];
          if (!x) return;
          const m = LZ.cloneMap(x.m);
          delete m.builtin; delete m.desc;
          st.mirror = LZ.isSymmetric(m);
          return commit(m, "paint");
        }
        case "save": return saveMap();
        case "play": {
          if (st.errors.length) { elMsg.textContent = "這張地圖還不能玩，先修好檢查列出的問題。"; sfx("error"); return; }
          const m = saveMap();
          storage(MAP_KEY, { name: m.name, hash: LZ.mapHash(m) });
          location.href = playUrl;
          return;
        }
        case "export":
          return openText("匯出地圖", LZ.mapToJson(cleanMap()));
        case "import": return openImport();
        case "help": return openHelp();
      }
    });
    app.addEventListener("change", (e) => {
      const f = e.target.dataset.f;
      if (f === "mirror") {
        st.mirror = e.target.checked;
        if (st.mirror) return commit(Object.assign(LZ.mirrorMap(st.map), { mirror: true }), "paint");
        st.map.mirror = false;
        return render();
      }
      if (f === "music") { st.map.music = e.target.value; storage(DRAFT_KEY, st.map); if (LZ.audio && LZ.audio.setTheme) LZ.audio.setTheme(st.map.music); }
      if (f === "railErase") { st.railErase = e.target.checked; }
      if (f === "name") { st.map.name = e.target.value.trim() || "未命名地圖"; storage(DRAFT_KEY, st.map); }
    });

    const clamp = (x, a, b) => Math.max(a, Math.min(b, Number.isFinite(x) ? x : a));
    function cleanMap() {
      const m = LZ.cloneMap(st.map);
      m.variant = key;
      m.mirror = LZ.isSymmetric(m);
      delete m.builtin; delete m.desc;
      return m;
    }
    function saveMap() {
      const m = cleanMap();
      if (!m.name || builtins().some((b) => b.name === m.name)) m.name = (m.name || "我的地圖") + "（自訂）";
      st.map.name = m.name;
      const list = savedMaps().filter((x) => x.name !== m.name && LZ.mapHash(x) !== LZ.mapHash(m));
      list.push(m);
      storage(MAPS_KEY, list);
      elMsg.textContent = `已存到瀏覽器：「${m.name}」。對局頁的「地圖」選單裡可以選到。`;
      sfx("save");
      renderPanel();
      return m;
    }

    // ---------- 對話框 ----------
    function openModal(html) { elModal.innerHTML = html; elModalBack.hidden = false; }
    function closeModal() { elModalBack.hidden = true; elModal.innerHTML = ""; }
    elModalBack.addEventListener("click", (e) => { if (e.target === elModalBack || e.target.closest("[data-close]")) closeModal(); });
    function openText(title, text) {
      openModal(`<h2>${title}</h2><textarea rows="16" readonly>${text.replace(/</g, "&lt;")}</textarea>
        <div class="row end"><span class="muted" data-f="m"></span>
        <button type="button" data-do="copy">複製</button><button type="button" class="primary" data-do="dl">下載 .json</button><button type="button" data-close>關閉</button></div>`);
      elModal.querySelector('[data-do="copy"]').addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text); elModal.querySelector('[data-f="m"]').textContent = "已複製"; }
        catch (err) { elModal.querySelector("textarea").select(); }
      });
      elModal.querySelector('[data-do="dl"]').addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
        a.download = `${(st.map.name || "地圖").replace(/[\\/:*?"<>|]/g, "_")}.json`;
        document.body.appendChild(a); a.click(); a.remove();
      });
    }
    function openImport() {
      openModal(`<h2>匯入地圖</h2><input type="file" accept=".json,application/json" data-f="file">
        <textarea rows="12" placeholder="或貼上地圖 JSON" data-f="text"></textarea><p class="flash" data-f="m"></p>
        <div class="row end"><button type="button" class="primary" data-do="apply">打開</button><button type="button" data-close>取消</button></div>`);
      const fFile = elModal.querySelector('[data-f="file"]');
      const fText = elModal.querySelector('[data-f="text"]');
      fFile.addEventListener("change", async () => { const f = fFile.files && fFile.files[0]; if (f) fText.value = await f.text(); });
      elModal.querySelector('[data-do="apply"]').addEventListener("click", () => {
        const r = LZ.parseMap(fText.value);
        if (r.error) { elModal.querySelector('[data-f="m"]').textContent = r.error; return; }
        closeModal();
        st.mirror = LZ.isSymmetric(r.map);
        commit(r.map, "paint");
      });
    }
    function openHelp() {
      openModal(`<h2>地圖編輯器說明</h2><div class="rules">
        <ul>
        <li><b>格子筆刷</b>：選地形後點或拖曳。大本營每方至少 1 個；行營開局必須空著。</li>
        <li><b>公路剪刀</b>：點兩格之間的公路拆掉或接回，做出偏遠地區的稀疏路網。</li>
        <li><b>鐵路筆</b>：選軌距，從一格拖到相鄰格就鋪一段。兩種軌距相接的格子自動成為<b>換軌站</b>（菱形框）。</li>
        <li><b>過河口</b>：每欄可以是鐵路、公路橋（可炸毀）或山。</li>
        <li><b>區域筆刷</b>：框選一塊範圍後套用偏遠平原、鄉村、沼澤、森林或山地。</li>
        <li><b>鏡像</b>：打開時改一邊，另一邊自動跟著。要做「兩國不同軌距」這類不對稱地圖時關掉。</li>
        <li>右側「檢查」即時告訴你地圖能不能玩；紅框是有問題的格子。能玩才可以按「試玩」。</li>
        </ul>
        <h3>地形規則</h3>${LZ.terrainLegendHtml(LZ.buildVariant(CFG, undefined, demoMap())) }</div>
        <div class="row end"><button type="button" class="primary" data-close>關閉</button></div>`);
    }
    /** 說明用：每種地形各放一格，讓圖例列出全部 */
    function demoMap() {
      const m = LZ.baseMap(7, 7, { level });
      const a = [...m.cells[0][1]]; a[0] = "沼"; a[2] = "原"; a[3] = "村"; a[4] = "山"; m.cells[0][1] = a.join("");
      m.rails = m.rails.filter((r) => !r.path.some((p) => p[0] === 0 && p[2] === 1 && [0, 3, 4].includes(p[1])));
      m.rails.push({ gauge: "narrow", path: [[0, 6, 6], [0, 5, 6]] }, { gauge: "wide", path: [[0, 6, 5], [0, 6, 6]] });
      return m;
    }

    if (LZ.audio && LZ.audio.setTheme) LZ.audio.setTheme(st.map.music || "default");
    render();
  }

  LZ.mountEditor = mountEditor;
})(window);
