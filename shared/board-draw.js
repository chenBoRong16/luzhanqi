/* 盤面繪製（SVG）：遊戲與地圖編輯器共用，所以兩邊畫出來一模一樣。
 * 地形用「圖示＋花紋」表示，黑白列印也分得清楚（桌遊條件：地圖要印得出來）。 */
(function (root) {
  "use strict";
  const LZ = root.LZ;

  // 盤面座標（SVG viewBox 單位）
  const CW = 100, RH = 60, RIVER = 96;

  function boardGeom(V) {
    const W = V.cols * CW;
    const H = 2 * V.rows * RH + RIVER;
    const px = (n) => CW / 2 + V.nodes[n].gx * CW;
    const py = (n) => {
      const gy = V.nodes[n].gy;
      return RH / 2 + gy * RH + (gy >= V.rows ? RIVER : 0);
    };
    return { W, H, px, py, CW, RH, RIVER };
  }

  const DEFS = `<defs>
    <pattern id="pat-swamp" width="18" height="12" patternUnits="userSpaceOnUse">
      <path class="swamp-wave" d="M0 6 q4.5 -5 9 0 t9 0"/>
    </pattern>
    <pattern id="pat-plain" width="14" height="14" patternUnits="userSpaceOnUse">
      <circle class="plain-dot" cx="7" cy="7" r="1.8"/>
    </pattern>
  </defs>`;

  function house(x, y) {
    return `<path class="house" d="M${x - 9} ${y + 8} v-9 l9 -8 l9 8 v9 z"/><rect class="house-door" x="${x - 2.5}" y="${y + 2}" width="5" height="6"/>`;
  }
  function tree(x, y) {
    return `<path class="tree" d="M${x} ${y - 20} l9 15 h-5 l7 12 h-22 l7 -12 h-5 z"/>`;
  }

  /** 回傳 SVG 內容（字串）。斷橋以 data-bridge 群組標記，由呼叫端在對局中切換 class */
  function drawBoard(V) {
    const { W, px, py } = boardGeom(V);
    const parts = [DEFS];
    const half = (side) => {
      const y0 = side === 1 ? 0 : V.rows * RH + RIVER;
      return `<rect class="half h${side}" x="4" y="${y0 + 4}" width="${W - 8}" height="${V.rows * RH - 8}" rx="10"/>`;
    };
    parts.push(half(0), half(1));
    const ry = V.rows * RH;
    parts.push(`<rect class="river" x="0" y="${ry}" width="${W}" height="${RIVER}"/>`);
    const railCross = V.railCross || [], roadCross = V.roadCross || [];
    for (let c = 0; c < V.cols; c++) {
      const x = CW / 2 + c * CW;
      if (!railCross.includes(c) && !roadCross.includes(c)) {
        const b = ry + RIVER - 18, t = ry + 20;
        parts.push(`<path class="mtn" d="M${x - 34} ${b} L${x - 10} ${t + 8} L${x} ${t + 18} L${x + 12} ${t} L${x + 34} ${b} Z"/>`);
      }
    }
    // 地形底（畫在公路下面）
    for (const nd of V.nodes) {
      const x = px(nd.id), y = py(nd.id);
      if (nd.forest) {
        parts.push(`<rect class="forest" x="${x - 46}" y="${y - 27}" width="92" height="54" rx="14"/>`);
        parts.push(tree(x - 30, y), tree(x + 30, y));
      } else if (nd.swamp) {
        parts.push(`<rect class="swamp" x="${x - 46}" y="${y - 27}" width="92" height="54" rx="14"/>`);
        parts.push(`<rect x="${x - 46}" y="${y - 27}" width="92" height="54" rx="14" fill="url(#pat-swamp)"/>`);
      } else if (nd.plain) {
        parts.push(`<rect class="plain" x="${x - 48}" y="${y - 28}" width="96" height="56" rx="6"/>`);
        parts.push(`<rect x="${x - 48}" y="${y - 28}" width="96" height="56" rx="6" fill="url(#pat-plain)"/>`);
      } else if (nd.village) {
        parts.push(`<rect class="village" x="${x - 46}" y="${y - 27}" width="92" height="54" rx="10"/>`);
        parts.push(house(x - 31, y - 4), house(x + 31, y - 4));
      }
    }
    // 公路（過河鐵路那一段由鐵路畫）
    const railKey = new Set();
    for (const L of V.lines) for (let i = 1; i < L.length; i++) railKey.add(L[i - 1] < L[i] ? `${L[i - 1]}-${L[i]}` : `${L[i]}-${L[i - 1]}`);
    const seen = new Set();
    for (let a = 0; a < V.nNodes; a++) {
      for (const b of V.adj[a]) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cross = V.nodes[a].side !== V.nodes[b].side;
        if (cross && railKey.has(key)) continue;
        if (cross && roadCross.includes(V.nodes[a].col)) {
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
    // 鐵路：三種軌距三種線型
    V.lines.forEach((L, li) => {
      const g = (V.lineGauge && V.lineGauge[li]) || "std";
      const d = L.map((n, i) => `${i ? "L" : "M"}${px(n)} ${py(n)}`).join(" ");
      parts.push(`<path class="rail-bed g-${g}" d="${d}"/><path class="rail-tie g-${g}" d="${d}"/>`);
      if (g === "wide") parts.push(`<path class="rail-wide-inner" d="${d}"/>`);
    });
    // 站點
    for (const nd of V.nodes) {
      const x = px(nd.id), y = py(nd.id);
      if (nd.mountain) {
        parts.push(`<path class="peak" d="M${x - 40} ${y + 22} L${x - 12} ${y - 22} L${x} ${y - 6} L${x + 14} ${y - 26} L${x + 42} ${y + 22} Z"/>`);
        parts.push(`<path class="peak-snow" d="M${x + 14} ${y - 26} l-7 10 l7 -3 l7 3 z"/>`);
        continue;
      }
      if (nd.camp) parts.push(`<circle class="camp" cx="${x}" cy="${y}" r="27"/>`);
      else if (nd.hq) parts.push(`<rect class="hq" x="${x - 42}" y="${y - 25}" width="84" height="50" rx="22"/>`);
      else parts.push(`<rect class="post" x="${x - 34}" y="${y - 19}" width="68" height="38" rx="5"/>`);
      if (nd.bunker) {
        parts.push(`<rect class="bunker" x="${x - 44}" y="${y - 26}" width="88" height="52" rx="3"/>`);
        for (const dx of [-36, -12, 12, 36]) parts.push(`<rect class="bunker-tooth" x="${x + dx - 5}" y="${y - 31}" width="10" height="7"/>`);
      }
      if (nd.gaugeBreak) {
        parts.push(`<path class="gauge-break" d="M${x} ${y - 30} L${x + 46} ${y} L${x} ${y + 30} L${x - 46} ${y} Z"/>`);
      }
    }
    parts.push(`<text class="river-title" x="${W / 2}" y="${ry + RIVER / 2 + 6}">${V.key === "classic" ? "山 界" : ""}</text>`);
    return parts.join("");
  }

  /** 地形圖例（只列這張地圖有、且規則開著的地形）：圖示、規則、一句現實理由 */
  const LEGEND = [
    { key: "forest", name: "森林", sym: "樹", rule: "走到森林的棋翻倒。森林裡的棋不能被偵察，雷達也看不到", why: "樹林好藏身，但難走" },
    { key: "swamp", name: "沼澤", sym: "波浪紋", rule: "走到沼澤的棋翻倒。坦克不能進入、不能攻擊沼澤裡的棋，連走時也不能經過。不能空降，不能鋪鐵路", why: "坦克太重會陷住；泥地無法著陸、鋪軌" },
    { key: "plain", name: "平原", sym: "點狀紋", rule: "坦克在平原上可以連走 3 格（前 2 格要空）。敵棋站在平原上時，偵察從 3 步遠、雷達從 2 步遠就看得到", why: "開闊地適合裝甲推進，但也無處躲藏" },
    { key: "village", name: "村莊", sym: "小房子", rule: "村莊裡的棋不能被偵察，雷達也看不到。不能空降。從村莊出發的棋這一手只能沿公路走 1 格", why: "建築遮蔽視線，巷弄出不快" },
    { key: "mountain", name: "高山", sym: "山形", rule: "不能進入", why: "天然屏障" },
    { key: "bunker", name: "碉堡", sym: "城垛方框", rule: "站在上面的棋被攻擊時，等級算高一級", why: "堅固工事" },
    { key: "narrow", name: "窄軌", sym: "細線、密枕木", rule: "一手最多走 3 格；任何棋都可以順著窄軌轉彎；坦克不能走", why: "窄軌載重小、彎道多" },
    { key: "wide", name: "寬軌", sym: "雙線", rule: "和標準軌一樣，只是軌距不同", why: "部分國家用寬軌，跨國要換軌" },
    { key: "gaugeBreak", name: "換軌站", sym: "菱形框", rule: "沿鐵路走到這裡就要停下，工兵也一樣；下一手才能走另一種軌距", why: "軌距不同，車廂過不去，要換車" },
  ];

  function terrainLegend(V) {
    const has = {
      forest: V.nodes.some((n) => n.forest), swamp: V.nodes.some((n) => n.swamp), plain: V.nodes.some((n) => n.plain),
      village: V.nodes.some((n) => n.village), mountain: V.nodes.some((n) => n.mountain), bunker: V.nodes.some((n) => n.bunker),
      narrow: (V.lineGauge || []).includes("narrow"), wide: (V.lineGauge || []).includes("wide"),
      gaugeBreak: V.nodes.some((n) => n.gaugeBreak),
    };
    return LEGEND.filter((e) => has[e.key]);
  }

  function terrainLegendHtml(V) {
    const items = terrainLegend(V);
    if (!items.length) return "";
    return `<ul class="legend">${items.map((e) =>
      `<li><b>${e.name}</b>（${e.sym}）：${e.rule}。<span class="muted">${e.why}。</span></li>`).join("")}</ul>`;
  }

  Object.assign(LZ, { boardGeom, drawBoard, terrainLegend, terrainLegendHtml, TERRAIN_LEGEND: LEGEND });
})(typeof window !== "undefined" ? window : globalThis);
