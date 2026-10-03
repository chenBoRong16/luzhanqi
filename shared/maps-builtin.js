/* 內建範例地圖：全部手工設計（每一格都是刻意放的），雙方鏡像。
 * 寫成 JS 而不是 JSON，雙擊 index.html（file://）也讀得到。
 * 設計原則（規格 4.1）：每張一個主題、至少三條進攻路線、碉堡守要道、行營當中繼站。 */
(function (root) {
  "use strict";
  const LZ = root.LZ;

  /**
   * 手工地圖：rows＝每列一行字串（第 0 列是前線；一個字一格，代碼見 map.js 的 TERRAIN），雙方鏡像。
   * railRows：橫向鐵路的列；railCols：縱向鐵路的欄（從最後一條橫向鐵路接到前線，過河口是 R 時接到對方）；
   * narrow：哪些欄的縱向鐵路是窄軌；crossings：每欄過河口（R 鐵路、B 公路橋、M 山）。
   * 鐵路遇到高山、沼澤自動斷開。
   */
  function hand(o) {
    const cells = o.rows.slice();
    const rows = cells.length, cols = [...cells[0]].length;
    const at = (c, r) => [...cells[r]][c];
    const blocked = (c, r) => at(c, r) === "山" || at(c, r) === "沼";
    const rails = [];
    const edge = (a, b, gauge) => rails.push({ gauge, path: [a, b] });
    const last = Math.max(...o.railRows);
    for (let s = 0; s < 2; s++) {
      for (const r of o.railRows) {
        for (let c = 1; c < cols; c++) if (!blocked(c - 1, r) && !blocked(c, r)) edge([s, c - 1, r], [s, c, r], "std");
      }
      for (const c of o.railCols) {
        const g = (o.narrow || []).includes(c) ? "narrow" : "std";
        for (let r = 1; r <= last; r++) if (!blocked(c, r - 1) && !blocked(c, r)) edge([s, c, r], [s, c, r - 1], g);
      }
    }
    const crossings = [...o.crossings].map((k) => ({ R: "rail", B: "bridge", M: "mountain" }[k]));
    crossings.forEach((k, c) => { if (k === "rail") edge([0, c, 0], [1, c, 0], "std"); });
    return {
      format: LZ.MAP_FORMAT, version: 1, name: o.name, variant: o.variant || "",
      cols, rows, mirror: true, music: o.music || "default", desc: o.desc || "",
      cells: [cells, cells.slice()], roadsRemoved: [], rails, crossings,
    };
  }

  /** 標準地圖（擴充版預設）：左路森林、右路平原、中路鐵路；橋頭碉堡 */
  function standardMap(variant) {
    return hand({
      name: "標準", variant,
      desc: "左路森林好藏、右路平原好衝、中路鐵路最快；兩座公路橋的橋頭有碉堡",
      rows: [
        ".堡...堡.",
        ".營林.原營.",
        ".林營.營原.",
        ".營林.原營.",
        "..營.營村.",
        ".......",
        "..本.本..",
      ],
      railRows: [0, 5], railCols: [0, 3, 6], crossings: "RBMRMBR",
    });
  }

  /** variant：版本鍵；level 保留參數（碉堡兩版都有） */
  function builtinMaps(level, variant) {
    const maps = [];
    maps.push(standardMap(variant));

    {
      // 兩國換軌：和標準地圖同樣的地形；對國的後方鐵路是寬軌。
      // 換軌站只在對方後方（放在主要進攻路線上會讓進攻停擺、和棋過多）
      const m = standardMap(variant);
      m.name = "兩國換軌";
      m.rails = m.rails.map((seg) => {
        const [p, q] = seg.path;
        const wide = p[0] === 1 && q[0] === 1 && p[2] === m.rows - 2 && q[2] === m.rows - 2;
        return wide ? { gauge: "wide", path: seg.path } : seg;
      });
      m.mirror = false;
      m.desc = "對國後方是寬軌：幹線直通，但要沿對方後方鐵路橫移時，會在換軌站停一次（不對稱：只差在軌距）";
      maps.push(m);
    }

    maps.push(hand({
      // 偏遠平原：中間三欄是連續的平原走廊（坦克衝刺 3 格的舞台），後方兩角是村莊
      name: "偏遠平原", variant, music: "plain",
      desc: "中間是寬闊的平原走廊，坦克好衝但無處躲；後方兩角是鄉村",
      rows: [
        ".堡.....堡.",
        "原營原原原原原營原",
        "原原營原原原營原原",
        "原營原原原原原營原",
        "村村營原原原營村村",
        ".........",
        "...本.本...",
      ],
      railRows: [0, 5], railCols: [0, 4, 8], crossings: "RBMMRMMBR",
    }));

    maps.push(hand({
      // 沼澤森林：左翼沼澤擋坦克（小棋好守），右翼森林好埋伏，中路鐵路暢通
      name: "沼澤森林", variant, music: "swamp",
      desc: "左翼沼澤擋住坦克與空降，右翼森林適合埋伏；中路鐵路暢通",
      rows: [
        ".堡...堡.",
        ".營..林營.",
        ".沼營.營林.",
        ".營沼.林營.",
        ".沼營.營林.",
        ".......",
        "..本.本..",
      ],
      railRows: [0, 5], railCols: [0, 3, 6], crossings: "RBMRMBR",
    }));

    maps.push(hand({
      // 山地：高山把戰線切成三條路；中路的山區鐵路是窄軌（一手最多 3 格、坦克不能走），兩翼是標準軌
      name: "山地", variant, music: "mountain",
      desc: "防守型地圖：高山把戰線切成三條路，中路是穿過山區的窄軌、兩翼是標準軌。先攻比較吃虧，和棋也較多",
      rows: [
        ".堡...堡.",
        ".營山.山營.",
        "..營.營..",
        ".營山.山營.",
        "..營.營..",
        ".營...營.",
        ".......",
        "..本.本..",
      ],
      railRows: [0, 6], railCols: [0, 3, 6], narrow: [3], crossings: "RBMRMBR",
    }));
    return maps;
  }

  LZ.builtinMaps = builtinMaps;
  LZ.standardMap = standardMap;
  LZ.handMap = hand;
})(typeof window !== "undefined" ? window : globalThis);
