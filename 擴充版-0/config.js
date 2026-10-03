/* 擴充版-0：設定都在 shared/expanded-base.js，這裡只決定版本 */
(function (root) {
  "use strict";
  const LZ = root.LZ;
  const cfg = LZ.expandedConfig({ level: 0 });
  cfg.key = "expanded0";
  cfg.title = "陸軍棋 · 擴充版-0";
  // 新兵力的預設佈局＝模擬搜尋到的最強佈局（35 顆）；規則關掉某種新棋時，該棋的格子自動留空
  cfg.defaultLayout = [
    ["團長","旅長","","","偵察","師長","排長"],
    ["旅長","","營長","傘兵","間諜","","坦克"],
    ["偵察","司令","","炸彈","","坦克","師長"],
    ["炸彈","","團長","傘兵","雷達站","","軍長"],
    ["工兵","炸彈","","營長","","","工兵"],
    ["地雷","","工兵","防空炮","地雷","","工兵"],
    ["工兵","連長","","地雷","軍旗","地雷","工兵"],
  ];
  LZ.CONFIG = cfg;
  LZ.VARIANT = LZ.buildVariant(cfg);
})(typeof window !== "undefined" ? window : globalThis);
