/* 擴充版-1：設定都在 shared/expanded-base.js，這裡只決定版本 */
(function (root) {
  "use strict";
  const LZ = root.LZ;
  const cfg = LZ.expandedConfig({ level: 1 });
  cfg.key = "expanded1";
  cfg.title = "陸軍棋 · 擴充版-1";
  // 新兵力的預設佈局＝模擬搜尋到的最強佈局（36 顆）；規則關掉某種新棋時，該棋的格子自動留空
  cfg.defaultLayout = [
    ["營長","排長","狙擊手","工兵","工兵","連長","團長"],
    ["旅長","","防空炮","師長","營長","","坦克"],
    ["司令","團長","","軍長","","傘兵","師長"],
    ["炸彈","","炸彈","","雷達站","","炸彈"],
    ["偵察","傘兵","","旅長","","",""],
    ["","間諜","地雷","工兵","地雷","坦克","偵察"],
    ["工兵","地雷","軍旗","地雷","","工兵","工兵"],
  ];
  LZ.CONFIG = cfg;
  LZ.VARIANT = LZ.buildVariant(cfg);
})(typeof window !== "undefined" ? window : globalThis);
