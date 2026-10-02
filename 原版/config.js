/* 原版：標準兩人陸軍棋（5 欄 × 6 列／半場，25 子） */
(function (root) {
  "use strict";
  const LZ = root.LZ;
  LZ.VARIANT = LZ.buildVariant({
    key: "classic",
    title: "陸軍棋 · 原版",
    cols: 5,
    rows: 6,
    camps: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
    hqs: [[1, 5], [3, 5]],
    railRows: [0, 4],
    railCols: [0, 4],
    railColEnd: 4,
    railCross: [0, 2, 4],
    roadCross: [],
    mineRows: 2,
    dropRows: 0,
    drawQuiet: 60,
    commanderRevealsFlag: true,
    pieces: [
      { name: "司令", short: "司", kind: "commander", rank: 9, count: 1, value: 100 },
      { name: "軍長", short: "軍", kind: "normal", rank: 8, count: 1, value: 75 },
      { name: "師長", short: "師", kind: "normal", rank: 7, count: 2, value: 50 },
      { name: "旅長", short: "旅", kind: "normal", rank: 6, count: 2, value: 35 },
      { name: "團長", short: "團", kind: "normal", rank: 5, count: 2, value: 25 },
      { name: "營長", short: "營", kind: "normal", rank: 4, count: 2, value: 18 },
      { name: "連長", short: "連", kind: "normal", rank: 3, count: 3, value: 12 },
      { name: "排長", short: "排", kind: "normal", rank: 2, count: 3, value: 8 },
      { name: "工兵", short: "工", kind: "engineer", rank: 1, count: 3, value: 16 },
      { name: "炸彈", short: "炸", kind: "bomb", rank: 0, count: 2, value: 40 },
      { name: "地雷", short: "雷", kind: "mine", rank: 0, count: 3, value: 12 },
      { name: "軍旗", short: "旗", kind: "flag", rank: 0, count: 1, value: 1000 },
    ],
    aliases: {
      军长: "軍長", 师长: "師長", 旅长: "旅長", 团长: "團長", 营长: "營長",
      连长: "連長", 排长: "排長", 炸弹: "炸彈", 军旗: "軍旗",
    },
    // 第一列＝前線，最後一列＝大本營那排；"" ＝空格（行營）
    defaultLayout: [
      ["排長", "連長", "師長", "排長", "連長"],
      ["團長", "", "司令", "", "營長"],
      ["旅長", "連長", "", "工兵", "旅長"],
      ["軍長", "", "炸彈", "", "師長"],
      ["營長", "地雷", "工兵", "團長", "炸彈"],
      ["地雷", "軍旗", "地雷", "排長", "工兵"],
    ],
    rulesHtml: `
<h3>目標</h3>
<p>奪下對方<b>軍旗</b>即勝。輪到的一方沒有棋可以動則判負。連續 60 步沒有對撞判和。</p>
<h3>棋子（每方 25 顆）</h3>
<p>司令 1 ＞ 軍長 1 ＞ 師長 2 ＞ 旅長 2 ＞ 團長 2 ＞ 營長 2 ＞ 連長 3 ＞ 排長 3 ＞ 工兵 3；另有炸彈 2、地雷 3、軍旗 1。</p>
<h3>對撞</h3>
<ul>
<li>大吃小；同級同歸於盡。</li>
<li><b>炸彈</b>撞到任何棋（含地雷）都同歸於盡。</li>
<li><b>地雷</b>：只有工兵能排掉，其他棋撞雷陣亡、雷留著。</li>
<li><b>司令陣亡</b>後，該方必須亮出軍旗位置。</li>
<li>只告訴你勝負，不告訴你對方是什麼棋。</li>
</ul>
<h3>佈陣</h3>
<ul>
<li>軍旗必須在大本營；地雷只能放最後兩排；炸彈不能放第一排；行營開局必須空著。</li>
<li>點兩顆己方棋互換位置。</li>
</ul>
<h3>移動</h3>
<ul>
<li><b>公路</b>（細線）：一次一格。行營可以斜走。</li>
<li><b>鐵路</b>（粗線）：直線走任意格，中間不能有棋；只有<b>工兵</b>能在鐵路上轉彎。</li>
<li>過河只有左、中、右三條鐵路；另兩格是山。</li>
<li><b>行營</b>裡的棋不能被攻擊。<b>大本營</b>裡的棋不能再動。地雷、軍旗不能動。</li>
</ul>`,
  });
})(typeof window !== "undefined" ? window : globalThis);
