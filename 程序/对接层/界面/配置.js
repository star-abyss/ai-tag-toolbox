// 界面层的入口共用件：项目根 · 令牌怎么注进页面。
//
// 令牌必须是**同步注进去的**：页面第一行就要读 `window.__令牌__`，晚一步它拿到的是
// undefined，第一次请求就被 403 打回。所以这里读的是带 BOM 与不带 BOM 两种 UTF-8。
// 注入用的标记是页面里那一句 `window.__令牌__ = /*令牌*/null;` 中间那段注释——
// 两份服务都按同一个标记认，改名要一起改。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));

/** 程序目录（界面层的上两层），包含模块、模型与存档。 */
export const 默认项目根 = path.resolve(本目录, '..', '..');

/** 注令牌的那个标记。页面里写着它，服务里换成真令牌。 */
export const 令牌标记 = '/*令牌*/null';

/**
 * 读一份文本，自动去掉 UTF-8 BOM。
 * @param {string} 文件
 */
export function 读文本(文件) {
  const 原 = fs.readFileSync(文件);
  const 去BOM = 原[0] === 0xef && 原[1] === 0xbb && 原[2] === 0xbf ? 原.subarray(3) : 原;
  return 去BOM.toString('utf8');
}

/**
 * 把令牌注进一份页面或脚本。页面里写了标记就用它，没写就在最前面插一行。
 * @param {string} 文本
 * @param {string} 令牌
 */
export function 注令牌(文本, 令牌) {
  const 值 = JSON.stringify(令牌);
  if (文本.includes(令牌标记)) return 文本.replace(令牌标记, 值);
  return `window.__令牌__ = ${值};\n${文本}`;
}
