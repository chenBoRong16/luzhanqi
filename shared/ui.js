/* 介面：盤面繪製、點擊與拖曳、標記、佈局與棋譜匯入匯出、複盤、規則面板、作弊選單 */
(function (root) {
  "use strict";
  const LZ = root.LZ;

  const ACTION_LABEL = { attack: "攻擊", scout: "偵察", move: "移動", drop: "空降", snipe: "狙擊", blow: "炸橋", blast: "爆破" };

  // 重新掛載（例如切換規則組）時保留的介面設定
  const persist = {
    speed: 500, hints: true, first: 0, suggest: false, replaySfx: false,
    cheat: null, pending: null,
  };

  function storage(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* 沒有 localStorage 也能玩 */ }
    return null;
  }

  let unmountPrev = null;

  function mountApp(app) {
    if (unmountPrev) unmountPrev();
    const ac = new AbortController();
    let stopAll = () => {};
    unmountPrev = () => { ac.abort(); stopAll(); };
    const on = (target, type, fn) => target.addEventListener(type, fn, { signal: ac.signal });

    // 擴充版：讀取上次的規則組與地圖，重建 variant
    const CFG = LZ.CONFIG || null;
    const hasRules = !!(CFG && CFG.ruleDefs && CFG.ruleDefs.length);
    const hasMaps = hasRules && !!LZ.builtinMaps;
    const RULES_KEY = CFG ? `lzq-${CFG.key}-rules` : null;
    const MAP_KEY = CFG ? `lzq-${CFG.key}-map` : null;
    const MAPS_KEY = CFG ? `lzq-${CFG.key}-maps` : null;
    const LEVEL = CFG && CFG.level != null ? CFG.level : 0;
    /** 可選的地圖：內建範例＋存在瀏覽器裡的自訂地圖 */
    function allMaps() {
      if (!hasMaps) return [];
      const builtin = LZ.builtinMaps(LEVEL, CFG.key).map((m) => Object.assign(m, { builtin: true }));
      const saved = (storage(MAPS_KEY) || []).filter((m) => m && m.format === LZ.MAP_FORMAT);
      return builtin.concat(saved);
    }
    function findMap(hash) { return allMaps().find((m) => LZ.mapHash(m) === hash) || null; }
    function saveUserMap(map) {
      const list = (storage(MAPS_KEY) || []).filter((m) => LZ.mapHash(m) !== LZ.mapHash(map));
      list.push(map);
      storage(MAPS_KEY, list);
    }
    let MAP = null;
    if (hasMaps) {
      const want = storage(MAP_KEY);
      MAP = (want && findMap(want.hash)) || allMaps()[0];
    }
    if (hasRules) LZ.VARIANT = LZ.buildVariant(CFG, storage(RULES_KEY) || undefined, MAP || undefined);
    const V = LZ.VARIANT;
    const { W, H, px, py } = LZ.boardGeom(V);
    const STORE_KEY = `lzq-${V.key}-my-layout`;
    // 設置：和局條件、走棋提醒（每版一份）
    const SET_KEY = `lzq-${V.key}-settings`;
    const DRAW_NS = [30, 50, 60, 80, 100, 150];
    const setting = (() => {
      const raw = storage(SET_KEY) || {};
      const d = raw.draw || {}, a = raw.advice || {};
      return {
        draw: { on: d.on !== false, n: DRAW_NS.includes(d.n) ? d.n : V.drawQuiet },
        advice: { on: a.on !== false, when: a.when === "after" ? "after" : "before", ai: a.ai === "own" ? "own" : "same" },
      };
    })();
    const saveSetting = () => storage(SET_KEY, setting);
    const drawFromSetting = () => (setting.draw.on ? setting.draw.n : 0);
    const rulesHtml = typeof V.rulesHtml === "function" ? V.rulesHtml(V) : V.rulesHtml;

    let S = null;
    const ui = {
      sel: null, legal: [], editSide: "me", editType: 0,
      hints: persist.hints, aiTimer: null, confirmUntil: 0, first: persist.first, flash: "",
      watch: false, speed: persist.speed,
      replay: null, // { rec, k, total, S }
      suggestOn: persist.suggest, suggestion: null, suggestKey: "",
      // AI 建議：排除的我方棋（pid）、這個局面的建議紀錄 [{cond, list, ms}]、看第幾筆、第幾名
      exclude: new Set(), sugHist: [], sugAt: 0, sugRank: 0, sugDirty: false, sugBusy: false,
      think: null, thinkTick: null, // 正在思考：{ side, purpose: "move"|"suggest", key, handle }
    };

    // ---------- 骨架 ----------
    const ruleCard = hasRules ? `
          <details class="card rules-card">
            <summary>規則開關</summary>
            <p class="muted">佈陣階段可以改；改了會重新開局。開戰後鎖定。</p>
            ${["新棋", "地形", "機制"].map((g) => {
              const defs = V.ruleDefs.filter((d) => !d.hidden && (d.group || "機制") === g);
              return defs.length ? `<div class="sub-title">${g}</div>` + defs.map((d) => `<label class="check" title="${d.desc}"><input type="checkbox" data-rule="${d.id}"> ${d.name}</label>`).join("") : "";
            }).join("")}
            <div class="row wrap"><button type="button" class="small" data-act="rulesAll">全開（預設）</button><button type="button" class="small" data-act="rulesLegacy">改版前規則</button></div>
          </details>` : "";

    app.innerHTML = `
      <header class="topbar">
        <a class="back" href="../index.html">← 選版本</a>
        <h1>${V.title}</h1>
        <button type="button" class="ghost" data-act="music" title="背景音樂開關">${(LZ.audio && !LZ.audio.isMusicOn()) ? "音樂：關" : "音樂：開"}</button>
        <button type="button" class="ghost" data-act="volume" title="音效、音樂音量">音量</button>
        <button type="button" class="ghost" data-act="mute" title="音效總開關">${(LZ.audio && LZ.audio.isMuted()) ? "聲音：關" : "聲音：開"}</button>
        <button type="button" class="ghost" data-act="rules">規則</button>
      </header>
      <main class="layout">
        <section class="board-area">
          <div class="board" style="aspect-ratio:${W}/${H};--ar:${W / H};--u:calc(100cqw / ${W})">
            <svg class="lines" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>
            <div class="cells"></div>
          </div>
          <div class="popover" hidden></div>
        </section>
        <aside class="panel">
          <div class="card status-card"></div>
          <div class="card replay-card"></div>
          <div class="card stats-card" hidden></div>
          ${hasMaps ? `<details class="card map-card"${V.mapHash !== LZ.standardHash(V) ? " open" : ""}>
            <summary>地圖：${MAP.name}${LZ.isSymmetric(MAP) ? "" : "（不對稱）"}</summary>
            <p class="muted">${MAP.desc || ""}　${V.cols}×${V.rows}</p>
            <div class="row wrap">
              <select data-act="mapSelect">${allMaps().map((m) => `<option value="${LZ.mapHash(m)}"${LZ.mapHash(m) === V.mapHash ? " selected" : ""}>${m.builtin ? "" : "★ "}${m.name}（${m.cols}×${m.rows}）</option>`).join("")}</select>
            </div>
            <div class="row wrap">
              <button type="button" class="small" data-act="importMap">匯入地圖</button>
              <button type="button" class="small" data-act="exportMap">匯出地圖</button>
              <a class="small-link" href="../地圖編輯器/index.html?v=${CFG.key}">開啟地圖編輯器 →</a>
            </div>
            ${LZ.terrainLegendHtml(V)}
            <p class="muted">換地圖會重新開局；開戰後鎖定。</p>
          </details>` : ""}
          ${ruleCard}
          <details class="card settings-card">
            <summary>設置</summary>
            <label class="check"><input type="checkbox" data-set="drawOn"> 連續無對撞判和</label>
            <label class="ai-limit indent">手數 <select data-set="drawN">${DRAW_NS.map((n) => `<option value="${n}">${n} 手</option>`).join("")}</select></label>
            <p class="muted set-draw-note"></p>
            <div class="sub-title">走棋提醒</div>
            <label class="check"><input type="checkbox" data-set="adviceOn"> AI 覺得你這步不好時提醒你</label>
            <div class="seg small indent" data-group="adviceWhen">
              <button type="button" data-setv="when:before" title="先不走，說明原因，讓你選照走或取消">走之前</button>
              <button type="button" data-setv="when:after" title="照走，走完再說上一步哪裡不好">走之後</button>
            </div>
            <label class="ai-limit indent">提醒用 AI
              <select data-set="adviceAi"><option value="same">跟「幫我下的電腦」相同</option><option value="own">另外設定（電腦卡片多一組）</option></select>
            </label>
          </details>
          <div class="card">
            <div class="card-title">標記敵棋</div>
            <p class="muted">點敵棋（或按右鍵）選它可能是什麼。</p>
            <label class="check"><input type="checkbox" data-act="hints"> 自動推測（依對撞結果、移動方式）</label>
            <button type="button" class="small" data-act="clearMarks">清除所有標記</button>
          </div>
          <div class="card">
            <div class="card-title">電腦（AI 設置）</div>
            <div class="ai-panel"></div>
            <label class="check"><input type="checkbox" data-act="suggestToggle"> 標示 AI 建議（輪到你時，盤面標出「幫我下的電腦」建議的下一步）</label>
            <div class="row wrap">
              <button type="button" data-act="autoMove">電腦代走一步</button>
            </div>
            <div class="sub-title">觀戰：兩個電腦對打（各用上面的 AI 設置）。速度＝每手至少停多久，電腦想得更久就等它想完</div>
            <div class="row wrap">
              <button type="button" data-act="watch">開始觀戰</button>
              <div class="seg small" data-group="speed">
                <button type="button" data-speed="1200">慢</button>
                <button type="button" data-speed="500">中</button>
                <button type="button" data-speed="120">快</button>
              </div>
            </div>
          </div>
          <details class="card cheat">
            <summary>作弊介面</summary>
            <p class="muted">每一項各自開關。</p>
            <label class="check"><input type="checkbox" data-cheat="infinite"> 無限回合（電腦不走，一直輪到你）</label>
            <label class="check"><input type="checkbox" data-cheat="reveal"> 上帝視角（看見敵方棋面）</label>
            <label class="check indent"><input type="checkbox" data-cheat="feed"> 也餵給己方電腦（建議、代走、觀戰時的我方電腦）</label>
            <label class="check"><input type="checkbox" data-cheat="add"> 添加棋子（點空格）</label>
            <div class="row edit-opts indent">
              <div class="seg small" data-group="side">
                <button type="button" data-side="me">我方</button>
                <button type="button" data-side="foe">敵方</button>
              </div>
              <select data-act="editType"></select>
            </div>
            <label class="check"><input type="checkbox" data-cheat="del"> 刪除棋子（點棋子）</label>
            <label class="check"><input type="checkbox" data-cheat="drag"> 拖曳搬動（任何棋拖到任何格；拖到棋上＝互換）</label>
            <label class="check"><input type="checkbox" data-cheat="swap"> 交換兩邊棋盤</label>
            <div class="row indent" data-show="swap"><button type="button" data-act="swap">交換兩邊棋盤</button></div>
            <label class="check"><input type="checkbox" data-cheat="ignorePlacement"> 無視佈局條件（可載入、擺出違規的佈局）</label>
            <label class="ai-limit">和局條件（開戰後也能改）
              <select data-act="cheatDraw"><option value="0">不判和</option>${DRAW_NS.map((n) => `<option value="${n}">連續 ${n} 手沒有對撞判和</option>`).join("")}</select>
            </label>
            <label class="check"><input type="checkbox" data-cheat="undo"> 悔棋</label>
            <div class="row indent" data-show="undo"><button type="button" data-act="undo">悔棋</button></div>
            <div class="sub-title">其他</div>
            <div class="row wrap">
              <button type="button" data-act="importFoe">匯入敵方佈局</button>
              <button type="button" data-act="rerollFoe">電腦換佈局</button>
            </div>
            <p class="muted">用過添加、刪除、搬動、交換後，開局不再檢查棋子數量。</p>
          </details>
          <div class="card">
            <div class="card-title">陣亡</div>
            <div class="losses"></div>
          </div>
          <div class="card">
            <div class="card-title">戰報</div>
            <div class="log"></div>
          </div>
        </aside>
      </main>
      <div class="modal-back" hidden><div class="modal" role="dialog" aria-modal="true"></div></div>`;

    const $ = (sel) => app.querySelector(sel);
    const elBoard = $(".board");
    const elSvg = $(".lines");
    const elCells = $(".cells");
    const elPop = $(".popover");
    const elStatus = $(".status-card");
    const elReplay = $(".replay-card");
    const elStats = $(".stats-card");
    const elLog = $(".log");
    const elLosses = $(".losses");
    const elModalBack = $(".modal-back");
    const elModal = $(".modal");
    const selType = app.querySelector('[data-act="editType"]');
    for (const T of V.types) selType.add(new Option(T.name, T.idx));
    $('[data-act="hints"]').checked = ui.hints;
    $('[data-act="suggestToggle"]').checked = ui.suggestOn;
    const aiPanel = LZ.mountAiPanel($(".ai-panel"), V, {
      onChange(who, set, what) {
        S.log.push(what);
        markSugDirty();
        render();
      },
    });
    stopAll = () => { cancelThink(); cancelAdvice(); clearTimeout(ui.aiTimer); };
    aiPanel.showAdvice(setting.advice.ai === "own");

    elSvg.innerHTML = LZ.drawBoard(V);
    const cellEls = buildCells();

    function buildCells() {
      const els = [];
      for (const nd of V.nodes) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cell";
        b.style.left = (px(nd.id) / W) * 100 + "%";
        b.style.top = (py(nd.id) / H) * 100 + "%";
        b.dataset.n = nd.id;
        const extra = (nd.camp ? " 行營" : "") + (nd.hq ? " 大本營" : "") + (nd.forest ? " 森林" : "") + (nd.bunker ? " 碉堡" : "")
          + (nd.swamp ? " 沼澤" : "") + (nd.plain ? " 平原" : "") + (nd.village ? " 村莊" : "") + (nd.mountain ? " 高山" : "")
          + (nd.gaugeBreak ? " 換軌站" : "");
        b.setAttribute("aria-label", `${nd.side === 0 ? "下方" : "上方"} 第${nd.row + 1}列 第${nd.col + 1}欄${extra}`);
        elCells.appendChild(b);
        els.push(b);
      }
      return els;
    }

    // ---------- 開局 ----------
    function loadMyGrid() {
      const raw = storage(STORE_KEY);
      if (raw) {
        const parsed = LZ.parseFile(V, JSON.stringify(raw));
        if (!parsed.error && !parsed.rulesMismatch && !parsed.mapMismatch && !LZ.validateGrid(V, parsed.grid, true, false, S ? S.human : 0)) return parsed.grid;
      }
      return LZ.defaultGrid(V, 0);
    }
    function saveMyGrid(grid) {
      storage(STORE_KEY, LZ.buildFile(V, "上次佈局", grid));
    }

    function newMatch(myGrid, foeGrid) {
      clearTimeout(ui.aiTimer);
      cancelThink();
      ui.watch = false;
      ui.replay = null;
      const keep = S ? Object.assign({}, S.cheat) : persist.cheat;
      S = LZ.newGame(V);
      S.drawQuiet = drawFromSetting();
      ui.exclude = new Set();
      cancelAdvice();
      if (keep) { Object.assign(S.cheat, keep); S.cheat.used = false; }
      LZ.setSideGrid(S, S.human, myGrid || loadMyGrid());
      LZ.setSideGrid(S, 1 - S.human, foeGrid || LZ.randomGrid(V, Math.random, 1 - S.human));
      S.log.push("佈陣：點兩顆己方棋互換位置（也可以拖曳），好了按「開始對戰」");
      if (LZ.audio && LZ.audio.setScene) LZ.audio.setScene("deploy");
      ui.sel = null; ui.legal = [];
      render();
    }

    function startBattle() {
      const err = LZ.startPlay(S, ui.first === 0 ? S.human : 1 - S.human);
      if (err) { flash(err); return; }
      if (!S.cheat.used && !S.illegal[S.human]) saveMyGrid(S.startGrids[S.human]);
      if (S.illegal.some(Boolean)) S.log.push("【作弊】使用違規佈局開局");
      ui.sel = null; ui.legal = [];
      if (LZ.audio) LZ.audio.playStart();
      if (!LZ.drawLimit(S) && ["foe", "me"].some((w) => aiPanel.get(w).flagMode !== "normal")) {
        S.log.push("提示：電腦設成不佔軍旗、又不判和，這盤可能不會自己結束");
      }
      render();
      scheduleAI();
    }

    function afterMove(ev, prevPhase) {
      if (ui.think && ui.think.purpose === "suggest") cancelThink();
      if (LZ.audio && ev) LZ.audio.playEvent(ev, S.human);
      if (LZ.audio && prevPhase === "play" && S.phase === "end") {
        LZ.audio.playOutcome(S.winner, S.human);
      }
    }

    // ---------- 電腦 ----------
    function aiSide() { return 1 - S.human; }
    function whoOf(side) { return side === S.human ? "me" : "foe"; }
    /** side 這方電腦的 AI 設置（深度、個性、細項、長考上限） */
    function settingsOf(side) { return aiPanel.get(whoOf(side)); }
    /** 只有我方電腦、且上帝視角開著並勾選「餵給電腦」時才看得見；對手電腦永遠不偷看 */
    function aiOpts(side) {
      return { omniscient: side === S.human && S.cheat.reveal && !!S.cheat.feed };
    }
    /** 局面識別：思考途中局面變了（悔棋、作弊、換邊…），想出來的結果就作廢 */
    function stateKey() {
      return `${S.ply}|${S.rec.length}|${S.turn}|${S.phase}|${S.history.length}|${S.cheat.reveal && S.cheat.feed}`;
    }
    function cancelThink() {
      if (ui.think) { ui.think.handle.cancel(); ui.think = null; }
      clearInterval(ui.thinkTick);
      ui.thinkTick = null;
    }
    /** 分段思考（不卡畫面）；想完呼叫 done(pick)。局面在途中變了就丟掉結果 */
    function startThink(side, purpose, done, extraOpts) {
      cancelThink();
      const t = { side, purpose, key: stateKey(), handle: null };
      ui.think = t;
      t.handle = LZ.aiThink(S, side, Math.random, settingsOf(side), Object.assign(aiOpts(side), extraOpts), (res) => {
        if (ui.think !== t) return;
        ui.think = null;
        clearInterval(ui.thinkTick);
        ui.thinkTick = null;
        aiPanel.setLast(whoOf(side), res);
        if (stateKey() !== t.key) { render(); return; }
        done(res.pick, res);
      });
      ui.thinkTick = setInterval(() => {
        const el = elStatus.querySelector(".think-sec");
        if (el && ui.think) el.textContent = (ui.think.handle.elapsed() / 1000).toFixed(1);
      }, 200);
    }
    /** 電腦替 side 走 pick 這一步（替我方走時先存悔棋點） */
    function playAiPick(side, pick) {
      if (side === S.human) pushHistory();
      ui.sel = null; ui.legal = [];
      const prevPhase = S.phase;
      let ev = null;
      if (pick) {
        if (!S.lastMoves) S.lastMoves = [null, null];
        S.lastMoves[side] = { from: pick.from, to: pick.mv.to };
        ev = LZ.applyMove(S, pick.from, pick.mv);
      }
      afterMove(ev, prevPhase);
      return ev;
    }
    function pushHistory() {
      S.history.push(LZ.snapshot(S));
      if (S.history.length > 300) S.history.shift();
    }
    /** 該電腦走時：先思考，想完再等到「每手至少停多久」才走 */
    function scheduleAI() {
      clearTimeout(ui.aiTimer);
      ui.aiTimer = null;
      if (ui.think && ui.think.purpose === "move") cancelThink();
      if (S.phase !== "play") { ui.watch = false; return; }
      if (ui.replay) return;
      const auto = ui.watch || (S.turn === aiSide() && !S.cheat.infinite);
      if (!auto) return;
      const side = S.turn;
      const t0 = Date.now();
      const minWait = ui.watch ? ui.speed : 380;
      const still = (key) => S.phase === "play" && !ui.replay && (ui.watch || S.turn === aiSide()) && stateKey() === key;
      ui.aiTimer = setTimeout(() => {
        ui.aiTimer = null;
        const key = stateKey();
        if (!still(key)) return;
        startThink(side, "move", (pick) => {
          ui.aiTimer = setTimeout(() => {
            ui.aiTimer = null;
            if (!still(key)) return;
            playAiPick(side, pick);
            render();
            scheduleAI();
          }, Math.max(0, minWait - (Date.now() - t0)));
          render();
        });
        render();
      }, 0);
      render();
    }

    // ---------- 拖曳 ----------
    // 作弊「拖曳搬動」：任何棋拖到任何格；佈陣階段：己方棋拖到合法位置
    function canDragFrom(n) {
      if (ui.replay) return false;
      const p = S.board[n];
      if (!p) return false;
      if (S.cheat.drag) return true;
      return S.phase === "deploy" && p.side === S.human;
    }
    on(elCells, "pointerdown", (e) => {
      if (e.button !== 0) return;
      const cell = e.target.closest(".cell");
      if (!cell) return;
      const n = Number(cell.dataset.n);
      if (!canDragFrom(n)) return;
      ui.drag = { from: n, x: e.clientX, y: e.clientY, moved: false, over: null, ghost: null, id: e.pointerId };
    });
    on(window, "pointermove", (e) => {
      const d = ui.drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      if (!d.moved) {
        const src = cellEls[d.from].querySelector(".piece");
        if (!src) { ui.drag = null; return; }
        d.moved = true;
        closePop();
        d.ghost = src.cloneNode(true);
        d.ghost.classList.add("drag-ghost");
        const r = src.getBoundingClientRect();
        d.ghost.style.width = r.width + "px";
        d.ghost.style.height = r.height + "px";
        elBoard.appendChild(d.ghost);
      }
      const br = elBoard.getBoundingClientRect();
      d.ghost.style.left = e.clientX - br.left + "px";
      d.ghost.style.top = e.clientY - br.top + "px";
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const cell = under && under.closest(".cell");
      const over = cell && elCells.contains(cell) ? Number(cell.dataset.n) : null;
      if (over !== d.over) { d.over = over; renderCells(); }
    });
    on(window, "pointerup", (e) => {
      const d = ui.drag;
      if (!d || e.pointerId !== d.id) return;
      ui.drag = null;
      if (!d.moved) return; // 沒拖動就當一般點擊
      d.ghost.remove();
      ui.suppressClick = true;
      setTimeout(() => { ui.suppressClick = false; }, 0);
      ui.flash = "";
      if (d.over != null && d.over !== d.from) {
        if (S.cheat.drag) {
          if (S.phase === "play") pushHistory();
          const err = LZ.cheatMove(S, d.from, d.over);
          if (err) ui.flash = err;
        } else {
          const err = deployError(d.from, d.over);
          if (err) ui.flash = err;
          else { const a = S.board[d.from]; S.board[d.from] = S.board[d.over]; S.board[d.over] = a; if (LZ.audio) LZ.audio.playDeploySwap(); }
        }
      }
      ui.sel = null; ui.legal = [];
      render();
    });

    // ---------- 點擊 ----------
    on(elCells, "click", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell || ui.suppressClick) return;
      onCell(Number(cell.dataset.n));
    });
    on(elCells, "contextmenu", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell || ui.replay) return;
      const p = S.board[Number(cell.dataset.n)];
      if (p && p.side !== S.human) {
        e.preventDefault();
        openMark(Number(cell.dataset.n));
      } else if (p && p.side === S.human && S.phase === "play") {
        e.preventDefault();
        openExclude(Number(cell.dataset.n));
      }
    });

    function onCell(n) {
      closePop();
      ui.flash = "";
      if (ui.replay) return;
      const p = S.board[n];
      // 作弊：添加（點空格）、刪除（點棋子）
      if (!p && S.cheat.add) return onAdd(n);
      if (p && S.cheat.del) return onDelete(n);
      if (S.phase === "deploy") return onDeploy(n);
      if (S.phase === "end") {
        if (p && p.side !== S.human) openMark(n);
        return;
      }
      if (S.turn !== S.human || ui.watch) {
        if (p && p.side !== S.human) openMark(n);
        return;
      }
      if (ui.sel != null) {
        const opts = ui.legal.filter((m) => m.to === n);
        if (opts.length === 1) return doMove(ui.sel, opts[0]);
        if (opts.length > 1) return chooseAction(n, opts);
      }
      if (p && p.side === S.human) {
        if (ui.sel === n) { ui.sel = null; ui.legal = []; }
        else {
          ui.sel = n;
          ui.legal = LZ.legalMoves(S, n);
          if (!ui.legal.length) ui.flash = whyStuck(n);
        }
        render();
        return;
      }
      if (p) { openMark(n); return; }
      ui.sel = null; ui.legal = [];
      render();
    }

    function whyStuck(n) {
      const p = S.board[n];
      const T = V.types[p.t];
      if (!T.mobile) return `${T.name}不能移動`;
      if (p.stunned) return "這顆棋翻倒了，這回合不能動";
      if (V.nodes[n].hq) return "大本營裡的棋不能移動";
      return "這顆棋現在沒有路可走";
    }

    // ---------- 走棋提醒 ----------
    const sameMove = (a, b) => a && b && a.from === b.from && a.mv.to === b.mv.to && a.mv.kind === b.mv.kind;
    function cancelAdvice() {
      if (ui.advice && ui.advice.handle) ui.advice.handle.cancel();
      ui.advice = null;
    }
    /** 用提醒用 AI 判斷 S0 局面下 move 好不好（S0 不能在判斷途中被改；事後模式傳複本） */
    function checkAdvice(S0, move, done) {
      const set = setting.advice.ai === "own" ? aiPanel.get("advice") : aiPanel.get("me");
      return LZ.aiThink(S0, S0.turn, LZ.aiRng(LZ.adviceSeed(S0)), LZ.adviceSettings(set),
        { omniscient: aiOpts(S.human).omniscient, explain: true, extra: [move], exclude: excludeCells(move.from) },
        (res) => done(LZ.adviceJudge(V, res, move)));
    }
    function moveName(m) {
      const a = V.nodes[m.from], b = V.nodes[m.mv.to];
      const T = S.board[m.from] ? V.types[S.board[m.from].t].name : "棋";
      return `${T}（${a.col + 1},${a.row + 1}）→（${b.col + 1},${b.row + 1}）`;
    }
    function doMove(from, mv) {
      const move = { from, mv };
      const on = setting.advice.on && !ui.watch && !ui.replay && S.phase === "play" && S.turn === S.human;
      if (!on) return commitMove(from, mv);
      // 事前：被提醒後同一步再點一次＝照走
      if (ui.advice && ui.advice.state === "warn" && sameMove(ui.advice.move, move)) { cancelAdvice(); return commitMove(from, mv); }
      cancelAdvice();
      if (setting.advice.when === "after") {
        // 事後：先照走，再用走之前的局面複本判斷
        const C = LZ.newGame(V);
        LZ.restore(C, LZ.snapshot(S));
        Object.assign(C, { human: S.human, cheat: Object.assign({}, S.cheat), drawQuiet: S.drawQuiet, lastMoves: S.lastMoves ? S.lastMoves.slice() : null });
        const ply = S.ply;
        commitMove(from, mv);
        const a = { state: "after", move };
        ui.advice = a;
        a.handle = checkAdvice(C, move, (j) => {
          if (ui.advice !== a) return;
          ui.advice = null;
          if (j && j.bad) {
            // 狀態列一點盤面就會清掉，所以戰報也留一份
            ui.flash = `上一步（第 ${ply + 1} 手）可能不好：${j.reason}。AI 會走 ${moveName(j.better)}`;
            S.log.push(`【提醒】${ui.flash}`);
            render();
          }
        });
        return;
      }
      const a = { state: "checking", move };
      ui.advice = a;
      a.handle = checkAdvice(S, move, (j) => {
        if (ui.advice !== a) return;
        if (!j || !j.bad) { ui.advice = null; commitMove(from, mv); return; }
        ui.advice = { state: "warn", move, reason: j.reason, better: j.better };
        render();
      });
      renderStatus();
    }

    function commitMove(from, mv) {
      cancelAdvice();
      pushHistory();
      const prevPhase = S.phase;
      const ev = LZ.applyMove(S, from, mv);
      afterMove(ev, prevPhase);
      ui.sel = null; ui.legal = [];
      render();
      scheduleAI();
    }

    function onDeploy(n) {
      const nd = V.nodes[n];
      const p = S.board[n];
      if (nd.side !== S.human) {
        if (p) ui.flash = "佈陣時只能調整己方（下方）";
        render();
        return;
      }
      if (ui.sel == null || ui.sel === n) {
        ui.sel = ui.sel === n || !p ? null : n;
        render();
        return;
      }
      const err = deployError(ui.sel, n);
      if (!err) {
        const a = S.board[ui.sel];
        S.board[ui.sel] = S.board[n];
        S.board[n] = a;
        ui.sel = null;
        if (LZ.audio) LZ.audio.playDeploySwap();
      } else if (p) {
        ui.sel = n;
      } else {
        ui.flash = err;
      }
      render();
    }

    /** 佈陣時 a 的棋放到 b（b 有棋則互換）是否合法；無視佈局條件時只要在己方半場就行 */
    function deployError(a, b) {
      const pa = S.board[a], pb = S.board[b];
      const na = V.nodes[a], nb = V.nodes[b];
      if (!pa || nb.side !== S.human) return "不能放那裡";
      if (S.cheat.ignorePlacement) return null;
      const e1 = LZ.placementError(V, V.types[pa.t], nb.col, nb.row, nb.side);
      if (e1) return `${V.types[pa.t].name}：${e1}`;
      if (pb) {
        const e2 = LZ.placementError(V, V.types[pb.t], na.col, na.row, na.side);
        if (e2) return `${V.types[pb.t].name}：${e2}`;
      }
      return null;
    }

    function onAdd(n) {
      const side = ui.editSide === "me" ? S.human : 1 - S.human;
      if (S.phase === "play") pushHistory();
      const err = LZ.cheatAdd(S, n, ui.editType, side);
      if (err) ui.flash = err;
      ui.sel = null; ui.legal = [];
      render();
    }
    function onDelete(n) {
      if (S.phase === "play") pushHistory();
      const err = LZ.cheatDelete(S, n);
      if (err) ui.flash = err;
      ui.sel = null; ui.legal = [];
      render();
    }

    // ---------- 浮動選單（標記、選動作） ----------
    function placePop(n) {
      const area = elBoard.parentElement.getBoundingClientRect();
      const r = cellEls[n].getBoundingClientRect();
      elPop.hidden = false;
      const pw = elPop.offsetWidth, ph = elPop.offsetHeight;
      let left = r.left - area.left + r.width / 2 - pw / 2;
      let top = r.bottom - area.top + 6;
      if (top + ph > area.height) top = r.top - area.top - ph - 6;
      left = Math.max(4, Math.min(left, area.width - pw - 4));
      elPop.style.left = left + "px";
      elPop.style.top = Math.max(4, top) + "px";
    }
    function closePop() { elPop.hidden = true; elPop.innerHTML = ""; }

    /** 自己的棋：AI 建議要不要排除它 */
    function openExclude(n) {
      const p = S.board[n];
      if (!p) return;
      const on = ui.exclude.has(p.pid);
      elPop.innerHTML = `<div class="pop-title">${V.types[p.t].name}：AI 建議</div>
        <div class="row"><button type="button" data-ex="${on ? "off" : "on"}">${on ? "取消排除（可以建議這顆）" : "不要建議這顆"}</button></div>`;
      elPop.dataset.n = n;
      elPop.dataset.mode = "exclude";
      placePop(n);
    }
    function openMark(n) {
      const p = S.board[n];
      if (!p || p.side === S.human) return;
      const cand = p.cand[S.human];
      const btns = V.types.map((T) => {
        const possible = cand & (1 << T.idx);
        return `<button type="button" class="mk${p.mark === T.name ? " on" : ""}${possible ? "" : " impossible"}" data-mark="${T.name}" title="${possible ? "" : "依推測不可能是"}${T.name}">${T.name}</button>`;
      }).join("");
      elPop.innerHTML = `<div class="pop-title">這顆敵棋是？</div>
        <div class="mk-grid">${btns}
          <button type="button" class="mk${p.mark === "？" ? " on" : ""}" data-mark="？">？</button>
          <button type="button" class="mk clear" data-mark="">清除</button></div>`;
      elPop.dataset.n = n;
      elPop.dataset.mode = "mark";
      placePop(n);
    }

    function chooseAction(n, opts) {
      elPop.innerHTML = `<div class="pop-title">要做什麼？</div><div class="row">${opts
        .map((m, i) => `<button type="button" data-opt="${i}">${ACTION_LABEL[m.kind] || m.kind}</button>`)
        .join("")}</div>`;
      elPop.dataset.mode = "action";
      ui.pendingOpts = opts;
      placePop(n);
    }

    on(elPop, "click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (elPop.dataset.mode === "mark") {
        const p = S.board[Number(elPop.dataset.n)];
        if (p) p.mark = b.dataset.mark || null;
      } else if (elPop.dataset.mode === "exclude") {
        const p = S.board[Number(elPop.dataset.n)];
        if (p) {
          if (b.dataset.ex === "on") ui.exclude.add(p.pid); else ui.exclude.delete(p.pid);
          markSugDirty();
        }
      } else if (elPop.dataset.mode === "action") {
        const mv = ui.pendingOpts[Number(b.dataset.opt)];
        closePop();
        doMove(ui.sel, mv);
        return;
      }
      closePop();
      render();
    });

    on(document, "keydown", (e) => {
      if (e.key === "Escape") {
        if (!elModalBack.hidden) { closeModal(); return; }
        closePop();
        ui.sel = null; ui.legal = [];
        render();
      }
      if (ui.replay && elModalBack.hidden) {
        if (e.key === "ArrowRight") replayGo(ui.replay.k + 1);
        if (e.key === "ArrowLeft") replayGo(ui.replay.k - 1);
      }
    });
    on(document, "click", (e) => {
      if (!elPop.hidden && !elPop.contains(e.target) && !e.target.closest(".cell")) closePop();
    });

    // ---------- 顯示 ----------
    function hintFor(p, viewer) {
      const mask = p.cand[viewer];
      const list = V.types.filter((T) => mask & (1 << T.idx));
      if (!list.length || list.length === V.types.length) return { text: "", title: "" };
      const title = "可能是：" + list.map((T) => T.name).join("、");
      if (list.length <= 3) return { text: list.map((T) => T.short).join(""), title };
      const ranked = list.filter((T) => T.mobile && T.kind !== "bomb");
      const allRanked = V.types.filter((T) => T.mobile && T.kind !== "bomb");
      const special = list.filter((T) => !T.mobile || T.kind === "bomb").map((T) => T.short).join("");
      let range = "";
      if (ranked.length) {
        const lo = ranked.reduce((a, b) => (b.rank < a.rank ? b : a));
        const hi = ranked.reduce((a, b) => (b.rank > a.rank ? b : a));
        const minAll = Math.min(...allRanked.map((T) => T.rank));
        const maxAll = Math.max(...allRanked.map((T) => T.rank));
        if (lo.rank > minAll && hi.rank < maxAll) range = `${lo.short}~${hi.short}`;
        else if (lo.rank > minAll) range = `${lo.short}↑`;
        else if (hi.rank < maxAll) range = `${hi.short}↓`;
      }
      // 只靠開局位置推得的資訊（例如後兩排可能是雷）不顯示，免得滿盤都是字
      return { text: range ? range + special : "", title };
    }

    /** 現在畫面上要顯示的對局（複盤時是重播出來的狀態） */
    function view() { return ui.replay ? ui.replay.S : S; }

    function renderCells() {
      const X = view();
      const targets = new Map();
      for (const m of ui.legal) {
        const k = targets.get(m.to);
        targets.set(m.to, k ? k + " " + m.kind : m.kind);
      }
      let deployOk = null;
      if (!ui.replay && S.phase === "deploy" && ui.sel != null) {
        deployOk = new Set();
        for (const nd of V.nodes) {
          if (nd.side === S.human && nd.id !== ui.sel && !nd.mountain && (S.cheat.ignorePlacement || !nd.camp) && !deployError(ui.sel, nd.id)) deployOk.add(nd.id);
        }
      }
      const lm = X.lastMove;
      const editing = !ui.replay && (S.cheat.add || S.cheat.del);
      const sug = (ui.advice && ui.advice.state === "warn" && ui.advice.better) || currentSuggestion();
      for (const nd of V.nodes) {
        const n = nd.id;
        const el = cellEls[n];
        const p = X.board[n];
        const cls = ["cell"];
        if (nd.camp) cls.push("camp");
        if (nd.hq) cls.push("hq");
        // 被工兵爆破的防護格（行營、碉堡）：畫成破損樣式
        if (X.ruined && X.ruined.includes(n)) cls.push("ruined");
        if (!ui.replay && ui.sel === n) cls.push("sel");
        if (targets.has(n)) cls.push(...targets.get(n).split(" ").map((k) => "t-" + k));
        if (deployOk && deployOk.has(n)) cls.push("t-deploy");
        if (lm && lm.from === n) cls.push("last-from");
        if (lm && lm.to === n) cls.push("last-to");
        if (sug && sug.from === n) cls.push("sug-from");
        if (sug && sug.mv.to === n) cls.push("sug-to", "sug-" + sug.mv.kind);
        if (editing && S.cheat.add && !p) cls.push("t-add");
        if (editing && S.cheat.del && p) cls.push("t-del");
        if (ui.drag && ui.drag.over === n && ui.drag.from !== n) cls.push("drop-over");
        if (ui.drag && ui.drag.moved && ui.drag.from === n) cls.push("dragging");
        el.className = cls.join(" ");
        el.innerHTML = p ? pieceHtml(X, p) : "";
      }
      // 斷橋
      for (const g of elSvg.querySelectorAll("[data-bridge]")) {
        g.classList.toggle("broken", (X.broken || []).includes(Number(g.dataset.bridge)));
      }
    }

    /** 排除的我方棋目前在哪些格子（AI 建議、代走、提醒都不選） */
    function excludeCells(skip) {
      const out = [];
      S.board.forEach((p, n) => { if (p && p.side === S.human && ui.exclude.has(p.pid) && n !== skip) out.push(n); });
      return out;
    }
    function pieceLabel(n) {
      const p = S.board[n], nd = V.nodes[n];
      return `${p ? V.types[p.t].name : "棋"}（${nd.col + 1},${nd.row + 1}）`;
    }
    /** 改了條件或要求重算：同一局面新增一筆建議紀錄 */
    function markSugDirty() {
      ui.sugDirty = true;
      if (ui.think && ui.think.purpose === "suggest") { cancelThink(); ui.sugBusy = false; }
    }
    /** 目前顯示的建議（第幾筆紀錄的第幾名）；需要時在背景算一筆新的 */
    function currentSuggestion() {
      if (!ui.suggestOn || ui.replay || ui.watch || S.phase !== "play" || S.turn !== S.human) return null;
      const key = stateKey();
      if (ui.suggestKey !== key) {
        ui.suggestKey = key;
        ui.sugHist = []; ui.sugAt = 0; ui.sugRank = 0; ui.sugBusy = false;
        ui.sugDirty = true;
      }
      if (ui.sugDirty && !ui.sugBusy) {
        ui.sugDirty = false;
        ui.sugBusy = true;
        setTimeout(() => {
          if (ui.suggestKey !== key || stateKey() !== key || (ui.think && ui.think.purpose === "move")) { ui.sugBusy = false; return; }
          if (!ui.suggestOn || ui.replay || ui.watch || S.phase !== "play" || S.turn !== S.human) { ui.sugBusy = false; return; }
          const ex = excludeCells();
          const set = settingsOf(S.human);
          const P = LZ.AI_PERSONAS[set.style];
          const cond = `深度 ${set.depth}、${P ? P.name : set.style}` + (ex.length ? `、排除：${ex.map(pieceLabel).join("、")}` : "") + (aiOpts(S.human).omniscient ? "、上帝視角" : "");
          startThink(S.human, "suggest", (pick, res) => {
            ui.sugBusy = false;
            if (ui.suggestKey !== key) return;
            const list = (res.scored || []).slice().sort((x, y) => y.score - x.score).slice(0, 10);
            if (!list.length && pick) list.push(pick);
            ui.sugHist.push({ cond, list, ms: res.ms });
            ui.sugAt = ui.sugHist.length - 1;
            ui.sugRank = 0;
            render();
          }, { explain: true, exclude: ex });
          renderStatus();
        }, 0);
      }
      const rec = ui.sugHist[ui.sugAt];
      return rec ? rec.list[ui.sugRank] || null : null;
    }

    function pieceHtml(X, p) {
      const T = V.types[p.t];
      const me = ui.replay ? ui.replay.rec.human : S.human;
      const mine = p.side === me;
      const allOpen = X.phase === "end" || S.cheat.reveal || (ui.replay && ui.replay.rec.result);
      const showTrue = mine || allOpen || p.faceUp;
      const cls = ["piece", mine ? "me" : "foe"];
      let main = "", badge = "", hint = "", title = "";
      if (showTrue) {
        main = T.name;
        if (!mine && !p.faceUp) cls.push("revealed");
        if (!mine && p.mark) badge = p.mark;
      } else {
        const known = LZ.singleType(p.cand[me]);
        if (known >= 0) { main = V.types[known].name; cls.push("known"); title = "已確定"; }
        else if (p.mark) { main = p.mark; cls.push("marked"); }
        else { cls.push("hidden"); }
        if (known < 0 && ui.hints) {
          const h = hintFor(p, me);
          hint = h.text; title = h.title;
        }
      }
      if (p.faceUp) { cls.push("faceup"); title = "明棋（雙方都看得到）"; }
      else if (mine && X.phase !== "deploy" && LZ.singleType(p.cand[1 - me]) >= 0) {
        cls.push("exposed");
        title = "對方已推得這顆棋";
      }
      if (p.stunned) { cls.push("stunned"); title = "翻倒：下一回合不能動"; }
      const dropMark = (T.kind === "para" && p.dropUsed && showTrue ? `<span class="pm">降</span>` : "") +
        (mine && ui.exclude.has(p.pid) ? `<span class="px" title="AI 建議不會選這顆">禁</span>` : "");
      return `<span class="${cls.join(" ")}"${title ? ` title="${title}"` : ""}>
        <span class="pn">${main}</span>${hint ? `<span class="ph">${hint}</span>` : ""}${badge ? `<span class="pb">${badge}</span>` : ""}${dropMark}</span>`;
    }

    function lossText(X, side, me) {
      const list = X.lost[side];
      if (!list.length) return "無";
      const showTypes = side === me || X.phase === "end" || S.cheat.reveal;
      if (!showTypes) return `${list.length} 顆`;
      const cnt = {};
      for (const t of list) cnt[t] = (cnt[t] || 0) + 1;
      return `${list.length} 顆：` + Object.entries(cnt).sort((a, b) => a[0] - b[0])
        .map(([t, c]) => V.types[t].name + (c > 1 ? "×" + c : "")).join("、");
    }

    function quietTrack(X) {
      const lim = LZ.drawLimit(X);
      if (!lim) return `<p class="muted">第 ${X.ply} 手 · 不判和（連續 ${X.quiet} 手沒有對撞）</p>`;
      const pct = Math.min(100, (X.quiet / lim) * 100);
      return `<div class="track" title="判和計數軌：連續 ${X.quiet} 手沒有對撞，滿 ${lim} 手判和"><div class="track-fill" style="width:${pct}%"></div></div>
        <p class="muted">第 ${X.ply} 手 · 判和計數 ${X.quiet} / ${lim}</p>`;
    }

    function renderStatus() {
      const me = S.human;
      let html = "";
      if (ui.replay) {
        const X = ui.replay.S;
        html = `<div class="phase">複盤中</div>${quietTrack(X)}
          <p class="muted">${X.phase === "end" ? X.endReason : ""}</p>`;
      } else if (S.phase === "deploy") {
        const space = V.nodes.filter((n) => n.side === S.human && !n.camp && !n.mountain).length;
        html = `<div class="phase">佈陣</div>
          <p>點一顆己方棋，再點另一顆己方棋（或亮起的空格）交換；也可以直接拖曳。${V.armySize < space ? `本版 ${space} 格放 ${V.armySize} 顆，有空格可用。` : ""}</p>
          ${S.cheat.ignorePlacement ? `<p class="flash">無視佈局條件：開著（佈陣規則不檢查）</p>` : ""}
          <div class="row wrap">
            <button type="button" class="primary" data-act="start">開始對戰</button>
            <div class="seg small" data-group="first">
              <button type="button" data-first="0">我先手</button>
              <button type="button" data-first="1">電腦先手</button>
            </div>
          </div>
          <div class="row wrap">
            <button type="button" data-act="import">匯入佈局</button>
            <button type="button" data-act="export">匯出佈局</button>
            <button type="button" data-act="random">隨機</button>
            <button type="button" data-act="default">預設</button>
          </div>`;
      } else {
        const playing = S.phase === "play";
        let head;
        if (playing) {
          head = ui.watch
            ? `<div class="phase foe">觀戰中：${S.turn === me ? "下方" : "上方"}電腦思考中…</div>`
            : S.turn === me
              ? `<div class="phase you">你的回合${S.cheat.infinite ? "（無限回合）" : ""}</div>`
              : `<div class="phase foe">電腦思考中…</div>`;
        } else {
          const res = S.winner === -1 ? "和棋" : S.winner === me ? "你贏了" : "電腦贏了";
          head = `<div class="phase end ${S.winner === me ? "win" : S.winner === -1 ? "" : "lose"}">${res}</div><p>${S.endReason}</p>`;
        }
        if (ui.suggestOn && playing && !ui.watch && S.turn === me && ui.sugHist.length) {
          const rec = ui.sugHist[ui.sugAt];
          const m = rec.list[ui.sugRank];
          head += `<div class="sug-row"><b>AI 建議</b> 第 ${ui.sugRank + 1}／${rec.list.length} 名：${m ? moveName(m) : "（沒有可走的步）"}${m && !m.deep && rec.list.some((x) => x.deep) ? "（粗估）" : ""}${m && m.onlyExcluded ? "（其他棋都不能動，只好用排除的棋）" : ""}
            <div class="row wrap">
              <button type="button" class="small" data-act="sugPrev"${ui.sugRank ? "" : " disabled"}>上一個</button>
              <button type="button" class="small" data-act="sugNext"${ui.sugRank < rec.list.length - 1 ? "" : " disabled"}>下一個</button>
              <button type="button" class="small" data-act="sugRedo">重算</button>
              ${ui.sugHist.length > 1 ? `<span class="muted">紀錄</span><button type="button" class="small" data-act="sugHistPrev"${ui.sugAt ? "" : " disabled"}>◀</button><span class="muted">${ui.sugAt + 1}／${ui.sugHist.length}</span><button type="button" class="small" data-act="sugHistNext"${ui.sugAt < ui.sugHist.length - 1 ? "" : " disabled"}>▶</button>` : ""}
            </div>
            <p class="muted">條件：${rec.cond}；${(rec.ms / 1000).toFixed(1)} 秒</p></div>`;
        }
        if (ui.think && playing) {
          const sec = (ui.think.handle.elapsed() / 1000).toFixed(1);
          head += ui.think.purpose === "move"
            ? `<div class="think-row">電腦思考中… <span class="think-sec">${sec}</span> 秒 <button type="button" class="small" data-act="thinkNow">立刻下</button></div>`
            : `<div class="think-row">AI 建議計算中… <span class="think-sec">${sec}</span> 秒 <button type="button" class="small" data-act="thinkNow">立刻給建議</button></div>`;
        }
        if (ui.advice && playing && ui.advice.state === "checking") {
          head += `<div class="think-row">AI 檢查這一步… <button type="button" class="small" data-act="adviceGo">不等了，直接走</button></div>`;
        } else if (ui.advice && playing && ui.advice.state === "warn") {
          head += `<div class="advice-row"><b>AI 提醒：</b>${ui.advice.reason}。AI 會走 ${moveName(ui.advice.better)}（盤面已標出）。
            <div class="row wrap"><button type="button" class="small primary" data-act="adviceGo">照走</button><button type="button" class="small" data-act="adviceCancel">取消</button></div></div>`;
        }
        const restartLabel = playing ? (Date.now() < ui.confirmUntil ? "再按一次確定" : "重新開始") : "再來一局";
        html = `${head}${quietTrack(S)}
          <div class="row wrap">
            <button type="button"${playing ? "" : ' class="primary"'} data-act="restart">${restartLabel}</button>
            <button type="button" data-act="export">匯出開局佈局</button>
            <button type="button" data-act="import">匯入佈局</button>
          </div>`;
      }
      if (ui.flash) html += `<p class="flash">${ui.flash}</p>`;
      elStatus.innerHTML = html;
      for (const b of elStatus.querySelectorAll("[data-first]")) b.classList.toggle("on", Number(b.dataset.first) === ui.first);
    }

    function renderReplay() {
      const R = ui.replay;
      if (!R) {
        const canReplay = S.phase !== "deploy" && S.recStart;
        elReplay.innerHTML = `<div class="card-title">複盤與棋譜</div>
          <div class="row wrap">
            <button type="button" data-act="replay"${canReplay ? "" : " disabled"}>複盤這盤</button>
            <button type="button" data-act="exportRec"${canReplay ? "" : " disabled"}>匯出棋譜</button>
            <button type="button" data-act="importRec">匯入棋譜</button>
          </div>
          ${S.phase === "play" ? `<p class="muted">對局中複盤只看得到你自己這方；結束後全部明牌。</p>` : ""}`;
        return;
      }
      const desc = R.k > 0 ? LZ.describeStep(V, R.rec, R.k - 1) : "開局";
      elReplay.innerHTML = `<div class="card-title">複盤：${R.rec.name || ""}</div>
        <div class="row replay-ctl">
          <button type="button" data-rp="first" title="開局">⏮</button>
          <button type="button" data-rp="prev" title="上一步（←）">◀</button>
          <span class="rp-pos">${R.k} / ${R.total}</span>
          <button type="button" data-rp="next" title="下一步（→）">▶</button>
          <button type="button" data-rp="last" title="最後">⏭</button>
        </div>
        <input type="range" class="rp-slider" min="0" max="${R.total}" value="${R.k}" data-act="rpSlider">
        <p class="muted">${desc}</p>
        <div class="row wrap"><button type="button" class="primary" data-act="replayExit">結束複盤</button><button type="button" data-act="exportRec">匯出這份棋譜</button></div>`;
    }

    function renderStats() {
      const X = view();
      if (X.phase !== "end" || !X.stats) { elStats.hidden = true; return; }
      elStats.hidden = false;
      const me = ui.replay ? ui.replay.rec.human : S.human;
      const st = X.stats;
      const kills = (side) => {
        const e = Object.entries(st.kills[side]);
        return e.length ? e.map(([n, c]) => n + (c > 1 ? "×" + c : "")).join("、") : "無";
      };
      const rows = [
        ["空降", "drop"], ["偵察", "scout"], ["坦克兩格", "tank2"], ["狙擊（命中）", "snipe"], ["炸橋", "blow"],
        ["進入森林", "forest"], ["雷達揭露", "radar"], ["碉堡防守", "bunkerDef"],
        ["進入沼澤", "swamp"], ["進入村莊", "village"], ["坦克平原 3 格", "tank3"], ["窄軌行駛", "narrow"], ["換軌站停下", "gaugeStop"],
      ].filter(([, k]) => st[k] && (st[k][0] + st[k][1]) > 0);
      elStats.innerHTML = `<div class="card-title">統計</div>
        <div><b class="me-c">我方擊殺</b> ${kills(me)}</div>
        <div><b class="foe-c">敵方擊殺</b> ${kills(1 - me)}</div>
        ${rows.length ? `<table class="stats"><tr><th></th><th>我方</th><th>敵方</th></tr>${rows.map(([l, k]) =>
          `<tr><td>${l}</td><td>${st[k][me]}${k === "snipe" ? `（${st.snipeHit[me]}）` : ""}</td><td>${st[k][1 - me]}${k === "snipe" ? `（${st.snipeHit[1 - me]}）` : ""}</td></tr>`).join("")}</table>` : ""}`;
    }

    function renderPanel() {
      for (const el of app.querySelectorAll("[data-cheat]")) el.checked = !!S.cheat[el.dataset.cheat];
      const feed = app.querySelector('[data-cheat="feed"]');
      feed.disabled = !S.cheat.reveal;
      feed.parentElement.classList.toggle("dim", !S.cheat.reveal);
      app.querySelector(".edit-opts").hidden = !S.cheat.add;
      for (const el of app.querySelectorAll("[data-show]")) el.hidden = !S.cheat[el.dataset.show];
      for (const b of app.querySelectorAll("[data-side]")) b.classList.toggle("on", b.dataset.side === ui.editSide);
      selType.value = ui.editType;
      app.querySelector('[data-act="undo"]').disabled = !S.history.length || !!ui.replay;
      app.querySelector('[data-act="rerollFoe"]').disabled = S.phase !== "deploy";
      if (hasRules) {
        const locked = S.phase !== "deploy" || !!ui.replay;
        for (const el of app.querySelectorAll("[data-rule]")) {
          const d = V.ruleDefs.find((x) => x.id === el.dataset.rule);
          el.checked = !!V.rule[d.id];
          el.disabled = locked || (d.piece && !V.rule.newArmy);
        }
        for (const el of app.querySelectorAll('[data-act="rulesAll"],[data-act="rulesLegacy"]')) el.disabled = locked;
        const ms = app.querySelector('[data-act="mapSelect"]');
        if (ms) ms.disabled = locked;
      }
      {
        const locked = S.phase !== "deploy";
        const on = $('[data-set="drawOn"]'), n = $('[data-set="drawN"]');
        on.checked = setting.draw.on; n.value = String(setting.draw.n);
        on.disabled = locked; n.disabled = locked || !setting.draw.on;
        $(".set-draw-note").textContent = locked
          ? `這盤：${LZ.drawLimit(S) ? `連續 ${LZ.drawLimit(S)} 手沒有對撞判和` : "不判和"}（開戰後鎖定；可在作弊介面改）`
          : `預設 ${V.drawQuiet} 手`;
        $('[data-set="adviceOn"]').checked = setting.advice.on;
        $('[data-set="adviceAi"]').value = setting.advice.ai;
        for (const b of app.querySelectorAll("[data-setv]")) b.classList.toggle("on", b.dataset.setv === `when:${setting.advice.when}`);
        const cd = $('[data-act="cheatDraw"]');
        if (cd && document.activeElement !== cd) cd.value = String(LZ.drawLimit(S));
      }
      for (const b of app.querySelectorAll("[data-speed]")) b.classList.toggle("on", Number(b.dataset.speed) === ui.speed);
      const myTurn = !ui.replay && S.phase === "play" && S.turn === S.human && !ui.watch;
      app.querySelector('[data-act="autoMove"]').disabled = !myTurn || !!(ui.think && ui.think.purpose === "move");
      const bw = app.querySelector('[data-act="watch"]');
      bw.textContent = ui.watch ? "暫停觀戰" : S.phase === "end" ? "觀戰（本局已結束）" : "開始觀戰";
      bw.disabled = S.phase === "end" || !!ui.replay;
      bw.classList.toggle("primary", ui.watch);
      const muteBtn = app.querySelector('[data-act="mute"]');
      if (muteBtn && LZ.audio) muteBtn.textContent = LZ.audio.isMuted() ? "聲音：關" : "聲音：開";
      const musicBtn = app.querySelector('[data-act="music"]');
      if (musicBtn && LZ.audio) musicBtn.textContent = LZ.audio.isMusicOn() ? "音樂：開" : "音樂：關";
      const X = view();
      const me = ui.replay ? ui.replay.rec.human : S.human;
      elLosses.innerHTML = `<div><b class="me-c">我方</b> ${lossText(X, me, me)}</div><div><b class="foe-c">敵方</b> ${lossText(X, 1 - me, me)}</div>`;
      elLog.innerHTML = X.log.slice(-60).map((l) => `<div>${l}</div>`).join("");
      elLog.scrollTop = elLog.scrollHeight;
    }

    function render() {
      renderCells();
      renderStatus();
      renderReplay();
      renderStats();
      renderPanel();
      elBoard.classList.toggle("editing", !ui.replay && (S.cheat.add || S.cheat.del || S.cheat.drag));
      elBoard.classList.toggle("deploying", S.phase === "deploy");
      elBoard.classList.toggle("replaying", !!ui.replay);
    }

    function flash(msg) { ui.flash = msg; render(); }

    // ---------- 複盤 ----------
    function openReplay(rec) {
      clearTimeout(ui.aiTimer);
      cancelThink();
      cancelAdvice();
      ui.watch = false;
      const total = LZ.recordSteps(rec).length;
      ui.replay = { rec, total, k: total, S: null };
      ui.sel = null; ui.legal = [];
      replayGo(total);
    }
    function replayGo(k) {
      const R = ui.replay;
      if (!R) return;
      const prevK = R.k;
      R.k = Math.max(0, Math.min(R.total, k));
      // 往後一步且開了「複盤播放事件音效」：重播到前一步再走這一步，取得事件來發聲；否則只出輕提示音
      const step = LZ.recordSteps(R.rec)[R.k - 1];
      if (persist.replaySfx && R.k === prevK + 1 && step && !step.c && LZ.audio) {
        const X = LZ.replayTo(V, R.rec, R.k - 1);
        X.cheat.infinite = !!step.inf;
        const ev = LZ.applyMove(X, step.f, { to: step.t, kind: step.k });
        LZ.audio.playEvent(ev, R.rec.human);
        R.S = LZ.replayTo(V, R.rec, R.k);
      } else {
        R.S = LZ.replayTo(V, R.rec, R.k);
        if (R.k !== prevK && LZ.audio) LZ.audio.tick();
      }
      render();
    }
    function closeReplay() {
      ui.replay = null;
      render();
      scheduleAI();
    }
    on(elReplay, "click", (e) => {
      const b = e.target.closest("[data-rp]");
      if (!b || !ui.replay) return;
      const R = ui.replay;
      replayGo({ first: 0, prev: R.k - 1, next: R.k + 1, last: R.total }[b.dataset.rp]);
    });
    on(elReplay, "input", (e) => {
      if (e.target.dataset.act === "rpSlider") replayGo(Number(e.target.value));
    });

    // ---------- 地圖 ----------
    function switchMap(map, pending) {
      if (!map.builtin && !findMap(LZ.mapHash(map))) saveUserMap(map);
      storage(MAP_KEY, { name: map.name, hash: LZ.mapHash(map) });
      persist.cheat = Object.assign({}, S.cheat);
      persist.pending = pending || null;
      mountApp(app);
    }

    // ---------- 規則組 ----------
    function switchRules(rules, pending) {
      storage(RULES_KEY, rules);
      persist.cheat = Object.assign({}, S.cheat);
      persist.pending = pending || null;
      mountApp(app);
    }

    // ---------- 按鈕 ----------
    on(app, "pointerdown", () => { if (LZ.audio) LZ.audio.unlock(); }, { once: false });
    on(app, "click", (e) => {
      if (LZ.audio) LZ.audio.unlock();
      const b = e.target.closest("button");
      if (!b || elPop.contains(b) || elModal.contains(b)) return;
      if (b.dataset.first != null) { ui.first = persist.first = Number(b.dataset.first); render(); return; }
      if (b.dataset.side) { ui.editSide = b.dataset.side; render(); return; }
      if (b.dataset.setv) {
        const [k, v] = b.dataset.setv.split(":");
        setting.advice[k] = v;
        saveSetting();
        render();
        return;
      }
      if (b.dataset.speed) { ui.speed = persist.speed = Number(b.dataset.speed); render(); return; }
      const act = b.dataset.act;
      if (!act) return;
      ui.flash = "";
      switch (act) {
        case "rules": return openRules();
        case "volume": return openVolume();
        case "mute":
          if (LZ.audio) {
            LZ.audio.unlock();
            LZ.audio.setMuted(!LZ.audio.isMuted());
            LZ.audio.beepUi();
          }
          return render();
        case "music":
          if (LZ.audio) {
            LZ.audio.unlock();
            LZ.audio.setMusic(!LZ.audio.isMusicOn());
            LZ.audio.beepUi();
          }
          return render();
        case "start": return startBattle();
        case "random":
          LZ.setSideGrid(S, S.human, LZ.randomGrid(V, Math.random, S.human));
          ui.sel = null;
          return render();
        case "default":
          LZ.setSideGrid(S, S.human, LZ.defaultGrid(V, S.human));
          ui.sel = null;
          return render();
        case "export": return openExport();
        case "import": return openImport("me");
        case "importFoe": return openImport("foe");
        case "restart":
          if (S.phase === "play" && Date.now() > ui.confirmUntil) {
            ui.confirmUntil = Date.now() + 3000;
            render();
            setTimeout(render, 3100);
            return;
          }
          ui.confirmUntil = 0;
          return newMatch(S.startGrids[S.human] && !S.cheat.used && !S.illegal[S.human] ? S.startGrids[S.human] : null);
        case "clearMarks":
          for (const p of S.board) if (p) p.mark = null;
          return render();
        case "swap":
          if (S.phase === "play") pushHistory();
          LZ.swapSides(S);
          ui.sel = null; ui.legal = [];
          render();
          return scheduleAI();
        case "autoMove":
          if (S.phase !== "play" || S.turn !== S.human || (ui.think && ui.think.purpose === "move")) return;
          {
            const shown = ui.suggestOn && ui.suggestKey === stateKey() ? currentSuggestion() : null;
            if (shown) { playAiPick(S.human, shown); render(); scheduleAI(); return; }
          }
          startThink(S.human, "move", (pick) => {
            playAiPick(S.human, pick);
            render();
            scheduleAI();
          }, { exclude: excludeCells() });
          return render();
        case "adviceGo": {
          const a = ui.advice;
          if (!a) return;
          cancelAdvice();
          return commitMove(a.move.from, a.move.mv);
        }
        case "adviceCancel":
          cancelAdvice();
          ui.sel = null; ui.legal = [];
          return render();
        case "sugPrev": ui.sugRank = Math.max(0, ui.sugRank - 1); return render();
        case "sugNext": { const rec = ui.sugHist[ui.sugAt]; if (rec) ui.sugRank = Math.min(rec.list.length - 1, ui.sugRank + 1); return render(); }
        case "sugRedo": markSugDirty(); return render();
        case "sugHistPrev": ui.sugAt = Math.max(0, ui.sugAt - 1); ui.sugRank = 0; return render();
        case "sugHistNext": ui.sugAt = Math.min(ui.sugHist.length - 1, ui.sugAt + 1); ui.sugRank = 0; return render();
        case "thinkNow":
          if (ui.think) ui.think.handle.stop();
          return;
        case "watch":
          if (ui.watch) {
            ui.watch = false;
            clearTimeout(ui.aiTimer);
            S.log.push("觀戰暫停");
            render();
            return scheduleAI();
          }
          if (S.phase === "deploy") {
            startBattle();
            if (S.phase !== "play") return;
          }
          if (S.cheat.infinite) { S.cheat.infinite = false; S.log.push("【作弊】觀戰時關閉無限回合"); }
          ui.watch = true;
          ui.sel = null; ui.legal = [];
          S.log.push("開始觀戰");
          return scheduleAI();
        case "undo": {
          const snap = S.history.pop();
          if (!snap) return;
          clearTimeout(ui.aiTimer);
          cancelThink();
          cancelAdvice();
          ui.watch = false;
          LZ.restore(S, snap);
          S.cheat.used = true;
          S.log.push("【作弊】悔棋");
          ui.sel = null; ui.legal = [];
          return render();
        }
        case "rerollFoe":
          LZ.setSideGrid(S, 1 - S.human, LZ.randomGrid(V, Math.random, 1 - S.human));
          S.log.push("【作弊】電腦換了一個隨機佈局");
          return render();
        case "replay":
          openReplay(LZ.buildRecord(S, "這盤"));
          ui.replay.fromGame = true;
          return;
        case "replayExit": return closeReplay();
        case "exportRec": return openExportRecord();
        case "importRec": return openImportRecord();
        case "importMap": return openImportMap();
        case "exportMap":
          return textModal({
            title: "匯出地圖", note: "地圖檔可以在地圖編輯器裡打開修改，也可以分享給別人匯入。",
            name: MAP.name, build: (name) => LZ.mapToJson(Object.assign(LZ.cloneMap(MAP), { name, builtin: undefined, desc: undefined })),
          });
        case "rulesAll": return switchRules({});
        case "rulesLegacy": return switchRules(LZ.legacyRules(V));
      }
    });

    on(app, "change", (e) => {
      const el = e.target;
      if (el.dataset.set) {
        const k = el.dataset.set;
        if (k === "drawOn") setting.draw.on = el.checked;
        if (k === "drawN") setting.draw.n = Number(el.value);
        if (k === "adviceOn") { setting.advice.on = el.checked; if (!el.checked) cancelAdvice(); }
        if (k === "adviceAi") { setting.advice.ai = el.value; aiPanel.showAdvice(el.value === "own"); }
        saveSetting();
        if ((k === "drawOn" || k === "drawN") && S.phase === "deploy") S.drawQuiet = drawFromSetting();
        return render();
      }
      if (el.dataset.act === "cheatDraw") {
        const n = Number(el.value);
        if (S.phase === "deploy") {
          setting.draw = { on: n > 0, n: n > 0 ? n : setting.draw.n };
          saveSetting();
          S.drawQuiet = n;
        } else {
          LZ.cheatSetDraw(S, n);
          if (S.phase === "play" && n && S.quiet >= n) LZ.endGame(S, -1, `連續 ${n} 步沒有對撞，和棋`);
        }
        return render();
      }
      if (el.dataset.cheat) {
        const k = el.dataset.cheat;
        S.cheat[k] = el.checked;
        if (k === "feed" || k === "reveal") markSugDirty(); // 建議的條件變了：新增一筆紀錄
        const names = {
          infinite: "無限回合", reveal: "上帝視角", feed: "上帝視角餵給我方電腦", add: "添加棋子", del: "刪除棋子",
          drag: "拖曳搬動", swap: "交換兩邊棋盤", ignorePlacement: "無視佈局條件", undo: "悔棋",
        };
        S.log.push(`【作弊】${names[k]}：${el.checked ? "開" : "關"}`);
        if (LZ.audio) LZ.audio.tick();
        if (k === "infinite") {
          if (el.checked) ui.watch = false;
          if (el.checked && S.phase === "play") { clearTimeout(ui.aiTimer); S.turn = S.human; }
          render();
          return scheduleAI();
        }
        persist.cheat = Object.assign({}, S.cheat);
        return render();
      }
      if (el.dataset.rule) {
        const rules = Object.assign({}, V.rule, { [el.dataset.rule]: el.checked });
        return switchRules(rules);
      }
      const act = el.dataset.act;
      if (act === "mapSelect") {
        const m = findMap(el.value);
        if (m) return switchMap(m);
      }
      if (act === "hints") { ui.hints = persist.hints = el.checked; render(); }
      if (act === "suggestToggle") { ui.suggestOn = persist.suggest = el.checked; ui.suggestKey = ""; render(); }
      if (act === "editType") { ui.editType = Number(el.value); }
    });

    // ---------- 對話框 ----------
    function openModal(html) {
      elModal.innerHTML = html;
      elModalBack.hidden = false;
      const f = elModal.querySelector("input,textarea,button");
      if (f) f.focus();
    }
    function closeModal() { elModalBack.hidden = true; elModal.innerHTML = ""; }
    on(elModalBack, "click", (e) => { if (e.target === elModalBack) closeModal(); });
    on(elModal, "click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });

    function openVolume() {
      const v = LZ.audio ? LZ.audio.getVolume() : { sfx: 0.8, music: 0.6 };
      openModal(`<h2>音量</h2>
        <label class="field">音效 <input type="range" min="0" max="1" step="0.05" value="${v.sfx}" data-vol="sfx"></label>
        <label class="field">音樂 <input type="range" min="0" max="1" step="0.05" value="${v.music}" data-vol="music"></label>
        <label class="check"><input type="checkbox" data-f="replaySfx"${persist.replaySfx ? " checked" : ""}> 複盤往後一步時播放事件音效（預設只有輕提示音）</label>
        <p class="muted">音效只依你在實體棋盤上也會知道的事發聲：撞到地雷和輸給大棋是同一個聲音。觀戰「快」時每秒最多 3 個音效。</p>
        <div class="row end"><button type="button" class="primary" data-close>關閉</button></div>`);
      for (const el of elModal.querySelectorAll("[data-vol]")) {
        el.addEventListener("input", () => {
          if (!LZ.audio) return;
          LZ.audio.unlock();
          LZ.audio.setVolume(el.dataset.vol, el.value);
          if (el.dataset.vol === "sfx") LZ.audio.tick();
        });
      }
      elModal.querySelector('[data-f="replaySfx"]').addEventListener("change", (e) => { persist.replaySfx = e.target.checked; });
    }

    function openRules() {
      openModal(`<h2>規則</h2><div class="rules">${rulesHtml}
        ${hasMaps && LZ.terrainLegend(V).length ? `<h3>這張地圖的地形（${MAP.name}）</h3>${LZ.terrainLegendHtml(V)}` : ""}
        <h3>操作</h3><ul>
        <li>點己方棋 → 點亮起的格子。綠點＝移動，紅框＝攻擊；空降、偵察、狙擊、炸橋各有標示。同一格有多種動作時會跳出選單。</li>
        <li>點敵棋或按右鍵可以標記你猜的棋種。「自動推測」會在棋上用小字列出依據對撞結果、移動方式推得的範圍（例：「旅↑」＝旅長以上）。</li>
        <li>開啟「標示 AI 建議」時，藍色虛線框是電腦建議移動的棋，藍色實心標記是建議的目標格；照不照著走都可以。</li>
        <li>金框＝明棋（雙方都看得到）；橫倒的棋＝翻倒，下一回合不能動；右上角紅點＝對方已推得這顆棋；「降」＝傘兵已空降。</li>
        <li>複盤時可以用 ← → 鍵前後移動。Esc 取消選取或關閉視窗。</li></ul></div>
        <div class="row end"><button type="button" class="primary" data-close>關閉</button></div>`);
    }

    function download(filename, text) {
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const safeName = (s, d) => (s.trim() || d).replace(/[\\/:*?"<>|]/g, "_");

    /**
     * needsCheat()：回傳 true 時，內容會讓你看到電腦的佈局（對局還沒結束）。
     * 先不顯示，按「我知道，算作弊並顯示」才標記用過作弊並顯示。
     */
    function textModal({ title, note, name, build, extra = "", needsCheat = null }) {
      openModal(`<h2>${title}</h2>
        <p class="muted">${note}</p>
        <label class="field">名稱 <input type="text" data-f="name" value="${name}" maxlength="40"></label>
        ${extra}
        <div class="flash" data-f="cheatGate" hidden>內容含電腦的佈局，對局還沒結束：看了算作弊（這盤會標記用過作弊）。
          <div class="row"><button type="button" class="small" data-do="cheatOk">我知道，算作弊並顯示</button></div></div>
        <textarea data-f="text" readonly rows="12"></textarea>
        <div class="row end">
          <span class="muted" data-f="msg"></span>
          <button type="button" data-do="copy">複製</button>
          <button type="button" class="primary" data-do="download">下載 .json</button>
          <button type="button" data-close>關閉</button>
        </div>`);
      const fName = elModal.querySelector('[data-f="name"]');
      const fText = elModal.querySelector('[data-f="text"]');
      const fMsg = elModal.querySelector('[data-f="msg"]');
      const fGate = elModal.querySelector('[data-f="cheatGate"]');
      let cheatOk = false;
      const refresh = () => {
        const gated = needsCheat && needsCheat() && !cheatOk;
        fGate.hidden = !gated;
        fText.hidden = gated;
        for (const b of elModal.querySelectorAll('[data-do="copy"],[data-do="download"]')) b.disabled = gated;
        fText.value = gated ? "" : build(fName.value.trim());
      };
      elModal.querySelector('[data-do="cheatOk"]').addEventListener("click", () => {
        cheatOk = true;
        S.cheat.used = true;
        S.log.push("【作弊】匯出時看到電腦的佈局");
        refresh();
        render();
      });
      refresh();
      fName.addEventListener("input", refresh);
      for (const el of elModal.querySelectorAll("[data-f-opt]")) el.addEventListener("change", refresh);
      elModal.querySelector('[data-do="copy"]').addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(fText.value); fMsg.textContent = "已複製"; }
        catch (err) { fText.select(); fMsg.textContent = "請按 Ctrl+C 複製"; }
      });
      elModal.querySelector('[data-do="download"]').addEventListener("click", () => {
        download(`${safeName(fName.value, "檔案")}.json`, fText.value);
        fMsg.textContent = "已下載";
      });
    }

    function openExport() {
      const myGrid = S.phase === "deploy" ? LZ.sideGrid(S, S.human) : S.startGrids[S.human];
      const foeGrid = S.phase === "deploy" ? LZ.sideGrid(S, 1 - S.human) : S.startGrids[1 - S.human];
      textModal({
        title: "匯出佈局",
        note: S.phase === "deploy" ? "匯出目前的佈陣。" : "匯出這盤開局時的佈陣。",
        name: "我的佈局",
        extra: `<label class="check"><input type="checkbox" data-f-opt="both"> 連同電腦的佈局一起匯出（會看到電腦怎麼擺）</label>`,
        // 對局結束前連同電腦的佈局一起匯出＝看到電腦怎麼擺，算作弊
        needsCheat: () => S.phase !== "end" && elModal.querySelector('[data-f-opt="both"]').checked,
        build: (name) => {
          const both = elModal.querySelector('[data-f-opt="both"]').checked;
          const illegal = !!LZ.validateGrid(V, myGrid, true, false, S.human) || (both && !!LZ.validateGrid(V, foeGrid, true, false, 1 - S.human));
          return LZ.prettyLayout(LZ.buildFile(V, name, myGrid, both ? foeGrid : null, { illegal }));
        },
      });
    }

    function openExportRecord() {
      const base = ui.replay ? ui.replay.rec : null;
      textModal({
        title: "匯出棋譜",
        note: "包含雙方開局佈局、規則組、每一手（含作弊動作）。匯入後可以複盤。",
        name: base ? base.name || "對局" : "對局",
        // 這一盤還沒結束時，棋譜裡有電腦的開局佈局：算作弊（匯入的棋譜不算）
        needsCheat: () => S.phase !== "end" && (!base || (ui.replay && ui.replay.fromGame)),
        build: (name) => JSON.stringify(base ? Object.assign({}, base, { name }) : LZ.buildRecord(S, name)),
      });
    }

    function readerModal({ title, note, placeholder, extra = "", apply }) {
      openModal(`<h2>${title}</h2>
        <p class="muted">${note}</p>
        <input type="file" accept=".json,application/json" data-f="file">
        <textarea data-f="text" rows="10" placeholder="${placeholder}"></textarea>
        ${extra}
        <p class="flash" data-f="msg"></p>
        <div class="row end" data-f="actions">
          <button type="button" class="primary" data-do="apply">套用</button>
          <button type="button" data-close>取消</button>
        </div>`);
      const fFile = elModal.querySelector('[data-f="file"]');
      const fText = elModal.querySelector('[data-f="text"]');
      const fMsg = elModal.querySelector('[data-f="msg"]');
      fFile.addEventListener("change", async () => {
        const f = fFile.files && fFile.files[0];
        if (f) fText.value = await f.text();
      });
      elModal.querySelector('[data-do="apply"]').addEventListener("click", () => apply(fText.value, fMsg));
    }

    /** 規則組不同時，在對話框裡提供一鍵切換 */
    function offerRuleSwitch(fMsg, rules, pending) {
      const diff = V.ruleDefs.filter((d) => !!LZ.resolveRules(CFG, rules)[d.id] !== !!V.rule[d.id]).map((d) => d.name);
      fMsg.innerHTML = `這個檔案用的規則組和目前不同（${diff.join("、")}）。<br><button type="button" class="small" data-do="switch">切換到檔案的規則組並套用</button>`;
      fMsg.querySelector('[data-do="switch"]').addEventListener("click", () => {
        closeModal();
        switchRules(rules, pending);
      });
    }

    /** 地圖不同時：有這張地圖就一鍵切換；沒有就請使用者先匯入（棋譜自帶地圖時直接用） */
    function offerMapSwitch(fMsg, want, embedded, pending) {
      const map = embedded || findMap(want.hash);
      if (!map) {
        fMsg.innerHTML = `這個檔案用的是地圖「${want.name}」，這台電腦上還沒有。請先在「地圖」卡片匯入那張地圖。`;
        return;
      }
      fMsg.innerHTML = `這個檔案用的是地圖「${map.name}」，和目前不同。<br><button type="button" class="small" data-do="switchMap">切換到「${map.name}」並套用</button>`;
      fMsg.querySelector('[data-do="switchMap"]').addEventListener("click", () => {
        closeModal();
        switchMap(map, pending);
      });
    }

    function openImportMap() {
      readerModal({
        title: "匯入地圖",
        note: "選地圖 .json 檔，或把內容貼在下面。會先檢查能不能玩，通過才存進瀏覽器並切換過去。",
        placeholder: "或貼上地圖 JSON",
        apply: (text, fMsg) => {
          const parsed = LZ.parseMap(text);
          if (parsed.error) { fMsg.textContent = parsed.error; return; }
          const errs = LZ.validateMap(parsed.map, CFG, LEVEL);
          if (errs.length) { fMsg.textContent = "這張地圖不能玩：" + errs.map((x) => x.msg).join("；"); return; }
          closeModal();
          switchMap(Object.assign(parsed.map, { variant: CFG.key }));
        },
      });
    }

    function openImport(target, preset) {
      const foe = target === "foe";
      readerModal({
        title: foe ? "匯入敵方佈局（作弊）" : "匯入佈局",
        note: `選 .json 檔，或把內容貼在下面。${S.phase === "deploy" ? "" : "<b>會結束目前這盤，回到佈陣。</b>"}`,
        placeholder: "或貼上佈局 JSON",
        extra: `<label class="check"${foe ? " hidden" : ""}><input type="checkbox" data-f="both" checked> 檔案裡有電腦的佈局時，也一起套用</label>`,
        apply: (text, fMsg) => {
          const both = !foe && elModal.querySelector('[data-f="both"]').checked;
          applyImport(text, foe, both, fMsg);
        },
      });
      if (preset) {
        elModal.querySelector('[data-f="text"]').value = preset;
        applyImport(preset, foe, true, elModal.querySelector('[data-f="msg"]'));
      }
    }

    function applyImport(text, foe, both, fMsg) {
      const parsed = LZ.parseFile(V, text);
      if (parsed.error) { fMsg.textContent = parsed.error; return; }
      if (parsed.rulesMismatch) {
        // 佈局只跟兵力有關：只換兵力相關的開關，其他照目前的規則
        const merged = Object.assign({}, V.rule);
        const norm = LZ.resolveRules(CFG, parsed.rules);
        for (const d of V.ruleDefs) if (d.piece || d.id === "newArmy") merged[d.id] = norm[d.id];
        return offerRuleSwitch(fMsg, merged, { kind: "layout", text, foe, both });
      }
      if (parsed.mapMismatch) return offerMapSwitch(fMsg, parsed.map, null, { kind: "layout", text, foe, both });
      const loose = !!S.cheat.ignorePlacement;
      const check = (g, side) => LZ.validateGrid(V, g, true, loose, side);
      const err = check(parsed.grid, foe ? 1 - S.human : S.human);
      if (err) {
        fMsg.textContent = `${err}。這是違規佈局，要先在作弊選單開啟「無視佈局條件」才能載入`;
        return;
      }
      let foeGrid = null;
      if (parsed.enemyGrid && both) {
        const e2 = check(parsed.enemyGrid, 1 - S.human);
        if (e2) { fMsg.textContent = "電腦的佈局：" + e2; return; }
        foeGrid = parsed.enemyGrid;
      }
      const keep = S.phase === "deploy";
      const curMine = LZ.sideGrid(S, S.human);
      const curFoe = LZ.sideGrid(S, 1 - S.human);
      if (foe) {
        newMatch(keep ? curMine : S.startGrids[S.human], parsed.grid);
        S.cheat.used = true;
        S.log.push(`【作弊】敵方套用佈局「${parsed.name || "未命名"}」`);
      } else {
        newMatch(parsed.grid, foeGrid || (keep ? curFoe : null));
        S.log.push(`已匯入佈局「${parsed.name || "未命名"}」${foeGrid ? "（含電腦的佈局）" : ""}${LZ.validateGrid(V, parsed.grid, true, false, S.human) ? "（違規佈局）" : ""}`);
      }
      closeModal();
      render();
    }

    function openImportRecord(preset) {
      readerModal({
        title: "匯入棋譜",
        note: "選棋譜 .json 檔，或把內容貼在下面。匯入後直接進入複盤。",
        placeholder: "或貼上棋譜 JSON",
        apply: (text, fMsg) => applyImportRecord(text, fMsg),
      });
      if (preset) {
        elModal.querySelector('[data-f="text"]').value = preset;
        applyImportRecord(preset, elModal.querySelector('[data-f="msg"]'));
      }
    }

    function applyImportRecord(text, fMsg) {
      const parsed = LZ.parseRecord(text, V);
      if (parsed.error) { fMsg.textContent = parsed.error; return; }
      const rec = parsed.rec;
      if (hasRules && !LZ.sameRules(V, rec.rules || {})) {
        return offerRuleSwitch(fMsg, rec.rules || {}, { kind: "record", text });
      }
      if (hasMaps && rec.map && LZ.mapHash(rec.map) !== V.mapHash) {
        return offerMapSwitch(fMsg, { name: rec.map.name, hash: LZ.mapHash(rec.map) }, rec.map, { kind: "record", text });
      }
      closeModal();
      openReplay(rec);
    }

    if (LZ.audio && LZ.audio.setTheme) LZ.audio.setTheme(MAP && MAP.music && MAP.music !== "default" ? MAP.music : V.key);
    newMatch();
    // 切換規則組之前要做的事（匯入佈局或棋譜）接著做
    const pending = persist.pending;
    persist.pending = null;
    if (pending && pending.kind === "layout") openImport(pending.foe ? "foe" : "me", pending.text);
    if (pending && pending.kind === "record") openImportRecord(pending.text);
  }

  LZ.mountApp = mountApp;
})(window);
