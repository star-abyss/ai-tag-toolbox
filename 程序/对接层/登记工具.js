import { 工具声明 } from './工具定义.js';

/** 把业务失败回执转成保留原字段的 Error。 */
function 失败错误(回) {
  const 错 = new Error(String(回.reason || 回.message || 回.code || '业务执行失败'));
  for (const [键, 值] of Object.entries(回)) {
    if (键 !== 'ok') 错[键] = 值;
  }
  错.业务回执 = 回;
  return 错;
}

/**
 * 将一个业务能力的声明与执行器登记进 DSH。
 * @param {{ctx:object,业务:{工具表:Array,执行:(name:string,args:object,context?:object)=>Promise<object>},处理回执:Function,上下文?:object}} 参数
 * @param {object} 参数.上下文 DSH 未提供 execute context 时使用的已注入上下文
 * @returns {Array<{名字:string,定义:object,卸下:Function}>}
 */
export function 登记工具({ ctx, 业务, 处理回执, 上下文 = {} }) {
  if (!ctx?.tools || typeof ctx.tools.register !== 'function') throw new Error('ctx.tools.register 必须是函数');
  if (!业务 || !Array.isArray(业务.工具表) || typeof 业务.执行 !== 'function') throw new Error('业务必须提供工具表与执行');
  if (typeof 处理回执 !== 'function') throw new Error('处理回执 必须是函数');

  return 业务.工具表.map((条目) => {
    const 声明 = 工具声明(条目);
    const 名字 = 声明.name;
    const 名称检查 = 业务.工具表.filter((行) => 行?.名字 === 名字).length;
    if (!名字 || 名称检查 !== 1) throw new Error('业务工具名字必须唯一且非空');

    const 定义 = {
      ...声明,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_参数, 值) => [{ type: 'text', text: JSON.stringify(值 === undefined ? null : 值, null, 2) }],
      },
      execute: async (参数, 运行上下文) => {
        const 业务上下文 = 运行上下文 ?? 上下文;
        const 回 = await 业务.执行(名字, 参数 || {}, 业务上下文);
        if (回?.ok === false) throw 失败错误(回);
        const 数据 = 回?.ok === true && Object.hasOwn(回, 'data') ? 回.data : 回 === undefined ? null : 回;
        return await 处理回执(数据, { name: 名字, parameters: 参数 || {}, context: 上下文 });
      },
    };

    return { 名字, 定义, 卸下: ctx.tools.register(定义) };
  });
}
