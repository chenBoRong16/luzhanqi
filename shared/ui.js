/* 介面：盤面繪製、點擊與拖曳、標記、佈局與棋譜匯入匯出、複盤、規則面板、作弊選單 */
(function (root) {
  "use strict";
  const LZ = root.LZ;

  // 盤面座標（SVG viewBox 單位）
  const CW = 100, RH = 60, RIVER = 96;
  const ACTION_LABEL = { attack: "攻擊", scout: "偵察", move: "移動", drop: "空降", snipe: "狙擊", blow: "炸橋" };

  // 重新掛載（例如切換規則組）時保留的介面設定
  const persist = {
    level: { me: "hardest", foe: "hardest" },
    style: { me: "balanced", foe: "balanced" },
    speed: 500, hints: true, first: 0, suggest: false,
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
    unmountPrev = () => ac.abort();
    const on = (target, type, fn) => target.addEventListener(type, fn, { signal: ac.signal });

    // 擴充版：讀取上次的規則組並重建 variant
    const CFG = LZ.CONFIG || null;
    const hasRules = !!(CFG && CFG.ruleDefs && CFG.ruleDefs.length);
    const RULES_KEY = CFG ? `lzq-${CFG.key}-rules` : null;
    if (hasRules) LZ.VARIANT = LZ.buildVariant(CFG, storage(RULES_KEY) || undefined);
    const V = LZ.VARIANT;
    const W = V.cols * CW;
    const H = 2 * V.rows * RH + RIVER;
    const px = (n) => CW / 2 + V.nodes[n].gx * CW;
    const py = (n) => {
      const gy = V.nodes[n].gy;
      return RH / 2 + gy * RH + (gy >= V.rows ? RIVER : 0);
    };
    const STORE_KEY = `lzq-${V.key}-my-layout`;
    const rulesHtml = typeof V.rulesHtml === "function" ? V.rulesHtml(V) : V.rulesHtml;

    let S = null;
    if (!persist.style) persist.style = { me: "balanced", foe: "balanced" };
    const ui = {
      sel: null, legal: [], editSide: "me", editType: 0,
      hints: persist.hints, aiTimer: null, confirmUntil: 0, first: persist.first, flash: "",
      level: persist.level, style: persist.style, watch: false, speed: persist.speed,
      replay: null, // { rec, k, total, S }
      suggestOn: persist.suggest, suggestion: null, suggestKey: "",
    };

    // ---------- 骨架 ----------
    const ruleCard = hasRules ? `
          <details class="card rules-card">
            <summary>規則開關</summary>
            <p class="muted">佈陣階段可以改；改了會重新開局。開戰後鎖定。</p>
            ${V.ruleDefs.map((d) => `<label class="check" title="${d.desc}"><input type="checkbox" data-rule="${d.id}"> ${d.name}</label>`).join("")}
            <div class="row wrap"><button type="button" class="small" data-act="rulesAll">全開（預設）</button><button type="button" class="small" data-act="rulesLegacy">改版前規則</button></div>
          </details>` : "";

    app.innerHTML = `
      <header class="topbar">
        <a class="back" href="../index.html">← 選版本</a>
        <h1>${V.title}</h1>
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
          ${ruleCard}
          <div class="card">
            <div class="card-title">標記敵棋</div>
            <p class="muted">點敵棋（或按右鍵）選它可能是什麼。</p>
            <label class="check"><input type="checkbox" data-act="hints"> 自動推測（依對撞結果、移動方式）</label>
            <button type="button" class="small" data-act="clearMarks">清除所有標記</button>
          </div>
          <div class="card">
            <div class="card-title">電腦</div>
            <div class="sub-title">對手難度</div>
            <div class="seg" data-group="lv-foe">
              <button type="button" data-lv="foe:easy">簡單</button>
              <button type="button" data-lv="foe:medium">中等</button>
              <button type="button" data-lv="foe:hard">困難</button>
              <button type="button" data-lv="foe:hardest">最難</button>
            </div>
            <div class="sub-title">對手個性</div>
            <div class="seg wrap" data-group="st-foe">
              <button type="button" data-st="foe:balanced" title="攻守大致平均">均衡</button>
              <button type="button" data-st="foe:aggressive" title="愛打、少躲">猛攻</button>
              <button type="button" data-st="foe:cautious" title="惜子、重避險">穩守</button>
              <button type="button" data-st="foe:rusher" title="往前擠、愛空降">衝鋒</button>
              <button type="button" data-st="foe:defender" title="死守己方半場與軍旗">護旗</button>
              <button type="button" data-st="foe:prober" title="愛偵察／狙擊摸底">試探</button>
              <button type="button" data-st="foe:gambler" title="亂、愛換子與炸彈">賭徒</button>
            </div>
            <div class="sub-title">幫我下的電腦 · 難度</div>
            <div class="seg" data-group="lv-me">
              <button type="button" data-lv="me:easy">簡單</button>
              <button type="button" data-lv="me:medium">中等</button>
              <button type="button" data-lv="me:hard">困難</button>
              <button type="button" data-lv="me:hardest">最難</button>
            </div>
            <div class="sub-title">幫我下的電腦 · 個性</div>
            <div class="seg wrap" data-group="st-me">
              <button type="button" data-st="me:balanced" title="攻守大致平均">均衡</button>
              <button type="button" data-st="me:aggressive" title="愛打、少躲">猛攻</button>
              <button type="button" data-st="me:cautious" title="惜子、重避險">穩守</button>
              <button type="button" data-st="me:rusher" title="往前擠、愛空降">衝鋒</button>
              <button type="button" data-st="me:defender" title="死守己方半場與軍旗">護旗</button>
              <button type="button" data-st="me:prober" title="愛偵察／狙擊摸底">試探</button>
              <button type="button" data-st="me:gambler" title="亂、愛換子與炸彈">賭徒</button>
            </div>
            <label class="check"><input type="checkbox" data-act="suggestToggle"> 標示 AI 建議（輪到你時，盤面標出「幫我下的電腦」建議的下一步）</label>
            <div class="row wrap">
              <button type="button" data-act="autoMove">電腦代走一步</button>
            </div>
            <div class="sub-title">觀戰：兩個電腦對打（各用上面的難度＋個性）</div>
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
            <summary>作弊選單</summary>
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

    drawLines();
    const cellEls = buildCells();

    // ---------- 盤面線條（只畫一次；斷橋在 render 時切換） ----------
    function drawLines() {
      const parts = [];
      const half = (side) => {
        const y0 = side === 1 ? 0 : V.rows * RH + RIVER;
        return `<rect class="half h${side}" x="4" y="${y0 + 4}" width="${W - 8}" height="${V.rows * RH - 8}" rx="10"/>`;
      };
      parts.push(half(0), half(1));
      // 河界與山
      const ry = V.rows * RH;
      parts.push(`<rect class="river" x="0" y="${ry}" width="${W}" height="${RIVER}"/>`);
      for (let c = 0; c < V.cols; c++) {
        const x = CW / 2 + c * CW;
        if (!V.railCross.includes(c) && !(V.roadCross || []).includes(c)) {
          const b = ry + RIVER - 18, t = ry + 20;
          parts.push(`<path class="mtn" d="M${x - 34} ${b} L${x - 10} ${t + 8} L${x} ${t + 18} L${x + 12} ${t} L${x + 34} ${b} Z"/>`);
        }
      }
      // 地形底色（森林、碉堡）畫在公路下面
      for (const nd of V.nodes) {
        const x = px(nd.id), y = py(nd.id);
        if (nd.forest) {
          parts.push(`<rect class="forest" x="${x - 46}" y="${y - 27}" width="92" height="54" rx="14"/>`);
          for (const dx of [-30, 30]) parts.push(`<path class="tree" d="M${x + dx} ${y - 20} l9 15 h-5 l7 12 h-22 l7 -12 h-5 z"/>`);
        }
      }
      // 公路
      const seen = new Set();
      for (let a = 0; a < V.nNodes; a++) {
        for (const b of V.adj[a]) {
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const cross = V.nodes[a].side !== V.nodes[b].side;
          if (cross && V.railCross.includes(V.nodes[a].col)) continue;
          if (cross) {
            const x = px(a), col = V.nodes[a].col;
            parts.push(`<g class="bridge-g" data-bridge="${col}">
              <line class="bridge" x1="${x}" y1="${py(a)}" x2="${x}" y2="${py(b)}"/>
              <rect class="bridge-deck" x="${x - 14}" y="${ry + 10}" width="28" height="${RIVER - 20}" rx="3"/>
              <text class="river-label" x="${x}" y="${ry + RIVER / 2 + 4}">橋</text>
              <path class="bridge-x" d="M${x - 20} ${ry + 18} L${x + 20} ${ry + RIVER - 18} M${x + 20} ${ry + 18} L${x - 20} ${ry + RIVER - 18}"/>
            </g>`);
          } else {
            parts.push(`<line class="road" x1="${px(a)}" y1="${py(a)}" x2="${px(b)}" y2="${py(b)}"/>`);
          }
        }
      }
      // 鐵路
      for (const L of V.lines) {
        const d = L.map((n, i) => `${i ? "L" : "M"}${px(n)} ${py(n)}`).join(" ");
        parts.push(`<path class="rail-bed" d="${d}"/><path class="rail-tie" d="${d}"/>`);
      }
      // 站點
      for (const nd of V.nodes) {
        const x = px(nd.id), y = py(nd.id);
        if (nd.camp) parts.push(`<circle class="camp" cx="${x}" cy="${y}" r="27"/>`);
        else if (nd.hq) parts.push(`<rect class="hq" x="${x - 42}" y="${y - 25}" width="84" height="50" rx="22"/>`);
        else parts.push(`<rect class="post" x="${x - 34}" y="${y - 19}" width="68" height="38" rx="5"/>`);
        if (nd.bunker) {
          parts.push(`<rect class="bunker" x="${x - 44}" y="${y - 26}" width="88" height="52" rx="3"/>`);
          for (const dx of [-36, -12, 12, 36]) parts.push(`<rect class="bunker-tooth" x="${x + dx - 5}" y="${y - 31}" width="10" height="7"/>`);
        }
      }
      parts.push(`<text class="river-title" x="${W / 2}" y="${ry + RIVER / 2 + 6}">${V.key === "classic" ? "山 界" : ""}</text>`);
      elSvg.innerHTML = parts.join("");
    }

    function buildCells() {
      const els = [];
      for (const nd of V.nodes) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cell";
        b.style.left = (px(nd.id) / W) * 100 + "%";
        b.style.top = (py(nd.id) / H) * 100 + "%";
        b.dataset.n = nd.id;
        const extra = (nd.camp ? " 行營" : "") + (nd.hq ? " 大本營" : "") + (nd.forest ? " 森林" : "") + (nd.bunker ? " 碉堡" : "");
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
        if (!parsed.error && !parsed.rulesMismatch && !LZ.validateGrid(V, parsed.grid)) return parsed.grid;
      }
      return LZ.defaultGrid(V);
    }
    function saveMyGrid(grid) {
      storage(STORE_KEY, LZ.buildFile(V, "上次佈局", grid));
    }

    function newMatch(myGrid, foeGrid) {
      clearTimeout(ui.aiTimer);
      ui.watch = false;
      ui.replay = null;
      const keep = S ? Object.assign({}, S.cheat) : persist.cheat;
      S = LZ.newGame(V);
      if (keep) { Object.assign(S.cheat, keep); S.cheat.used = false; }
      LZ.setSideGrid(S, S.human, myGrid || loadMyGrid());
      LZ.setSideGrid(S, 1 - S.human, foeGrid || LZ.randomGrid(V));
      S.log.push("佈陣：點兩顆己方棋互換位置（也可以拖曳），好了按「開始對戰」");
      ui.sel = null; ui.legal = [];
      render();
    }

    function startBattle() {
      const err = LZ.startPlay(S, ui.first === 0 ? S.human : 1 - S.human);
      if (err) { flash(err); return; }
      if (!S.cheat.used && !S.illegal[S.human]) saveMyGrid(S.startGrids[S.human]);
      if (S.illegal.some(Boolean)) S.log.push("【作弊】使用違規佈局開局");
      ui.sel = null; ui.legal = [];
      render();
      scheduleAI();
    }

    // ---------- 電腦 ----------
    function aiSide() { return 1 - S.human; }
    function levelOf(side) { return side === S.human ? ui.level.me : ui.level.foe; }
    function styleOf(side) { return side === S.human ? ui.style.me : ui.style.foe; }
    /** 只有我方電腦、且上帝視角開著並勾選「餵給電腦」時才看得見；對手電腦永遠不偷看 */
    function aiOpts(side) {
      return {
        omniscient: side === S.human && S.cheat.reveal && !!S.cheat.feed,
        style: styleOf(side),
      };
    }
    /** 電腦替 side 走一步（替我方走時先存悔棋點） */
    function computerMove(side) {
      if (side === S.human) pushHistory();
      ui.sel = null; ui.legal = [];
      return LZ.aiTurn(S, side, Math.random, levelOf(side), aiOpts(side));
    }
    function pushHistory() {
      S.history.push(LZ.snapshot(S));
      if (S.history.length > 300) S.history.shift();
    }
    function scheduleAI() {
      clearTimeout(ui.aiTimer);
      ui.aiTimer = null;
      if (S.phase !== "play") { ui.watch = false; return; }
      const auto = ui.watch || (S.turn === aiSide() && !S.cheat.infinite);
      if (!auto) return;
      ui.aiTimer = setTimeout(() => {
        ui.aiTimer = null;
        if (S.phase !== "play" || ui.replay) return;
        if (!ui.watch && S.turn !== aiSide()) return;
        computerMove(S.turn);
        render();
        scheduleAI();
      }, ui.watch ? ui.speed : 380);
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
          else { const a = S.board[d.from]; S.board[d.from] = S.board[d.over]; S.board[d.over] = a; }
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

    function doMove(from, mv) {
      pushHistory();
      LZ.applyMove(S, from, mv);
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
      const e1 = LZ.placementError(V, V.types[pa.t], nb.col, nb.row);
      if (e1) return `${V.types[pa.t].name}：${e1}`;
      if (pb) {
        const e2 = LZ.placementError(V, V.types[pb.t], na.col, na.row);
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
          if (nd.side === S.human && nd.id !== ui.sel && (S.cheat.ignorePlacement || !nd.camp) && !deployError(ui.sel, nd.id)) deployOk.add(nd.id);
        }
      }
      const lm = X.lastMove;
      const editing = !ui.replay && (S.cheat.add || S.cheat.del);
      const sug = currentSuggestion();
      for (const nd of V.nodes) {
        const n = nd.id;
        const el = cellEls[n];
        const p = X.board[n];
        const cls = ["cell"];
        if (nd.camp) cls.push("camp");
        if (nd.hq) cls.push("hq");
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

    /** 標示 AI 建議：同一個局面只算一次（電腦有隨機性，重算會跳來跳去） */
    function currentSuggestion() {
      if (!ui.suggestOn || ui.replay || ui.watch || S.phase !== "play" || S.turn !== S.human) return null;
      const key = `${S.ply}|${S.rec.length}|${S.turn}|${ui.level.me}|${ui.style.me}|${S.cheat.reveal && S.cheat.feed}`;
      if (ui.suggestKey !== key) {
        ui.suggestKey = key;
        ui.suggestion = LZ.aiChooseMove(S, S.human, Math.random, ui.level.me, aiOpts(S.human));
      }
      return ui.suggestion;
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
      const dropMark = T.kind === "para" && p.dropUsed && showTrue ? `<span class="pm">降</span>` : "";
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
      const pct = Math.min(100, (X.quiet / V.drawQuiet) * 100);
      return `<div class="track" title="判和計數軌：連續 ${X.quiet} 手沒有對撞，滿 ${V.drawQuiet} 手判和"><div class="track-fill" style="width:${pct}%"></div></div>
        <p class="muted">第 ${X.ply} 手 · 判和計數 ${X.quiet} / ${V.drawQuiet}</p>`;
    }

    function renderStatus() {
      const me = S.human;
      let html = "";
      if (ui.replay) {
        const X = ui.replay.S;
        html = `<div class="phase">複盤中</div>${quietTrack(X)}
          <p class="muted">${X.phase === "end" ? X.endReason : ""}</p>`;
      } else if (S.phase === "deploy") {
        const space = V.cols * V.rows - V.camps.length;
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
      ].filter(([, k]) => (st[k][0] + st[k][1]) > 0);
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
      }
      for (const b of app.querySelectorAll("[data-lv]")) {
        const [who, lv] = b.dataset.lv.split(":");
        b.classList.toggle("on", ui.level[who] === lv);
      }
      for (const b of app.querySelectorAll("[data-st]")) {
        const [who, st] = b.dataset.st.split(":");
        b.classList.toggle("on", ui.style[who] === st);
      }
      for (const b of app.querySelectorAll("[data-speed]")) b.classList.toggle("on", Number(b.dataset.speed) === ui.speed);
      const myTurn = !ui.replay && S.phase === "play" && S.turn === S.human && !ui.watch;
      app.querySelector('[data-act="autoMove"]').disabled = !myTurn;
      const bw = app.querySelector('[data-act="watch"]');
      bw.textContent = ui.watch ? "暫停觀戰" : S.phase === "end" ? "觀戰（本局已結束）" : "開始觀戰";
      bw.disabled = S.phase === "end" || !!ui.replay;
      bw.classList.toggle("primary", ui.watch);
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
      ui.watch = false;
      const total = LZ.recordSteps(rec).length;
      ui.replay = { rec, total, k: total, S: null };
      ui.sel = null; ui.legal = [];
      replayGo(total);
    }
    function replayGo(k) {
      const R = ui.replay;
      if (!R) return;
      R.k = Math.max(0, Math.min(R.total, k));
      R.S = LZ.replayTo(V, R.rec, R.k);
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

    // ---------- 規則組 ----------
    function switchRules(rules, pending) {
      storage(RULES_KEY, rules);
      persist.cheat = Object.assign({}, S.cheat);
      persist.pending = pending || null;
      mountApp(app);
    }

    // ---------- 按鈕 ----------
    on(app, "click", (e) => {
      const b = e.target.closest("button");
      if (!b || elPop.contains(b) || elModal.contains(b)) return;
      if (b.dataset.first != null) { ui.first = persist.first = Number(b.dataset.first); render(); return; }
      if (b.dataset.side) { ui.editSide = b.dataset.side; render(); return; }
      if (b.dataset.lv) {
        const [who, lv] = b.dataset.lv.split(":");
        ui.level[who] = lv;
        S.log.push(`${who === "me" ? "幫我下的電腦" : "對手"}難度：${LZ.AI_LEVELS[lv].name}`);
        ui.suggestKey = "";
        render();
        return;
      }
      if (b.dataset.st) {
        const [who, st] = b.dataset.st.split(":");
        ui.style[who] = st;
        const P = LZ.AI_PERSONAS[st];
        S.log.push(`${who === "me" ? "幫我下的電腦" : "對手"}個性：${P ? P.name : st}${P?.blurb ? `（${P.blurb}）` : ""}`);
        ui.suggestKey = "";
        render();
        return;
      }
      if (b.dataset.speed) { ui.speed = persist.speed = Number(b.dataset.speed); render(); return; }
      const act = b.dataset.act;
      if (!act) return;
      ui.flash = "";
      switch (act) {
        case "rules": return openRules();
        case "start": return startBattle();
        case "random":
          LZ.setSideGrid(S, S.human, LZ.randomGrid(V));
          ui.sel = null;
          return render();
        case "default":
          LZ.setSideGrid(S, S.human, LZ.defaultGrid(V));
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
          if (S.phase !== "play" || S.turn !== S.human) return;
          computerMove(S.human);
          render();
          return scheduleAI();
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
          ui.watch = false;
          LZ.restore(S, snap);
          S.cheat.used = true;
          S.log.push("【作弊】悔棋");
          ui.sel = null; ui.legal = [];
          return render();
        }
        case "rerollFoe":
          LZ.setSideGrid(S, 1 - S.human, LZ.randomGrid(V));
          S.log.push("【作弊】電腦換了一個隨機佈局");
          return render();
        case "replay": return openReplay(LZ.buildRecord(S, "這盤"));
        case "replayExit": return closeReplay();
        case "exportRec": return openExportRecord();
        case "importRec": return openImportRecord();
        case "rulesAll": return switchRules({});
        case "rulesLegacy": return switchRules(LZ.legacyRules(V));
      }
    });

    on(app, "change", (e) => {
      const el = e.target;
      if (el.dataset.cheat) {
        const k = el.dataset.cheat;
        S.cheat[k] = el.checked;
        const names = {
          infinite: "無限回合", reveal: "上帝視角", feed: "上帝視角餵給我方電腦", add: "添加棋子", del: "刪除棋子",
          drag: "拖曳搬動", swap: "交換兩邊棋盤", ignorePlacement: "無視佈局條件", undo: "悔棋",
        };
        S.log.push(`【作弊】${names[k]}：${el.checked ? "開" : "關"}`);
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

    function openRules() {
      openModal(`<h2>規則</h2><div class="rules">${rulesHtml}
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

    function textModal({ title, note, name, build, extra = "" }) {
      openModal(`<h2>${title}</h2>
        <p class="muted">${note}</p>
        <label class="field">名稱 <input type="text" data-f="name" value="${name}" maxlength="40"></label>
        ${extra}
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
      const refresh = () => { fText.value = build(fName.value.trim()); };
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
        build: (name) => {
          const both = elModal.querySelector('[data-f-opt="both"]').checked;
          const illegal = !!LZ.validateGrid(V, myGrid) || (both && !!LZ.validateGrid(V, foeGrid));
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
      if (parsed.rulesMismatch) return offerRuleSwitch(fMsg, parsed.rules, { kind: "layout", text, foe, both });
      const loose = !!S.cheat.ignorePlacement;
      const check = (g) => LZ.validateGrid(V, g, true, loose);
      const err = check(parsed.grid);
      if (err) {
        fMsg.textContent = `${err}。這是違規佈局，要先在作弊選單開啟「無視佈局條件」才能載入`;
        return;
      }
      let foeGrid = null;
      if (parsed.enemyGrid && both) {
        const e2 = check(parsed.enemyGrid);
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
        S.log.push(`已匯入佈局「${parsed.name || "未命名"}」${foeGrid ? "（含電腦的佈局）" : ""}${LZ.validateGrid(V, parsed.grid) ? "（違規佈局）" : ""}`);
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
      closeModal();
      openReplay(rec);
    }

    newMatch();
    // 切換規則組之前要做的事（匯入佈局或棋譜）接著做
    const pending = persist.pending;
    persist.pending = null;
    if (pending && pending.kind === "layout") openImport(pending.foe ? "foe" : "me", pending.text);
    if (pending && pending.kind === "record") openImportRecord(pending.text);
  }

  LZ.mountApp = mountApp;
})(window);
