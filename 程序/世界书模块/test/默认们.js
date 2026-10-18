'use strict';
/*
 * 三份最小的只读默认 —— test/run.js 与 tools/ 共用这一份。
 *
 * 键就是书的名字（也是文件名去掉 .json 那一段）。
 * 只给内存适配器用；文件适配器读的是 assets/世界书 下的真文件。
 */

function 默认们() {
  return {
    翻译: {
      name: '翻译',
      entries: [
        { id: 'e1', label: '常驻', text: '翻译常驻段', always: true, keys: [], enabled: true, 落点: '前' },
        { id: 'e2', label: '中文', text: '中文方向段', always: false, keys: ['中文', 'zh'], enabled: true, 落点: '前' },
        { id: 'e3', label: '关掉的', text: '不该出现', always: true, keys: [], enabled: false, 落点: '前' },
      ],
    },
    识图: {
      name: '识图',
      entries: [
        { id: 'e1', label: '常驻', text: '识图常驻段', always: true, keys: [], enabled: true, 落点: '前' },
      ],
    },
    文生图: {
      name: '文生图',
      entries: [
        { id: 'e1', label: '常驻', text: '文生图常驻段', always: true, keys: [], enabled: true, 落点: '前' },
        { id: 'e2', label: '按深度', text: '深度段', always: true, keys: [], enabled: true, 落点: '按深度', 深度: 2, 角色: '系统' },
      ],
    },
  };
}

module.exports = { 默认们 };
