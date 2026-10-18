// 面板之间递东西的那一小块。
//
// 只有一件东西在递：**图片的引用**。识图、装订、comfy 都要一张图，
// 而图从图片面板里挑出来。它就是个一格的内存位，重起即空。
//
// 为什么不落盘也不进 URL：引用是"这一次要拿它干什么"的临时选择，
// 不是配置。refresh 一下重新挑就是，不该让一个过期的引用把页面带进坏状态。

let 手上 = null;
const 听众 = new Set();

/**
 * 把一张图交出去。
 * @param {{引用:object, 说明?:string, 缩略?:string}} 东西
 */
export function 交出去(东西) {
  手上 = 东西 || null;
  for (const 说 of 听众) { try { 说(手上); } catch (_) { /* 一个听众出错不影响别人 */ } }
}

/** 现在手上那张图（没有就是 null）。 */
export function 接过来() {
  return 手上;
}

/** 盯着它的变化，交回"摘掉"的函数。 */
export function 盯着(说) {
  听众.add(说);
  return () => 听众.delete(说);
}
