/* 擴充版-0：設定都在 shared/expanded-base.js，這裡只決定版本 */
(function (root) {
  "use strict";
  const LZ = root.LZ;
  const cfg = LZ.expandedConfig({ level: 0 });
  cfg.key = "expanded0";
  cfg.title = "陸軍棋 · 擴充版-0";
  // 新兵力的預設佈局＝模擬搜尋到的最強佈局（35 顆）；規則關掉某種新棋時，該棋的格子自動留空
  cfg.defaultLayout = [
    ["工兵","防空炮","營長","","司令","營長","連長"],
    ["偵察","","炸彈","坦克","團長","","傘兵"],
    ["工兵","傘兵","","軍長","","偵察","排長"],
    ["師長","","間諜","團長","炸彈","","旅長"],
    ["工兵","坦克","","旅長","","雷達站","工兵"],
    ["工兵","地雷","地雷","炸彈","","工兵",""],
    ["","地雷","軍旗","地雷","","師長",""],
  ];
  LZ.CONFIG = cfg;
  LZ.VARIANT = LZ.buildVariant(cfg);
})(typeof window !== "undefined" ? window : globalThis);
