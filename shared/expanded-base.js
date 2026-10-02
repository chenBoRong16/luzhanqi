/* 擴充版共用定義：盤面、棋子、規則表、地形。
 * level 0（擴充版-0）：規則保持簡單，沒有「等效等級」類規則。
 * level 1（擴充版-1）：再加上碉堡（地形加級）與狙擊手（以營長等級比較）。
 * 兩版都必須能做成實體棋盤遊戲：規則狀態只能是位置、明棋、翻倒、已空降、斷橋、判和計數。 */
(function (root) {
  "use strict";
  const LZ = root.LZ;

  /** 規則表；level：最低需要的版本。rank 等級越大越強 */
  const RULE_DEFS = [
    { id: "newArmy", name: "新兵力（防空炮、雷達站等新棋）", desc: "關掉＝舊兵力 35 顆：連長、排長各 3，沒有新棋。用來讀改版前的佈局檔", level: 0 },
    { id: "tankMine", name: "坦克破雷", desc: "坦克攻擊地雷時勝，地雷移除（關掉＝同歸於盡）", level: 0 },
    { id: "dropStun", name: "空降落地翻倒", desc: "傘兵空降後翻倒，下一回合不能動", level: 0 },
    { id: "tankTurn", name: "坦克可轉彎", desc: "坦克公路兩格可以轉一次彎（關掉＝只能直線）", level: 0 },
    { id: "scout2", name: "偵察距離 2", desc: "偵察公路距離 2 以內的敵棋（關掉＝只能偵察相鄰）", level: 0 },
    { id: "aa", name: "防空炮", desc: "新棋。相鄰格子對方不能空降；被傘兵攻擊必勝", level: 0, piece: true },
    { id: "radar", name: "雷達站", desc: "新棋。不能動；走到相鄰的敵棋翻成明棋；被攻擊就被移除", level: 0, piece: true },
    { id: "forest", name: "森林", desc: "新地形。走進去翻倒一回合；裡面的棋不能被偵察、雷達、狙擊", level: 0 },
    { id: "bridgeBlow", name: "可炸毀的橋", desc: "炸彈站在橋頭可以炸橋：炸彈消失，該橋永久斷", level: 0 },
    { id: "gauge", name: "軌距", desc: "換軌站要停下；窄軌一次最多 3 格、坦克不能上（關掉＝所有鐵路都當標準軌）", level: 0 },
    { id: "plain", name: "平原", desc: "坦克整段走平原可走 3 格；平原上的棋更容易被偵察、雷達看到", level: 0 },
    { id: "village", name: "村莊", desc: "裡面的棋不會被偵察、雷達揭露、不能空降；從村莊出發只能走一格", level: 0 },
    { id: "swamp", name: "沼澤", desc: "走進去翻倒一回合；坦克、炸彈進不去；不能空降、不能鋪鐵路", level: 0 },
    { id: "bunker", name: "碉堡", desc: "新地形。站在上面的棋防守時高一級", level: 1 },
    { id: "sniper", name: "狙擊手", desc: "新棋。可狙擊直線距離 2 的敵棋，以營長等級比較", level: 1, piece: true },
  ];

  const PIECES = [
    { name: "司令", short: "司", kind: "commander", rank: 10, count: 1, value: 100 },
    { name: "軍長", short: "軍", kind: "normal", rank: 9, count: 1, value: 75 },
    { name: "坦克", short: "坦", kind: "tank", rank: 8.5, count: 2, value: 60 },
    { name: "師長", short: "師", kind: "normal", rank: 8, count: 2, value: 50 },
    { name: "旅長", short: "旅", kind: "normal", rank: 7, count: 2, value: 35 },
    { name: "團長", short: "團", kind: "normal", rank: 6, count: 2, value: 25 },
    { name: "營長", short: "營", kind: "normal", rank: 5, count: 2, value: 18 },
    { name: "防空炮", short: "防", kind: "aa", rank: 4.5, count: 1, value: 22, rule: "aa" },
    { name: "連長", short: "連", kind: "normal", rank: 4, count: 2, countOld: 3, value: 12 },
    { name: "排長", short: "排", kind: "normal", rank: 3, count: 2, countOld: 3, value: 8 },
    { name: "狙擊手", short: "狙", kind: "sniper", rank: 3, count: 1, value: 20, rule: "sniper" },
    { name: "傘兵", short: "傘", kind: "para", rank: 2.5, count: 2, value: 14 },
    { name: "偵察", short: "偵", kind: "scout", rank: 1.5, count: 2, value: 14 },
    { name: "工兵", short: "工", kind: "engineer", rank: 1, count: 4, value: 16 },
    { name: "間諜", short: "諜", kind: "spy", rank: 0.5, count: 1, value: 30 },
    { name: "雷達站", short: "達", kind: "radar", rank: 0, count: 1, value: 20, rule: "radar" },
    { name: "炸彈", short: "炸", kind: "bomb", rank: 0, count: 3, value: 40 },
    { name: "地雷", short: "雷", kind: "mine", rank: 0, count: 4, value: 12 },
    { name: "軍旗", short: "旗", kind: "flag", rank: 0, count: 1, value: 1000 },
  ];

  const ALIASES = {
    军长: "軍長", 师长: "師長", 旅长: "旅長", 团长: "團長", 营长: "營長",
    连长: "連長", 排长: "排長", 炸弹: "炸彈", 军旗: "軍旗",
    伞兵: "傘兵", 侦察: "偵察", 间谍: "間諜",
    防空炮: "防空炮", 狙击手: "狙擊手", 雷达站: "雷達站", 雷达: "雷達站", 雷達: "雷達站",
  };

  // 舊兵力（35 顆）的預設佈局：改版前的「中路鐵壁」
  const LAYOUT_OLD = [
    ["連長", "排長", "營長", "師長", "團長", "排長", "連長"],
    ["偵察", "", "旅長", "坦克", "團長", "", "傘兵"],
    ["營長", "傘兵", "", "軍長", "", "偵察", "排長"],
    ["師長", "", "間諜", "司令", "炸彈", "", "旅長"],
    ["工兵", "坦克", "", "炸彈", "", "連長", "工兵"],
    ["工兵", "地雷", "地雷", "炸彈", "", "工兵", ""],
    ["", "地雷", "軍旗", "地雷", "", "", ""],
  ];

  /** 規則說明（依規則組產生） */
  function rulesHtml(V) {
    const R = V.rule;
    const on = (id) => !!R[id];
    const li = (cond, html) => (cond ? `<li>${html}</li>` : "");
    const order = V.types.filter((T) => T.mobile && T.kind !== "bomb").sort((a, b) => b.rank - a.rank);
    const ranks = [];
    for (const T of order) {
      const last = ranks[ranks.length - 1];
      if (last && last[0].rank === T.rank) last.push(T);
      else ranks.push([T]);
    }
    const rankLine = ranks.map((g) => g.map((T) => T.name).join("＝")).join(" ＞ ");
    const army = V.types.map((T) => `${T.name} ${T.count}`).join("、");
    return `
<h3>目標</h3>
<p>奪下對方<b>軍旗</b>即勝。輪到的一方沒有棋可以動則判負（棋全部翻倒時只跳過一回合）。連續 ${V.drawQuiet} 手沒有對撞判和（盤邊有計數軌）。</p>
<h3>盤面</h3>
<ul>
<li>每方 7 欄 × 7 列。三條過河鐵路（左、中、右，中路貫穿到雙方後方鐵路）＋兩座公路橋。</li>
${li(on("forest"), "<b>森林</b>（樹）：走進去的棋翻倒，下一回合不能動；森林裡的棋不能被偵察、雷達揭露、狙擊。")}
${li(on("bunker"), "<b>碉堡</b>（方框）：站在上面的棋防守時等級高一級。炸彈、地雷、軍旗不受影響。")}
${li(on("bridgeBlow"), "<b>可炸毀的橋</b>：炸彈站在橋頭時，可以用一回合炸橋：炸彈消失，該橋永久斷。")}
<li>可以在「地圖」卡片換地圖，或用<b>地圖編輯器</b>自己畫。換了地圖時，這張地圖用到的地形會列在下面的「這張地圖的地形」。</li>
</ul>
<h3>地形一覽（出現在哪裡由地圖決定）</h3>
<ul>
${li(on("swamp"), "<b>沼澤</b>（波浪紋）：走進去翻倒一回合；坦克、炸彈進不去；不能空降；不能鋪鐵路。<i>重裝備會陷住，泥地無法著陸。</i>")}
${li(on("plain"), "<b>平原</b>（點狀紋）：坦克整段走平原（含起點、終點）可走 3 格；目標站在平原上時，偵察範圍 3 格、雷達 2 格。<i>開闊地適合裝甲推進，但也無處躲藏。</i>")}
${li(on("village"), "<b>村莊</b>（小房子）：裡面的棋不會被偵察、雷達揭露；不能空降進去；從村莊出發的棋這一手只能走公路一格。<i>建築遮蔽視線，巷弄出不快。</i>")}
<li><b>高山</b>（山形）：不能進入、不能放棋。<i>天然屏障。</i></li>
${li(on("gauge"), "<b>軌距</b>：標準軌（原樣）、寬軌（雙線，規則和標準軌一樣）、窄軌（細線密枕木：一次最多 3 格，坦克不能上）。兩種軌距相接的格子是<b>換軌站</b>（菱形框）：沿鐵路走到這裡必須停下，下一手才能換另一種軌距。<i>軌距不同，車廂過不去，要換車或換轉向架。</i>")}
</ul>
<h3>棋子（每方 ${V.armySize} 顆）</h3>
<p>${army}</p>
<p>等級：${rankLine}</p>
<ul>
<li><b>坦克</b>：公路上一次走兩格${on("tankTurn") ? "，可以轉一次彎" : "（直線）"}，中間那格要空。${on("tankMine") ? "攻擊地雷時勝。" : "撞地雷同歸於盡。"}</li>
<li><b>傘兵</b>：每顆一生一次空降到對方前三列的空格（行營、大本營除外）${on("aa") ? "，對方防空炮相鄰的格子不行" : ""}。${on("dropStun") ? "落地後翻倒，下一回合不能動。" : ""}</li>
<li><b>偵察</b>：用一回合偵察${on("scout2") ? "公路距離 2 以內" : "相鄰"}的敵棋，被偵察的棋翻成明棋。</li>
<li><b>間諜</b>：主動攻擊司令時勝；其他時候最弱。</li>
${li(on("aa"), "<b>防空炮</b>：相鄰格子對方不能空降；被傘兵攻擊必勝。")}
${li(on("radar"), "<b>雷達站</b>：不能動、不能放第一列。敵棋走到相鄰格子就翻成明棋。被任何棋攻擊都被移除（炸彈仍同歸於盡）。")}
${li(on("sniper"), "<b>狙擊手</b>：平時等級同排長。可以狙擊公路正交方向、距離正好 2 的敵棋（中間要空，行營裡的不行），自己不動。以營長等級比較：目標較小就移除；否則失敗，狙擊手翻成明棋。打炸彈、地雷、軍旗一律失敗。")}
</ul>
<h3>沿用原版</h3>
<ul>
<li>炸彈撞誰都同歸於盡；只有工兵能排雷${on("tankMine") ? "（以及坦克）" : ""}；同級同歸於盡；司令陣亡亮出軍旗（翻成明棋）。</li>
<li>軍旗在大本營、地雷只放最後兩列、炸彈不放第一列、行營開局空著。</li>
<li>鐵路直線走任意格，只有工兵能轉彎；行營裡的棋不能被攻擊；大本營裡的棋不能動。</li>
</ul>
<h3>實體棋盤玩法</h3>
<p>所有狀態都在盤面上：明棋＝正面朝上；翻倒＝橫放；傘兵已空降＝放小標記；斷橋＝放斷橋標記；判和計數＝盤邊計數軌。</p>`;
  }

  /** opts.level：0 或 1 */
  function expandedConfig(opts) {
    const level = opts.level;
    return {
      level,
      cols: 7,
      rows: 7,
      camps: [[1, 1], [5, 1], [2, 2], [4, 2], [1, 3], [5, 3], [2, 4], [4, 4]],
      hqs: [[2, 6], [4, 6]],
      railRows: [0, 5],
      railCols: [0, 3, 6],
      railColEnd: 5,
      railCross: [0, 3, 6],
      roadCross: [1, 5],
      mineRows: 2,
      dropRows: 3,
      drawQuiet: 80,
      snipeRank: 5, // 營長
      commanderRevealsFlag: true,
      boardMode: true, // 揭露＝翻成明棋（實體棋盤相容）
      ruleDefs: RULE_DEFS.filter((d) => d.level <= level),
      forests: [[2, 3], [4, 3]],
      bunkers: level >= 1 ? [[1, 0], [5, 0]] : [],
      pieces: PIECES.filter((p) => !p.rule || RULE_DEFS.find((d) => d.id === p.rule).level <= level),
      aliases: ALIASES,
      defaultLayoutOld: LAYOUT_OLD,
      rulesHtml,
      // 最難覆寫參數時務必保留 smart（否則失去加強判斷）
      aiLevels: {
        hardest: { noise: 1.2, attack: 1.15, danger: 0.24, flag: 1.05, smart: true },
      },
    };
  }

  LZ.expandedConfig = expandedConfig;
})(typeof window !== "undefined" ? window : globalThis);
