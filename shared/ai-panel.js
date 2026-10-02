/* AI 設置卡片：對手、幫我下的電腦各一組。
 * 快速套用（簡單／中等／困難／最難）一鍵填入：思考深度、隨機性、攻擊性、避險、護旗、加強判斷；
 * 個性、長考上限另外選。改了任一細項就顯示「自訂」。設定記在瀏覽器（每個版本各一份）。
 * 只管設定與畫面，不呼叫 AI。 */
(function (root) {
  "use strict";
  const LZ = root.LZ || (root.LZ = {});

  const PRESETS = ["easy", "medium", "hard", "hardest"];
  const PRESET_DEPTH = { easy: 1, medium: 1, hard: 2, hardest: 3 };
  const LIMITS = [5, 10, 15, 30, 60, 0]; // 0＝不限
  const DEFAULT_LIMIT = 15;
  const WHO_NAME = { foe: "對手", me: "幫我下的電腦", advice: "提醒用 AI" };
  const WHOS = ["foe", "me", "advice"];
  /** 細項滑桿：鍵、名稱、範圍、說明 */
  const KNOBS = [
    { k: "noise", name: "隨機性", min: 0, max: 40, step: 0.5, tip: "越高越常走出意料之外（也越常失誤）" },
    { k: "attack", name: "攻擊性", min: 0, max: 2, step: 0.05, tip: "越高越愛撞棋、吃子" },
    { k: "danger", name: "避險", min: 0, max: 1, step: 0.01, tip: "越高越會躲開可能被吃的位置" },
    { k: "flag", name: "護旗", min: 0, max: 2, step: 0.05, tip: "越高越重視軍旗安全" },
  ];

  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** 快速套用某一級（含版本覆寫 V.aiLevels），保留個性與長考上限 */
  function fromPreset(V, key, keep = {}) {
    const P = LZ.aiLevelParams(V, key);
    return {
      preset: key, depth: PRESET_DEPTH[key],
      noise: P.noise, attack: P.attack, danger: P.danger, flag: P.flag, smart: !!P.smart,
      style: keep.style || "balanced",
      limit: keep.limit != null ? keep.limit : DEFAULT_LIMIT,
      flagMode: keep.flagMode || "normal",
      spareLast: keep.spareLast !== false,
    };
  }

  /** 和哪一級完全相同；都不同就是「自訂」 */
  function matchPreset(V, s) {
    for (const key of PRESETS) {
      const p = fromPreset(V, key);
      if (p.depth === s.depth && p.smart === s.smart &&
        KNOBS.every(({ k }) => Math.abs(p[k] - s[k]) < 1e-9)) return key;
    }
    return "custom";
  }

  /** 壞資料修正成預設 */
  function sanitize(V, raw) {
    const base = fromPreset(V, "hardest");
    if (!raw || typeof raw !== "object") return base;
    if (PRESETS.includes(raw.preset) && raw.custom !== true && raw.depth == null) {
      return fromPreset(V, raw.preset, raw);
    }
    const s = Object.assign({}, base);
    s.depth = clamp(Math.round(num(raw.depth, base.depth)), 1, LZ.AI_MAX_DEPTH || 5);
    for (const { k, min, max } of KNOBS) s[k] = clamp(num(raw[k], base[k]), min, max);
    s.smart = raw.smart != null ? !!raw.smart : base.smart;
    s.style = LZ.AI_PERSONAS && LZ.AI_PERSONAS[raw.style] ? raw.style : "balanced";
    s.limit = LIMITS.includes(raw.limit) ? raw.limit : DEFAULT_LIMIT;
    const fm = raw.flagMode === "slaughter" ? "clear" : raw.flagMode; // 舊名
    s.flagMode = LZ.AI_FLAG_MODES && LZ.AI_FLAG_MODES[fm] ? fm : "normal";
    s.spareLast = raw.spareLast !== false;
    s.preset = matchPreset(V, s);
    return s;
  }

  function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 沒有 localStorage 也能玩 */ }
  }

  function fmtSec(s) {
    if (s < 0.05) return "立刻";
    if (s < 1) return `約 ${s.toFixed(1)} 秒`;
    return `約 ${s < 10 ? s.toFixed(1) : Math.round(s)} 秒`;
  }

  function sectionHtml(who) {
    const name = WHO_NAME[who];
    const depthBtns = [];
    for (let d = 1; d <= (LZ.AI_MAX_DEPTH || 5); d++) depthBtns.push(`<button type="button" data-ai="depth" data-v="${d}">${d}</button>`);
    const styles = Object.entries(LZ.AI_PERSONAS || {}).map(([k, P]) =>
      `<button type="button" data-ai="style" data-v="${k}" title="${P.blurb || ""}">${P.name}</button>`).join("");
    const knobs = KNOBS.map(({ k, name: kn, min, max, step, tip }) => `
        <label class="ai-knob" title="${tip}"><span>${kn}</span>
          <input type="range" data-ai="${k}" min="${min}" max="${max}" step="${step}">
          <output data-out="${k}"></output></label>`).join("");
    return `
      <div class="ai-set" data-who="${who}">
        <div class="sub-title">${name} · AI 設置 <span class="ai-tag"></span></div>
        <div class="seg" data-group="preset">
          <button type="button" data-ai="preset" data-v="easy">簡單</button>
          <button type="button" data-ai="preset" data-v="medium">中等</button>
          <button type="button" data-ai="preset" data-v="hard">困難</button>
          <button type="button" data-ai="preset" data-v="hardest">最難</button>
        </div>
        <div class="sub-title">思考深度（越深越強，也越花時間）</div>
        <div class="seg small" data-group="depth">${depthBtns.join("")}</div>
        <p class="muted ai-est"></p>
        <div class="sub-title">個性</div>
        <div class="seg wrap" data-group="style">${styles}</div>
        <label class="ai-limit" title="放水：不撞可能是軍旗的棋；屠戮：專注吃子但不佔軍旗。不偷看，只依推理判斷哪些棋可能是軍旗">軍旗
          <select data-ai="flagMode">${Object.entries(LZ.AI_FLAG_MODES || {}).map(([k, M]) => `<option value="${k}" title="${M.blurb}">${M.name}</option>`).join("")}</select>
        </label>
        <label class="check indent ai-spare-last"><input type="checkbox" data-ai="spareLast"> 也不讓對方無棋可動（不吃最後一顆能動的棋）</label>
        <label class="ai-limit">長考上限
          <select data-ai="limit">${LIMITS.map((v) => `<option value="${v}">${v ? `${v} 秒` : "不限"}</option>`).join("")}</select>
        </label>
        <details class="ai-adv">
          <summary>細項</summary>
          ${knobs}
          <label class="check"><input type="checkbox" data-ai="smart"> 加強判斷（看全盤壓力、不亂撞糊棋）</label>
        </details>
      </div>`;
  }

  /**
   * 掛到 container。opts.onChange(who, settings, what)：設定改了（what 是給紀錄看的一句話）。
   * 回傳 { get(who), setLast(who, info), refresh() }。
   */
  function mountAiPanel(container, V, opts = {}) {
    const KEY = `lzq-${V.key}-ai`;
    const saved = storageGet(KEY) || {};
    const set = { foe: sanitize(V, saved.foe), me: sanitize(V, saved.me), advice: sanitize(V, saved.advice) };
    const last = { foe: null, me: null, advice: null };
    container.innerHTML = WHOS.map(sectionHtml).join("");
    container.querySelector('.ai-set[data-who="advice"]').hidden = true;
    const save = () => storageSet(KEY, set);

    function refresh() {
      for (const who of WHOS) {
        const s = set[who];
        const el = container.querySelector(`.ai-set[data-who="${who}"]`);
        s.preset = matchPreset(V, s);
        el.querySelector(".ai-tag").textContent = s.preset === "custom" ? "自訂" : LZ.AI_LEVELS[s.preset].name;
        for (const b of el.querySelectorAll("[data-ai]")) {
          const k = b.dataset.ai;
          if (b.tagName === "BUTTON") b.classList.toggle("on", String(s[k]) === b.dataset.v);
        }
        for (const b of el.querySelectorAll('[data-ai="depth"]')) {
          const D = LZ.AI_DEPTHS[b.dataset.v];
          b.title = `${D.name}：${fmtSec(LZ.aiEstimateSeconds(V, Number(b.dataset.v)))}`;
        }
        const D = LZ.AI_DEPTHS[s.depth];
        let est = `深度 ${s.depth}「${D.name}」：一手${fmtSec(LZ.aiEstimateSeconds(V, s.depth))}`;
        if (last[who]) {
          est += `　上一手：${(last[who].ms / 1000).toFixed(last[who].ms < 10000 ? 1 : 0)} 秒`;
          if (last[who].timedOut) est += "（時間到）";
          else if (last[who].stopped) est += "（立刻下）";
        }
        el.querySelector(".ai-est").textContent = est;
        el.querySelector('[data-ai="limit"]').value = String(s.limit);
        el.querySelector('[data-ai="flagMode"]').value = s.flagMode;
        el.querySelector('input[data-ai="spareLast"]').checked = s.spareLast;
        el.querySelector(".ai-spare-last").hidden = s.flagMode !== "spare";
        for (const { k } of KNOBS) {
          el.querySelector(`input[data-ai="${k}"]`).value = String(s[k]);
          el.querySelector(`[data-out="${k}"]`).textContent = String(+s[k].toFixed(2));
        }
        el.querySelector('input[data-ai="smart"]').checked = !!s.smart;
      }
    }

    const tell = (who, what) => {
      save();
      refresh();
      if (opts.onChange) opts.onChange(who, set[who], `${WHO_NAME[who]}${what}`);
    };

    container.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-ai]");
      if (!b) return;
      const who = b.closest(".ai-set").dataset.who;
      const s = set[who];
      const k = b.dataset.ai, v = b.dataset.v;
      if (k === "preset") {
        set[who] = fromPreset(V, v, s);
        tell(who, `快速套用：${LZ.AI_LEVELS[v].name}（深度 ${set[who].depth}）`);
      } else if (k === "depth") {
        s.depth = Number(v);
        tell(who, `思考深度：${v}（${LZ.AI_DEPTHS[v].name}）`);
      } else if (k === "style") {
        s.style = v;
        const P = LZ.AI_PERSONAS[v];
        tell(who, `個性：${P.name}${P.blurb ? `（${P.blurb}）` : ""}`);
      }
    });
    container.addEventListener("input", (e) => {
      const el = e.target;
      const k = el.dataset && el.dataset.ai;
      if (!k || !KNOBS.some((x) => x.k === k)) return;
      const who = el.closest(".ai-set").dataset.who;
      set[who][k] = Number(el.value);
      save();
      refresh();
    });
    container.addEventListener("change", (e) => {
      const el = e.target;
      const k = el.dataset && el.dataset.ai;
      if (!k) return;
      const who = el.closest(".ai-set").dataset.who;
      const s = set[who];
      if (k === "flagMode") {
        s.flagMode = el.value;
        const M = LZ.AI_FLAG_MODES[s.flagMode];
        tell(who, `軍旗：${M.name}（${M.blurb}）`);
      } else if (k === "spareLast") {
        s.spareLast = el.checked;
        tell(who, `放水也不讓對方無棋可動：${s.spareLast ? "開" : "關"}`);
      } else if (k === "limit") {
        s.limit = Number(el.value);
        tell(who, `長考上限：${s.limit ? `${s.limit} 秒` : "不限"}`);
      } else if (k === "smart") {
        s.smart = el.checked;
        tell(who, `加強判斷：${s.smart ? "開" : "關"}`);
      } else if (KNOBS.some((x) => x.k === k)) {
        const kn = KNOBS.find((x) => x.k === k);
        tell(who, `${kn.name}：${+s[k].toFixed(2)}`);
      }
    });

    refresh();
    return {
      get: (who) => Object.assign({}, set[who]),
      setLast(who, info) { last[who] = info; refresh(); },
      /** 「提醒用 AI」選「另外設定」時才顯示這組 */
      showAdvice(on) { container.querySelector('.ai-set[data-who="advice"]').hidden = !on; },
      refresh,
    };
  }

  Object.assign(LZ, {
    mountAiPanel,
    aiSettings: { PRESETS, PRESET_DEPTH, LIMITS, KNOBS, fromPreset, matchPreset, sanitize, fmtSec },
  });
})(typeof window !== "undefined" ? window : globalThis);
