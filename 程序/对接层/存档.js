// 存档：一个小文件的读写（整份读进来、整份写回去）。
//
// 给需要"存一份东西在盘上"的模块用：comfyUI 模块的 `存档` 就是它。
//   const 存档 = 造文件存档(绝对路径)
//   存档.读() → 值 或 null    读不到、读不懂都给 null
//   存档.写(值) → true        写不进去给 false
//   存档.清() → true          本来就没有也算清掉了

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} 文件 绝对路径
 * @returns {{读:Function, 写:Function, 清:Function}}
 */
export function 造文件存档(文件) {
  const 位置 = path.resolve(文件);

  function 读() {
    try {
      const 文 = fs.readFileSync(位置, 'utf8');
      const 值 = JSON.parse(文);
      return 值 === undefined ? null : 值;
    } catch (_) {
      return null;
    }
  }

  function 写(值) {
    try {
      fs.mkdirSync(path.dirname(位置), { recursive: true });
      fs.writeFileSync(位置, JSON.stringify(值, null, 2), 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  function 清() {
    try {
      fs.rmSync(位置, { force: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  return { 读, 写, 清, 位置 };
}
