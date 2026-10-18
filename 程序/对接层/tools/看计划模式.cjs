'use strict';
/*
 * 把 cordis.patch.yml 里 plan-mode 的 section 正文原样打出来。
 * 用法：node tools/看计划模式.cjs
 * 进程退出码：0 取到了，1 没有这一段或取不出来。
 *
 * 那段正文只有一处真相：补丁文件里。本脚本只读它、不改它，也不与别处对账。
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

// js-yaml 是 DSH CLI 自己的依赖，本插件不装它：按环境变量指到的 DSH 安装位置去借。
// 没设那个变量时退回本包自己的 node_modules（开发时装过 devDependency）。
const 借 = (名) => {
  const 锚 = process.env.DSH_INSTALL_ANCHOR;
  if (锚) return createRequire(path.join(锚, 'package.json'))(名);
  return require(名);
};
const yaml = 借('js-yaml');

const 包根 = path.join(__dirname, '..');
const 补丁 = fs.readFileSync(path.join(包根, 'cordis.patch.yml'), 'utf8');
const 条目 = yaml.load(补丁);
const 计划模式 = 条目.find((一) => 一 && 一.id === 'plan-mode');

if (!计划模式 || !计划模式.config || typeof 计划模式.config.section !== 'string' || !计划模式.config.section.trim()) {
  console.error('补丁里没有 plan-mode 的 section 正文');
  process.exit(1);
}

const 正文 = 计划模式.config.section;
console.log(正文.endsWith('\n') ? 正文 : `${正文}\n`);
console.log(`--- ${正文.replace(/\r\n/g, '\n').split('\n').length} 行 ---`);
