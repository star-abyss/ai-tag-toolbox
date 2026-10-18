// 字节与缩略图。
//
// 为什么字节不走 JSON：一张 1.2 MB 的 PNG 过一趟 JSON 要膨胀成约 160 万字符，
// 图库里排几十张就是把几百 MB 塞进页面。所以原图与缩略图各走一条 GET，
// 浏览器自己缓存、自己流式解码。
//
// 缩略图**不落盘**：现读原图现缩。图片模块的派生变体要给装配层递一个"处理图片"
// 才有（现在没给），而且一份缩略图在盘上就是第二份真相——格子用哪一档，
// 凭什么要存进条目里。
import path from 'node:path';

import { 还原字节 } from '../宿主.js';

/** 缩略图的边长上限。 */
const 默认边长 = 320;

/** 缩略图缓存：`条目ID|变体|边长` → Buffer。只管内存，重起即空。 */
const 缩略图们 = new Map();
const 最多缓存 = 240;

/** 图片模块给的变体名。 */
const 认得的变体 = ['original', 'preview', 'thumbnail'];

/** 一张图要多少字节之内才肯缓存缩略图，免得大图把内存顶满。 */
const 缓存上限字节 = 6 * 1024 * 1024;

/** 缩略图那一档要不要懒装 sharp（它是原生模块，装一次不便宜）。 */
let sharp的口 = null;
let sharp试过 = false;

async function 取sharp() {
  if (!sharp试过) {
    sharp试过 = true;
    try {
      const 模 = await import('sharp');
      sharp的口 = 模.default || 模;
    } catch (_) {
      sharp的口 = null;
    }
  }
  return sharp的口;
}

/** 清缓存里最旧的那几条。 */
function 清缓存() {
  while (缩略图们.size > 最多缓存) {
    const 最老 = 缩略图们.keys().next().value;
    if (最老 === undefined) break;
    缩略图们.delete(最老);
  }
}

/**
 * 造字节与缩略图那两条路。
 *
 * @param {object} 宿主 造宿主() 交出来的那一份
 */
export function 造字节路(宿主) {
  /**
   * 取出一个条目的字节。
   * @param {object} 引用 图片模块的引用 `{ 作用域, 条目ID }`
   * @param {string} [变体] original / preview / thumbnail，缺省 original
   * @returns {Promise<{ok:true, 字节:Buffer, mime:string, 变体:string, 标识:string}|{ok:false, reason:string, code:string}>}
   */
  async function 取字节(引用, 变体) {
    const 要的 = 认得的变体.includes(String(变体)) ? String(变体) : 'original';
    const 回 = await 宿主.调({ 模块: 'image', 动作: '取内容', 参数: { 引用, 变体: 要的 } });
    if (!回 || typeof 回 !== 'object') {
      return { ok: false, reason: '图片模块没交出回执', code: 'UI_NO_RECEIPT' };
    }
    if (回.ok === false) return 回;
    const 字节 = 还原字节(回.字节);
    if (!Buffer.isBuffer(字节)) return { ok: false, reason: '回执里没有字节', code: 'UI_NO_BYTES' };
    return {
      ok: true,
      字节,
      mime: 回.mime || 'application/octet-stream',
      变体: 回.变体 || 要的,
      标识: (引用 && 引用.条目ID) || '',
      文件名: 回.文件名 || '',
    };
  }

  /**
   * 缩略图：能现缩就现缩，缩不出来就照原样给原图（界面永远拿得到一张能画的图）。
   *
   * 先看条目自己有没有现成的那一档（`取详情` 的 `变体` 是"变体名 → 文件名"的字典，
   * 里面有 preview / thumbnail 就说明装配层给了处理图片）；
   * 没有就现读原图、用 sharp 缩一次，缩完按 `条目ID|变体|边长` 记在内存里。
   *
   * @returns {Promise<object>} 与 取字节 同形，外加 `现缩的: boolean`
   */
  async function 取缩略图(引用, 边长) {
    const 长 = Math.max(16, Math.min(1024, Number(边长) || 默认边长));
    const 条目ID = (引用 && 引用.条目ID) || '';
    const 键 = `${条目ID}|${长}`;
    if (缩略图们.has(键)) return { ...缩略图们.get(键), 现缩的: true, 缓存的: true };

    // 条目自己有没有缩略图那一档。
    const 详 = await 宿主.调({ 模块: 'image', 动作: '取详情', 参数: { 引用 } });
    const 有现成的 = 详 && 详.ok !== false && 详.变体 && (详.变体.thumbnail || 详.变体.preview);
    if (有现成的) {
      const 哪一档 = 详.变体.thumbnail ? 'thumbnail' : 'preview';
      const 用现成 = await 取字节(引用, 哪一档);
      if (用现成.ok) return { ...用现成, 现缩的: false };
    }

    const 原 = await 取字节(引用, 'original');
    if (!原.ok) return 原;

    const sharp = await 取sharp();
    if (!sharp) return { ...原, 现缩的: false };

    try {
      const 缩 = await sharp(原.字节)
        .rotate()
        .resize({ width: 长, height: 长, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toBuffer();
      const 出 = { ...原, 字节: 缩, mime: 'image/png', 现缩的: true, 缓存的: false };
      if (原.字节.length <= 缓存上限字节) {
        缩略图们.set(键, 出);
        清缓存();
      }
      return 出;
    } catch (_) {
      // 缩不动（不是图、或者 sharp 认不出这一种），照原样给原图。
      return { ...原, 现缩的: false };
    }
  }

  /** 缩略图缓存里现在有几条。 */
  const 缓存几条 = () => 缩略图们.size;

  return { 取字节, 取缩略图, 缓存几条 };
}

/** 从查询串里读一个引用：`存放地` / `会话ID` / `条目ID` 三格。 */
export function 读引用(参数串) {
  const 查 = 参数串;
  const 取 = (名) => String((查 && typeof 查.get === 'function' ? 查.get(名) : '') || '');
  const 存放地 = 取('存放地') || 'gallery';
  const 作用域 = { 存放地 };
  const 会话ID = 取('会话ID');
  if (会话ID) 作用域.会话ID = 会话ID;
  return { 作用域, 条目ID: 取('条目ID') };
}

/** 文件名里能出现的字符（Content-Disposition 用）。 */
export function 洗文件名(名) {
  const 底 = path.basename(String(名 || '图'));
  return 底.replace(/[^\w.\-\u4e00-\u9fff]+/g, '_').slice(0, 120) || '图';
}
