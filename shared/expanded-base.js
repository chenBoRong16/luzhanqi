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
    { id: "tankMine", name: "坦克破雷", desc: "坦克攻擊地雷時贏，地雷移除（關掉＝雙方都移除）", level: 0 },
    { id: "dropStun", name: "空降落地翻倒", desc: "傘兵空降落地後翻倒：主人的下一回合不能動它", level: 0 },
    { id: "tankTurn", name: "坦克可轉彎", desc: "坦克連走 2 格時可以轉一次彎（關掉＝只能直線）", level: 0 },
    { id: "scout2", name: "偵察距離 2", desc: "偵察沿公路 2 步以內的敵棋（關掉＝只能偵察相鄰的）", level: 0 },
    { id: "aa", name: "防空炮", desc: "新棋。和它相鄰的格子對方不能空降；被傘兵攻擊時一定贏", level: 0, piece: true },
    { id: "radar", name: "雷達站", desc: "新棋。不能移動；每一手結束時，和它相鄰的敵棋翻成明棋；被攻擊就移除", level: 0, piece: true },
    { id: "forest", name: "森林", desc: "新地形。走到森林的棋翻倒。森林裡的棋不能被偵察，雷達也看不到", level: 0 },
    { id: "bridgeBlow", name: "可炸毀的橋", desc: "炸彈站在任一方的橋頭可以用一手炸橋：炸彈移除，這座橋永久斷掉", level: 0 },
    { id: "gauge", name: "軌距", desc: "換軌站要停下；窄軌一手最多走 3 格、任何棋都能順著窄軌轉彎、坦克不能走（關掉＝所有鐵路都當標準軌）", level: 0 },
    { id: "plain", name: "平原", desc: "坦克在平原上可以連走 3 格（前 2 格要空）。敵棋站在平原上時，偵察從 3 步遠、雷達從 2 步遠就看得到", level: 0 },
    { id: "village", name: "村莊", desc: "村莊裡的棋不能被偵察，雷達也看不到。不能空降。從村莊出發的棋這一手只能沿公路走 1 格", level: 0 },
    { id: "swamp", name: "沼澤", desc: "走到沼澤的棋翻倒。坦克不能進入、不能攻擊沼澤裡的棋，連走時也不能經過。不能空降，不能鋪鐵路", level: 0 },
    { id: "bunker", name: "碉堡", desc: "新地形。站在上面的棋被攻擊時，等級算高一級", level: 1 },
    { id: "sniper", name: "狙擊手", desc: "新棋。用一手狙擊沿公路直走第 2 格的敵棋（第 1 格要空）；目標比營長小就移除", level: 1, piece: true },
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
<h3>勝負</h3>
<ul>
<li>奪下對方<b>軍旗</b>就贏。</li>
<li>輪到自己時沒有任何棋可以走，就輸；如果是因為棋全部翻倒而不能走，就跳過這一回合。</li>
<li>${V.drawQuiet ? `連續 ${V.drawQuiet} 手都沒有棋被吃掉，就和棋（預設值，可以在「設置」裡改或關掉）。攻擊或狙擊命中就從 0 重新算；其他動作都加 1。` : "不判和。"}</li>
</ul>
<h3>盤面</h3>
<ul>
<li>標準地圖每方 7 欄 × 7 列。過河口：左、中、右三條鐵路（中路一直通到雙方後方鐵路），兩座公路橋，其餘是山。</li>
<li>行營裡的棋不能被攻擊；走進大本營的棋之後不能再動。</li>
${li(on("bridgeBlow"), "<b>炸橋</b>：炸彈站在任一方的橋頭時，可以用一手炸橋。炸彈移除，這座橋永久斷掉，這一欄從此不能過河。")}
<li>可以在「地圖」卡片換地圖，或用<b>地圖編輯器</b>自己畫。</li>
</ul>
<h3>翻倒</h3>
<ul>
<li>走到森林${on("swamp") ? "或沼澤" : ""}${on("dropStun") ? "、傘兵空降落地" : ""}時翻倒。</li>
<li>翻倒的棋，在它主人的下一回合不能動，也不能偵察、狙擊、炸橋；那一回合結束時扶正。翻倒的棋照樣可以被攻擊，等級不變。</li>
</ul>
<h3>地形（出現在哪裡由地圖決定）</h3>
<ul>
${li(on("forest"), "<b>森林</b>（樹）：走到森林的棋翻倒。森林裡的棋不能被偵察" + (on("sniper") ? "、狙擊" : "") + "，雷達也看不到。<i>樹林好藏身，但難走。</i>")}
${li(on("swamp"), "<b>沼澤</b>（波浪紋）：走到沼澤的棋翻倒。坦克不能進入，不能攻擊沼澤裡的棋，連走時也不能經過沼澤。不能空降進來，不能鋪鐵路。<i>坦克太重會陷住；泥地無法著陸、鋪軌。</i>")}
${li(on("plain"), "<b>平原</b>（點狀紋）：坦克可以連走 3 格，途中最多轉一次彎，第 3 格可以是空格或敵棋（攻擊）。出發格和這 3 格都要是平原；前 2 格有棋（不論敵我）時，就不能連走 3 格。敵棋站在平原上時，偵察從 3 步遠就能偵察它，雷達在 2 步內就能看到它。<i>開闊地適合裝甲推進，但也無處躲藏。</i>")}
${li(on("village"), "<b>村莊</b>（小房子）：村莊裡的棋不能被偵察" + (on("sniper") ? "、狙擊" : "") + "，雷達也看不到。不能空降進來。從村莊出發的棋，這一手只能沿公路走 1 格：不能走鐵路，坦克不能連走，傘兵不能空降。<i>建築遮蔽視線，巷弄出不快。</i>")}
<li><b>高山</b>（山形）：不能進入，也不能放棋。<i>天然屏障。</i></li>
${li(on("gauge"), "<b>軌距</b>：標準軌和原版鐵路一樣；寬軌（雙線）和標準軌一樣，只是軌距不同；<b>窄軌</b>（細線密枕木）一手最多走 3 格（工兵也一樣），在窄軌上任何棋都可以順著軌道轉彎，坦克不能走窄軌。兩種軌距相接的格子是<b>換軌站</b>（菱形框）：沿鐵路走到這裡就要停下，工兵也一樣，下一手才能從這裡走另一種軌距。<i>軌距不同，車廂過不去，要換車。</i>")}
${li(on("bunker"), "<b>碉堡</b>（城垛方框）：站在上面的棋被攻擊時，等級算高一級；自己去攻擊時不變。司令站在碉堡上，被對方司令攻擊時贏。炸彈、地雷、軍旗、雷達站不受影響。")}
</ul>
<h3>棋子（每方 ${V.armySize} 顆）</h3>
<p>${army}</p>
<p>等級由大到小：${rankLine}。雷達站、炸彈、地雷、軍旗沒有等級。</p>
<ul>
<li><b>坦克</b>：和一般棋一樣走 1 格、攻擊相鄰的棋。另外可以沿公路連走 2 格${on("tankTurn") ? "，途中可以轉一次彎" : "（只能直線）"}，第 2 格可以是空格或敵棋（攻擊）。第 1 格有棋（不論敵我）${on("swamp") || on("forest") ? `，或是${[on("swamp") && "沼澤", on("forest") && "森林"].filter(Boolean).join("、")}` : ""}時，就不能連走 2 格，只能照一般棋走。${on("tankMine") ? "攻擊地雷時贏，地雷移除。" : "攻擊地雷時雙方都移除。"}</li>
<li><b>傘兵</b>：每顆一盤只能空降一次：用一手從任何位置跳到對方前 3 列的空格。不能跳進行營、大本營、高山${on("swamp") ? "、沼澤" : ""}${on("village") ? "、村莊" : ""}${on("aa") ? "，也不能跳到對方防空炮公路相鄰的格子" : ""}。空降不能同時攻擊。落地後翻成明棋${on("dropStun") ? "，並且翻倒" : ""}。</li>
<li><b>偵察</b>：用一手偵察一顆敵棋：從偵察沿公路數 ${on("scout2") ? "2 步" : "1 步"}以內，不管路上有沒有棋。行營裡的可以偵察${on("forest") || on("village") ? `；${[on("forest") && "森林", on("village") && "村莊"].filter(Boolean).join("、")}裡的不行` : ""}；已經確定是什麼的棋不能再偵察。偵察後，被偵察的棋和偵察自己都翻成明棋。</li>
<li><b>工兵</b>：攻擊地雷時贏，地雷移除。在鐵路上可以轉彎。</li>
<li><b>間諜</b>：等級最小。主動攻擊司令時贏；被司令攻擊時照樣輸。</li>
${li(on("aa"), "<b>防空炮</b>：和它公路相鄰的格子，對方不能空降進來。被傘兵攻擊時一定贏。")}
${li(on("radar"), "<b>雷達站</b>：不能移動，不能放第 1 列。每一手結束時，和它公路相鄰的敵棋都翻成明棋" + (on("forest") || on("village") ? "（森林、村莊裡的除外）" : "") + "。被任何棋攻擊時雷達站移除，攻擊方移到那一格；炸彈攻擊時雙方都移除。")}
${li(on("sniper"), "<b>狙擊手</b>：移動、攻擊、被攻擊時，等級和排長相同。可以用一手狙擊沿公路直走（不能斜走）第 2 格的敵棋，自己不動；第 1 格有棋（不論敵我）時射線被擋住，不能狙擊；行營、森林、村莊裡的棋不能當目標。拿目標和營長比：目標比營長小就移除；不比營長小，或是炸彈、地雷、軍旗，就失敗，目標不動。不論成功或失敗，狙擊手都翻成明棋，失敗時也不會陣亡。")}
<li><b>炸彈</b>：攻擊別人或被攻擊時，雙方都移除。</li>
<li><b>地雷</b>：不能移動。工兵${on("tankMine") ? "、坦克" : ""}攻擊時地雷移除；炸彈攻擊時雙方都移除；其他棋攻擊時攻擊方移除，地雷留著。</li>
<li><b>軍旗</b>：不能移動，被攻擊就輸了這盤。<b>司令</b>陣亡後，自己的軍旗翻成明棋。</li>
</ul>
<h3>佈陣</h3>
<ul>
<li>軍旗放在大本營；地雷只能放最後兩列；炸彈${on("radar") ? "、雷達站" : ""}不能放第 1 列；行營開局必須空著；高山不能放棋${on("swamp") ? "；沼澤不能放坦克、地雷、軍旗、雷達站" : ""}。</li>
</ul>
<h3>攻擊的結果</h3>
<p>和原版一樣：攻擊方贏就移到那一格；輸就移除；同級雙方都移除。撞棋時只知道勝負，不知道對方是什麼棋（明棋除外）。</p>
<h3>實體棋盤玩法</h3>
<p>所有狀態都放在盤面上：明棋＝正面朝上；翻倒＝橫放；傘兵已空降＝旁邊放小標記；斷橋＝放斷橋標記；判和計數＝盤邊計數軌（每一手加 1，攻擊或狙擊命中歸零）。</p>`;
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
