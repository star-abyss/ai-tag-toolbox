// 长任务：与一次 HTTP 请求解耦的那些活（现在只有出图）。
//
// 为什么要有一张表：出图能跑 30 分钟（模块的 上限毫秒 默认就是这个量级），
// 而一条 HTTP 连接可能先断。任务由这里攥着，页面关掉再回来还看得到结果。
//
// 进度只报模块自己报的那种：模块给的是**状态切换**（已提交 / 状态 / 完成），
// 没有百分比。这里不造百分比——造一个假的比不画更坏。
//
// 一次任务的形状：
//   { id, 什么, 开始时间, 状态:'跑着'|'好了'|'失败', 回执?, 错?, 事件:[{ 时间, 内容 }] }
import crypto from 'node:crypto';

/**
 * 造一张任务表。
 * @param {{最多留几条?:number, 做完留多久毫秒?:number}} [选项]
 */
export function 造任务表({ 最多留几条 = 50, 做完留多久毫秒 = 6 * 60 * 60 * 1000 } = {}) {
  /** id → 任务 */
  const 们 = new Map();
  /** id → 订阅者集合（每项是一个 (事件) => void） */
  const 听众 = new Map();

  function 清旧() {
    const 现在 = Date.now();
    const 完的 = [];
    for (const [id, 一] of 们) {
      if (一.状态 !== '跑着' && 现在 - (一.做完时间 || 一.开始时间) > 做完留多久毫秒) 完的.push(id);
    }
    for (const id of 完的) {
      们.delete(id);
      听众.delete(id);
    }
    // 还超量就从头丢（表按开始时间有序）。
    while (们.size > 最多留几条) {
      const 最老 = 们.keys().next().value;
      if (最老 === undefined) break;
      们.delete(最老);
      听众.delete(最老);
    }
  }

  /** 交一个订阅函数：接住这之后每一条事件。 */
  function 订阅(id) {
    return (事件) => {
      const 一 = 们.get(id);
      if (!一) return;
      const 记 = { 时间: Date.now(), 内容: 事件 };
      一.事件.push(记);
      for (const 说 of (听众.get(id) || [])) {
        try { 说(记); } catch (_) { /* 一个听众出错不影响别人 */ }
      }
    };
  }

  /**
   * 起一个任务。`做` 收一个"报事件"的函数，交回执；抛错算失败。
   * @param {{什么:string, 参数?:object, 做:(报:Function) => Promise<any>}} 要的
   * @returns {object} 任务（活的，别改它）
   */
  function 起({ 什么, 参数, 做 }) {
    清旧();
    const id = crypto.randomBytes(8).toString('hex');
    const 一 = {
      id,
      什么: String(什么 || ''),
      参数: 参数 || {},
      开始时间: Date.now(),
      做完时间: 0,
      状态: '跑着',
      回执: undefined,
      错: undefined,
      事件: [],
    };
    们.set(id, 一);
    听众.set(id, new Set());

    const 报 = 订阅(id);
    Promise.resolve()
      .then(() => 做(报))
      .then((回执) => {
        一.状态 = '好了';
        一.回执 = 回执;
        一.做完时间 = Date.now();
        for (const 说 of (听众.get(id) || [])) {
          try { 说({ 时间: Date.now(), 完了: true }); } catch (_) { /* 同上 */ }
        }
      })
      .catch((错) => {
        一.状态 = '失败';
        一.错 = String((错 && 错.message) || 错);
        一.做完时间 = Date.now();
        for (const 说 of (听众.get(id) || [])) {
          try { 说({ 时间: Date.now(), 完了: true }); } catch (_) { /* 同上 */ }
        }
      });

    return 一;
  }

  /** 看一眼。`从` 是"我手上已经有几条事件了"，只补后面的。 */
  function 看(id, 从 = 0) {
    const 一 = 们.get(id);
    if (!一) return { ok: false, reason: `没有这个任务：${id}`, code: 'UI_NO_SUCH_TASK' };
    return {
      ok: true,
      data: {
        id: 一.id,
        什么: 一.什么,
        参数: 一.参数,
        开始时间: 一.开始时间,
        做完时间: 一.做完时间,
        状态: 一.状态,
        回执: 一.回执,
        错: 一.错,
        事件: 一.事件.slice(Math.max(0, Number(从) || 0)),
        共几条事件: 一.事件.length,
      },
    };
  }

  /** 列一下（最近的在前）。 */
  function 列() {
    清旧();
    return [...们.values()]
      .sort((a, b) => b.开始时间 - a.开始时间)
      .map((一) => ({
        id: 一.id, 什么: 一.什么, 状态: 一.状态, 开始时间: 一.开始时间, 做完时间: 一.做完时间,
        几条事件: 一.事件.length, 错: 一.错,
      }));
  }

  /** 挂一个订阅者，交回"摘掉"的函数。 */
  function 挂(id, 说) {
    if (!们.has(id)) return () => {};
    const 集 = 听众.get(id);
    集.add(说);
    return () => 集.delete(说);
  }

  return { 起, 看, 列, 挂 };
}
