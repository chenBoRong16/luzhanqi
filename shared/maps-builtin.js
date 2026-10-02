/* 內建範例地圖：由基礎地圖＋區域筆刷以固定種子產生（每次載入都一樣）。
 * 寫成 JS 而不是 JSON，雙擊 index.html（file://）也讀得到。 */
(function (root) {
  "use strict";
  const LZ = root.LZ;

  /** 兩方都套用同一個筆刷（先刷我方再鏡像） */
  function both(map, rect, kind, seed) {
    return LZ.mirrorMap(LZ.applyBrush(map, 0, rect, kind, seed));
  }

  /** 每條軌道依位置換軌距：我方 a、對方 b、過河那一段 c */
  function regauge(map, a, b, c) {
    const out = [];
    for (const seg of map.rails) {
      for (let i = 1; i < seg.path.length; i++) {
        const p = seg.path[i - 1], q = seg.path[i];
        const g = p[0] !== q[0] ? c : p[0] === 0 ? a : b;
        out.push({ gauge: g, path: [p, q] });
      }
    }
    map.rails = out;
    return map;
  }

  /** level：0 或 1（擴充版-1 才有碉堡）；variant：版本鍵 */
  function builtinMaps(level, variant) {
    const base = (cols, rows, name) => LZ.baseMap(cols, rows, { level, name, variant });
    const maps = [];

    maps.push(Object.assign(base(7, 7, "標準"), { desc: "原本的盤面" }));

    {
      // 兩國換軌：對國的後方鐵路是寬軌，過河的幹線是國際直通的標準軌。
      // 模擬顯示：換軌站放在主要進攻路線上（對方前線、過河線）會讓進攻停擺、和棋過多，
      // 所以只在對方後方換軌（遊戲性優先，見規格 D10）
      const m = base(7, 7, "兩國換軌");
      const out = [];
      for (const seg of m.rails) for (let i = 1; i < seg.path.length; i++) {
        const p = seg.path[i - 1], q = seg.path[i];
        const wide = p[0] === 1 && q[0] === 1 && p[2] === m.rows - 2 && q[2] === m.rows - 2;
        out.push({ gauge: wide ? "wide" : "std", path: [p, q] });
      }
      m.rails = out;
      m.mirror = false;
      m.desc = "對國後方是寬軌：幹線直通，但要沿對方後方鐵路橫移時，會在換軌站停一次（不對稱：只差在軌距）";
      maps.push(m);
    }

    {
      // 偏遠平原鄉村：比較寬（9 欄）；前中段是平原、路網稀疏、只剩窄軌；後段散布村莊
      let m = base(9, 7, "偏遠平原");
      m = both(m, { c0: 0, r0: 1, c1: 8, r1: 4 }, "plain", 11);
      m = both(m, { c0: 0, r0: 4, c1: 2, r1: 5 }, "village", 12);
      m = both(m, { c0: 6, r0: 4, c1: 8, r1: 5 }, "village", 13);
      m.music = "plain";
      m.desc = "寬闊平原，坦克好跑但無處躲；後方是鄉村";
      maps.push(m);
    }

    {
      // 沼澤森林：左翼沼澤、右翼森林
      let m = base(7, 7, "沼澤森林");
      m = both(m, { c0: 0, r0: 1, c1: 2, r1: 3 }, "swamp", 21);
      m = both(m, { c0: 4, r0: 1, c1: 6, r1: 4 }, "forest", 22);
      m.music = "swamp";
      m.desc = "左翼沼澤擋住坦克與空降，右翼森林適合埋伏";
      maps.push(m);
    }

    {
      // 山地：深一點（8 列）；中段散布高山，鐵路改窄軌
      let m = base(7, 8, "山地");
      m = both(m, { c0: 1, r0: 1, c1: 5, r1: 4 }, "mountain", 31);
      m.music = "mountain";
      m.desc = "高山切開戰線，只剩幾條山口；山區鐵路是窄軌";
      maps.push(m);
    }
    return maps;
  }

  LZ.builtinMaps = builtinMaps;
})(typeof window !== "undefined" ? window : globalThis);
