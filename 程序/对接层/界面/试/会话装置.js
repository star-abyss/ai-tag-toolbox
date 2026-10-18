import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function 临时项目() {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-session-package-'));
  const root = path.join(packageRoot, '程序');
  fs.mkdirSync(root, { recursive: true });
  for (const name of [
    'tag模块',
    '图片模块',
    '世界书模块',
    '装订模块',
    'comfyUI模块',
    '翻译模块',
    '识图模块',
    '主AI模块',
    '会话模块',
  ]) {
    fs.symlinkSync(path.join(source, name), path.join(root, name), 'junction');
  }
  fs.symlinkSync(path.join(source, '内置资源'), path.join(root, '内置资源'), 'junction');
  const modelLink = path.join(packageRoot, '模型');
  fs.symlinkSync(path.join(source, '..', '模型'), modelLink, 'junction');
  fs.copyFileSync(path.join(source, 'version.json'), path.join(root, 'version.json'));
  function cleanup() {
    for (const name of [
      'tag模块', '图片模块', '世界书模块', '装订模块', 'comfyUI模块', '翻译模块', '识图模块', '主AI模块', '会话模块', '内置资源',
    ]) {
      const link = path.join(root, name);
      if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.rmdirSync(link);
    }
    if (fs.existsSync(modelLink) && fs.lstatSync(modelLink).isSymbolicLink()) fs.rmdirSync(modelLink);
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
  return { root, packageRoot, modelLink, cleanup };
}
export function 大PNG() {
  const small = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const data = Buffer.concat([Buffer.from('comment\0'),Buffer.alloc(1024*1024,97)]), type=Buffer.from('tEXt');
  let crc=0xffffffff;
  for(const byte of Buffer.concat([type,data])) { crc ^= byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  const size=Buffer.alloc(4), checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([small.subarray(0,-12),size,type,data,checksum,small.subarray(-12)]);
}
