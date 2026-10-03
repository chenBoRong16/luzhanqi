/* 擴充版共用定義：盤面、棋子、規則表、地形。
 * level 0（擴充版-0）：規則保持簡單，沒有「等效等級」類規則。
 * level 1（擴充版-1）：再加上狙擊手（以營長等級比較）。
 * 兩版都必須能做成實體棋盤遊戲：規則狀態只能是位置、明棋、翻倒、已空降、斷橋、判和計數。 */
(function (root) {
  "use strict";
  const LZ = root.LZ;

  /**
   * 規則表。level：最低需要的版本；group：介面分組（新棋、地形、機制）；
   * def：沒指定時的預設值（沒寫＝開）；hidden：不顯示在規則開關（只給舊棋譜重播用）。
   */
  const RULE_DEFS = [
    { id: "v3", name: "大翻新後的規則", desc: "關掉＝大翻新前的舊規則（舊等級表、碉堡加一級、坦克破雷、防空炮與雷達站特例、大本營不能動）。用來看舊棋譜", level: 0, group: "機制" },
    { id: "newArmy", name: "新兵力（防空炮、雷達站等新棋）", desc: "關掉＝舊兵力 35 顆：連長、排長各 3，沒有新棋。用來讀改版前的佈局檔", level: 0, group: "新棋" },
    { id: "aa", name: "防空炮", desc: "新棋（連長級）。對方傘兵落在它看得到的格子（距離 1，落點在平原時 2）時被擊落，防空炮翻成明棋", level: 0, piece: true, group: "新棋" },
    { id: "radar", name: "雷達站", desc: "新棋（等級最小、不能移動）。每一手結束時，看得到的敵棋（距離 1，目標在平原時 2）翻成明棋", level: 0, piece: true, group: "新棋" },
    { id: "sniper", name: "狙擊手", desc: "新棋（排長級）。用一手狙擊沿公路直走第 2 格的敵棋（第 1 格要空）；目標比營長小就移除", level: 1, piece: true, group: "新棋" },
    { id: "forest", name: "森林", desc: "走到森林的棋翻倒。森林裡的棋看不到（不能被偵察、狙擊，雷達看不到）", level: 0, group: "地形" },
    { id: "swamp", name: "沼澤", desc: "走到沼澤的棋翻倒。坦克不能進入、不能攻擊沼澤裡的棋，衝刺時也不能經過。開局不能放棋，不能空降，不能鋪鐵路", level: 0, group: "地形" },
    { id: "plain", name: "平原", desc: "坦克整段在平原上可以衝刺 3 格。站在平原上的棋比較容易被看到：偵察、雷達的距離多 1", level: 0, group: "地形" },
    { id: "village", name: "村莊", desc: "村莊裡的棋看不到。不能空降。從村莊出發的棋這一手只能沿公路走 1 格", level: 0, group: "地形" },
    { id: "bunker", name: "碉堡", desc: "防護格：裡面的棋不能被攻擊（和行營一樣），開局可以放棋（擴充版-1 開了地形防守加成時改為守方 +2）", level: 0, group: "地形" },
    { id: "terrainDef", name: "地形防守加成", desc: "守方等級加上所在格子的防守值：森林、村莊、行營 +1，碉堡 +2，沼澤 −1（行營、碉堡被爆破後 0）。開著時行營、碉堡不再「打不到」，改用加成", level: 1, group: "地形" },
    { id: "gauge", name: "軌距", desc: "換軌站要停下；窄軌一手最多走 3 格、任何棋都能順著窄軌轉彎、坦克不能走（關掉＝所有鐵路都當標準軌）", level: 0, group: "地形" },
    { id: "blast", name: "防護格可以被爆破", desc: "工兵可以用一手爆破相鄰的行營、碉堡（裡面不能有自己的棋）：這格失去防護（擴充版-1：失去加成），工兵翻成明棋", level: 0, group: "機制" },
    { id: "hqExit", name: "棋可以走出大本營", desc: "任何棋都能走出大本營；走進對方大本營的棋翻成明棋（關掉＝進了大本營不能再動）", level: 0, group: "機制" },
    { id: "tankTurn", name: "坦克衝刺可轉彎", desc: "坦克衝刺時可以轉一次彎（關掉＝只能直線）", level: 0, group: "機制" },
    { id: "scout2", name: "偵察距離 2", desc: "偵察沿公路 2 步以內的敵棋（關掉＝只能偵察相鄰的）", level: 0, group: "機制" },
    { id: "dropStun", name: "空降落地翻倒", desc: "傘兵空降落地後翻倒：主人的下一回合不能動它", level: 0, group: "機制" },
    { id: "bridgeBlow", name: "可炸毀的橋", desc: "炸彈站在任一方的橋頭可以用一手炸橋：炸彈移除，這座橋永久斷掉", level: 0, group: "機制" },
    { id: "blastAny", name: "任何半場都能爆破", desc: "關掉＝舊規則：只能爆破對方半場的防護格", level: 0, def: true, hidden: true },
    { id: "aaSight", name: "防空炮用視線", desc: "關掉＝舊規則：只擊落公路相鄰的傘兵", level: 0, def: true, hidden: true },
    { id: "blastFar", name: "遠距爆破（舊規則）", desc: "舊棋譜用：工兵沿鐵路走得到的防護格都能爆破", level: 0, def: false, hidden: true },
    { id: "tankMine", name: "坦克破雷（舊規則）", desc: "舊棋譜用：坦克攻擊地雷時贏", level: 0, def: false, hidden: true },
  ];

  const PIECES = [
    { name: "司令", short: "司", kind: "commander", rank: 10, count: 1, value: 100 },
    { name: "軍長", short: "軍", kind: "normal", rank: 9, count: 1, value: 75 },
    { name: "坦克", short: "坦", kind: "tank", rank: 9, rankOld: 8.5, count: 2, value: 60 },
    { name: "師長", short: "師", kind: "normal", rank: 8, count: 2, value: 50 },
    { name: "旅長", short: "旅", kind: "normal", rank: 7, count: 2, value: 35 },
    { name: "團長", short: "團", kind: "normal", rank: 6, count: 2, value: 25 },
    { name: "營長", short: "營", kind: "normal", rank: 5, count: 2, value: 18 },
    { name: "防空炮", short: "防", kind: "aa", rank: 4, rankOld: 4.5, count: 1, value: 22, rule: "aa" },
    { name: "連長", short: "連", kind: "normal", rank: 4, count: 1, countPreV3: 2, countOld: 3, value: 12 },
    { name: "排長", short: "排", kind: "normal", rank: 3, count: 1, countPreV3: 2, countOld: 3, value: 8 },
    { name: "狙擊手", short: "狙", kind: "sniper", rank: 3, count: 1, value: 20, rule: "sniper" },
    { name: "傘兵", short: "傘", kind: "para", rank: 3, rankOld: 2.5, count: 2, value: 14 },
    { name: "偵察兵", short: "偵", kind: "scout", rank: 1, rankOld: 1.5, count: 2, value: 14 },
    { name: "工兵", short: "工", kind: "engineer", rank: 1, count: 6, countPreV3: 4, countOld: 4, value: 16 },
    { name: "間諜", short: "諜", kind: "spy", rank: 0.5, count: 1, value: 30 },
    { name: "雷達站", short: "達", kind: "radar", rank: 0.2, rankOld: 0, count: 1, value: 20, rule: "radar" },
    { name: "炸彈", short: "炸", kind: "bomb", rank: 0, count: 3, value: 40 },
    { name: "地雷", short: "雷", kind: "mine", rank: 0, count: 4, value: 12 },
    { name: "軍旗", short: "旗", kind: "flag", rank: 0, count: 1, value: 1000 },
  ];

  const ALIASES = {
    军长: "軍長", 师长: "師長", 旅长: "旅長", 团长: "團長", 营长: "營長",
    连长: "連長", 排长: "排長", 炸弹: "炸彈", 军旗: "軍旗",
    伞兵: "傘兵", 侦察: "偵察兵", 偵察: "偵察兵", 侦察兵: "偵察兵", 间谍: "間諜",
    防空炮: "防空炮", 狙击手: "狙擊手", 雷达站: "雷達站", 雷达: "雷達站", 雷達: "雷達站",
  };

  // 舊兵力（35 顆）的預設佈局：改版前的「中路鐵壁」
  const LAYOUT_OLD = [
    ["連長", "排長", "營長", "師長", "團長", "排長", "連長"],
    ["偵察兵", "", "旅長", "坦克", "團長", "", "傘兵"],
    ["營長", "傘兵", "", "軍長", "", "偵察兵", "排長"],
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
<p>規則分成六部分：移動、攻擊、視線、防護、翻倒、開局。地形只寫它屬於哪幾部分。</p>
<h3>勝負</h3>
<ul>
<li>奪下對方<b>軍旗</b>就贏。輪到自己時沒有任何棋可以走就輸；棋全部翻倒而不能走時，跳過這一回合。</li>
<li>${V.drawQuiet ? `連續 ${V.drawQuiet} 手都沒有棋被吃掉就和棋（可在「設置」改或關掉）。攻擊或狙擊命中時歸零，其他動作都加 1。` : "不判和。"}</li>
</ul>
<h3>1. 移動</h3>
<ul>
<li><b>公路</b>：走 1 格；行營和四周八格可以斜走。</li>
<li><b>鐵路</b>：沿同一條鐵路直線走，格數不限；遇到第一顆棋就停，是敵棋可以攻擊。工兵可以在交叉口轉彎。</li>
${li(on("gauge"), "<b>軌距</b>：標準軌、寬軌照鐵路規則；<b>窄軌</b>一手最多走 3 格，任何棋都能順著窄軌轉彎，坦克不能走。兩種軌距相接的<b>換軌站</b>：沿鐵路走到這裡就停，工兵也一樣。")}
<li><b>坦克衝刺</b>：沿公路連走 2 格${on("tankTurn") ? "，可以轉一次彎" : "（只能直線）"}${on("plain") ? "；整段都在平原上時最多 3 格" : ""}。經過的格子要空${on("swamp") || on("forest") ? `，而且不能是${[on("swamp") && "沼澤", on("forest") && "森林"].filter(Boolean).join("、")}` : ""}；最後一格可以是敵棋（攻擊）。</li>
<li><b>空降</b>：每顆傘兵一盤一次，用一手跳到對方前 3 列的空格；落點只能是一般格或平原${on("aa") ? "；落點在對方防空炮看得到的地方（距離 1，落點在平原時 2）會被擊落（防空炮翻成明棋）" : ""}。空降時不能攻擊；落地後翻成明棋${on("dropStun") ? "並翻倒" : ""}。</li>
${li(on("village"), "<b>從村莊出發</b>：這一手只能沿公路走 1 格（不能走鐵路、衝刺、空降）。")}
${li(on("hqExit"), "<b>大本營</b>：任何棋都可以走出大本營；走進對方大本營的棋翻成明棋。")}
${li(!on("hqExit"), "<b>大本營</b>：走進大本營的棋之後不能再動。")}
<li><b>不能進入</b>：高山${on("swamp") ? "；坦克不能進入沼澤" : ""}。</li>
${li(on("bridgeBlow"), "<b>炸橋</b>：炸彈站在任一方的橋頭時，可以用一手炸橋；炸彈移除，這一欄從此不能過河。")}
</ul>
<h3>2. 攻擊</h3>
<p>等級由大到小：${rankLine}。炸彈、地雷、軍旗沒有等級。</p>
<ol>
<li>被攻擊的是軍旗：攻擊方贏得這盤。</li>
<li>任一方是<b>炸彈</b>：雙方都移除。</li>
<li>被攻擊的是<b>地雷</b>：工兵攻擊時地雷移除；其他棋（含坦克）攻擊時，攻擊方移除，地雷留著。</li>
<li><b>間諜</b>主動攻擊司令：間諜贏。</li>
<li>其餘比等級：大的贏並移過去；小的移除；同級雙方都移除。</li>
</ol>
<p>司令陣亡時，自己的軍旗翻成明棋。撞棋時只知道勝負，不知道對方是什麼棋（明棋除外）。</p>
<h3>3. 視線</h3>
<ul>
<li><b>看得到</b>：沿公路數到目標的步數在距離以內（不管路上有沒有棋），而且目標不在${[on("forest") && "森林", on("village") && "村莊"].filter(Boolean).join("、") || "隱蔽格"}裡。${on("plain") ? "目標站在<b>平原</b>上時，距離多 1。" : ""}</li>
<li><b>偵察</b>：用一手偵察一顆看得到的敵棋，距離 ${on("scout2") ? 2 : 1}；已經確定是什麼的棋不能再偵察。偵察後，被偵察的棋和偵察自己都翻成明棋。</li>
${li(on("radar"), "<b>雷達站</b>：每一手結束時，看得到的敵棋都翻成明棋，距離 1。")}
${li(on("sniper"), "<b>狙擊</b>：狙擊手用一手狙擊沿公路直走第 2 格的敵棋，自己不動；第 1 格有棋時射線被擋住；隱蔽格、防護格裡的棋不能狙擊。目標比營長小就移除；否則失敗，目標不動（炸彈、地雷、軍旗狙擊不了）。狙擊手不論成敗都翻成明棋。")}
</ul>
<h3>4. 防護</h3>
<ul>
${on("terrainDef") ? `<li><b>地形防守加成</b>：被攻擊、被狙擊時，守方等級加上所在格子的防守值：森林、村莊、行營 +1，碉堡 +2，沼澤 −1，其他 0。行營、碉堡被爆破後變 0。只用在比等級：炸彈、地雷、軍旗、間諜刺殺司令照舊。行營、碉堡裡的棋打得到，只是比較難打。</li>` : `<li><b>防護格</b>：行營${on("bunker") ? "、碉堡" : ""}。裡面的棋不能被攻擊，炸彈、坦克也不行。</li>`}
${li(on("blast"), "<b>爆破</b>：工兵可以用一手爆破防護格，空的也可以，哪一方半場都行，只要裡面沒有自己的棋（所以也不能炸自己站的格子）。工兵站在原地爆破，不用走進去，但只能炸<b>相鄰</b>的格子：公路相鄰一格（行營可走斜線），或鐵路上相鄰一格。要炸遠處的，得先走過去。結果：這格永久失去防護、變成一般格；工兵翻成明棋；裡面的棋不動、不受傷，下一手才能攻擊它。點有對方棋的防護格＝爆破（打不到）；點空的防護格＝選「移動」或「爆破」。")}
${li(on("bunker"), "<b>行營和碉堡</b>：行營開局必須空著、可以斜走；碉堡開局可以放棋，守在要道（例如橋頭）。炸彈站在碉堡上照樣可以炸橋。")}
</ul>
<h3>5. 翻倒</h3>
<p>走到森林${on("swamp") ? "、沼澤" : ""}${on("dropStun") ? "、傘兵空降落地" : ""}時翻倒。翻倒的棋在它主人的下一回合不能做任何動作，那一回合結束時扶正；翻倒時照樣可以被攻擊。</p>
<h3>6. 開局</h3>
<ul>
<li>不能放棋的格子：行營${on("swamp") ? "、沼澤" : ""}、高山。</li>
<li>軍旗放在大本營；地雷只能放最後兩列；炸彈${on("radar") ? "、雷達站" : ""}不能放第 1 列。</li>
</ul>
<h3>棋子（每方 ${V.armySize} 顆）</h3>
<p>${army}</p>
<h3>實體棋盤玩法</h3>
<p>所有狀態都放在盤面上：明棋＝正面朝上；翻倒＝橫放；傘兵已空降＝旁邊放小標記；斷橋＝放斷橋標記；已炸毀的防護格＝放「已炸毀」標記；判和計數＝盤邊計數軌（每一手加 1，攻擊或狙擊命中歸零）。</p>`;
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
      bunkers: [[1, 0], [5, 0]],
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
