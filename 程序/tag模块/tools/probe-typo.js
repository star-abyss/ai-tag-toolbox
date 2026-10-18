'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createTagModule } = require(path.join(ROOT, 'index.js'));
const tags = createTagModule({ data: path.join(ROOT, 'data') });
tags.query('x');

const 正确 = 'kochiya_sanae';
const 正确中文 = '东风谷早苗';

const 看 = (组, 串) => {
  const r = tags.run('query', { 串, 上限: 5 });
  const 认 = tags.recognize(串);
  const 中 = r.data.候选.some((row) => String(row.记录.名称).split(',')[0] === 正确);
  const 头 = r.data.候选[0];
  console.log('  ' + 组.padEnd(14) + JSON.stringify(串).padEnd(24) + ' → ' + String(r.data.合计).padStart(4) + ' 条  '
    + (中 ? '✅ 里面有它' : '❌ 没有它')
    + (头 ? ('   头: ' + String(头.记录.名称).split(',')[0] + ' ' + (头.记录.中文名 || '')) : '')
    + '   认词 ' + (认 === null ? 'null' : 认));
};

console.log('正确写法基准：');
看('基准', 正确);
看('基准中文', 正确中文);

console.log('\n英文名 —— 各种拼错：');
看('少一个字母', 'kochiya_sana');
看('多一个字母', 'kochiya_sanaee');
看('写错一个字母', 'kochiya_sanai');
看('换位', 'kochiya_snaae');
看('少个下划线', 'kochiyasanae');
看('少一个字母+无下划线', 'kochiyasana');
看('开头就错', 'kociya_sanae');
看('大写拼错', 'Kochiya_Sanai');

console.log('\n中文名 —— 各种拼错：');
看('少一个字', '东风谷早');
看('多一个字', '东风谷早苗苗');
看('写错一个字', '东凤谷早苗');
看('写错一个字2', '东风谷早苖');
看('换位', '东谷风早苗');
看('只写前两字', '东风谷');
看('同音字', '东丰谷早苗');
