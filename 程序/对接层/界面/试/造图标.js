// 从一份 SVG sprite 里取出 `--图-*` 令牌，拼成可以直接贴进 `页/页.css` 的 CSS。
//
// 用法：node 试/造图标.js <sprite.svg>
//
// 出口：一段 CSS 自定义属性，键是 `--图-<符号 id>`，值是一条遮罩用的 data URI。
// 图标走遮罩而不是 <img>：遮罩吃 currentColor，图标跟着字色走。

import fs from 'node:fs';

const 用的 = [
  'tag', 'star', 'layers', 'user-round', 'images', 'scan-line',
  'scissors', 'languages', 'book-open', 'wand-sparkles', 'brain', 'circle-help',
  'x', 'sparkles', 'eye',
];

/** Lucide 里没有、这里补上的两条：放大镜与重读用的环形箭头。 */
const 补的 = {
  search: "<circle cx='11' cy='11' r='8' /><path d='m21 21-4.3-4.3' />",
  'refresh-cw': "<path d='M21 12a9 9 0 1 1-2.64-6.36' /><path d='M21 3v6h-6' />",
};

/** 一条符号的正文抠出来，包成一个自成一体的小 SVG，再转成 data URI。 */
function 做一条(正文) {
  const 净 = 正文.replace(/currentColor/g, 'black').replace(/\s+/g, ' ').trim();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'`
    + ` stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${净}</svg>`;
  const 码 = svg
    .replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C')
    .replace(/>/g, '%3E').replace(/"/g, "'").replace(/\s/g, '%20');
  return `url("data:image/svg+xml,${码}")`;
}

const sprite = fs.readFileSync(process.argv[2], 'utf8');
const 行 = [];
for (const 名 of 用的) {
  const m = new RegExp(`<symbol id="${名}"[^>]*>([\\s\\S]*?)</symbol>`).exec(sprite);
  if (!m) { console.error(`sprite 里没有 ${名}`); process.exit(1); }
  行.push([名, 做一条(m[1])]);
}
for (const [名, 正文] of Object.entries(补的)) 行.push([名, 做一条(正文)]);

const 宽 = Math.max(...行.map(([名]) => `  --图-${名}: `.length));
console.log(行.map(([名, 值]) => `  --图-${名}:`.padEnd(宽) + ` ${值};`).join('\n'));
