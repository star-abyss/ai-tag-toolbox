'use strict';
/*
 * 自检用的小工具：造一张真 PNG（不引第三方库）。
 * 只用来给"读元数据"与"取字节"两条路喂东西。
 */

const zlib = require('node:zlib');

/** CRC32（PNG 每个块都要）。 */
const 表 = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(缓冲) {
  let c = 0xffffffff;
  for (let i = 0; i < 缓冲.length; i += 1) c = 表[(c ^ 缓冲[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 一个 PNG 块。 */
function 块(类型, 数据) {
  const 长 = Buffer.alloc(4);
  长.writeUInt32BE(数据.length, 0);
  const 体 = Buffer.concat([Buffer.from(类型, 'latin1'), 数据]);
  const 和 = Buffer.alloc(4);
  和.writeUInt32BE(crc32(体), 0);
  return Buffer.concat([长, 体, 和]);
}

/** tEXt 块：[关键字]\0[文本] */
function 文字块(键, 值) {
  return 块('tEXt', Buffer.concat([Buffer.from(键, 'latin1'), Buffer.from([0]), Buffer.from(值, 'latin1')]));
}

/**
 * 造一张 PNG。
 * @param {object} [选项]
 *   宽 高   默认 4×4
 *   文字    { 键: 值 } 写进 tEXt 块
 * @returns {Buffer}
 */
function 造PNG(选项 = {}) {
  const 宽 = Number(选项.宽) || 4;
  const 高 = Number(选项.高) || 4;

  const 头 = Buffer.alloc(13);
  头.writeUInt32BE(宽, 0);
  头.writeUInt32BE(高, 4);
  头[8] = 8;    // 位深
  头[9] = 2;    // 颜色类型：真彩
  头[10] = 0;   // 压缩
  头[11] = 0;   // 过滤
  头[12] = 0;   // 隔行

  // 每行：一个过滤字节 + 宽 × 3 字节
  const 行们 = [];
  for (let y = 0; y < 高; y += 1) {
    const 行 = Buffer.alloc(1 + 宽 * 3);
    for (let x = 0; x < 宽; x += 1) {
      const 位 = 1 + x * 3;
      行[位] = (x * 37) % 256;
      行[位 + 1] = (y * 53) % 256;
      行[位 + 2] = 128;
    }
    行们.push(行);
  }

  const 文字们 = Object.entries(选项.文字 || {}).map(([键, 值]) => 文字块(键, 值));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    块('IHDR', 头),
    ...文字们,
    块('IDAT', zlib.deflateSync(Buffer.concat(行们))),
    块('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { 造PNG };
