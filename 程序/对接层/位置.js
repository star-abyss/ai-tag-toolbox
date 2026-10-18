import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function 默认数据目录() {
  const local = process.env.LOCALAPPDATA === undefined ? path.join(os.homedir(), 'AppData', 'Local') : process.env.LOCALAPPDATA;
  return path.join(local, '工具箱');
}

function 读JSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`STORAGE_READ_FAILED: 无法读取 ${file}：${error.message}`);
  }
}

async function 写JSON(file, value) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

export function 读位置设置() {
  const stored = 读JSON(path.join(默认数据目录(), '位置.json'));
  return { 数据目录: stored.数据目录 === undefined ? 默认数据目录() : stored.数据目录 };
}

/** 程序资源与个人数据的位置，写设置按调用顺序执行。 */
export function 造存储({ 项目根, 数据目录 = '' }) {
  const root = path.resolve(数据目录 || 读位置设置().数据目录);
  const positionFile = path.join(默认数据目录(), '位置.json');
  const settingsFile = path.join(root, '设置.json');
  const modelRoot = path.resolve(项目根, '..', '模型');
  let nextRoot = root;
  let writes = Promise.resolve();
  const enqueue = work => {
    const pending = writes.catch(() => {}).then(work);
    writes = pending;
    return pending;
  };
  const directories = {
    用户目录: path.join(root, '预设'),
    图片目录: path.join(root, '图库'),
    会话目录: path.join(root, '会话'),
    世界书用户目录: path.join(root, '世界书'),
    标签目录: path.join(root, '标签'),
    comfyUI工作流存档: path.join(root, 'ComfyUI', '工作流.json'),
    模型目录: modelRoot,
  };
  fs.mkdirSync(root, { recursive: true });
  const ignore = path.join(root, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', 'utf8');
  const seed = path.join(项目根, '内置资源', '标签');
  if (!fs.existsSync(directories.标签目录) && fs.existsSync(seed)) {
    fs.cpSync(seed, directories.标签目录, { recursive: true });
  }
  const readLocation = () => ({ 数据目录: root, 下次数据目录: nextRoot, 程序目录: path.resolve(项目根), 模型目录: modelRoot,
    会话: directories.会话目录, 图片: directories.图片目录, API: path.join(root, 'API'), 设置文件: settingsFile, 位置文件: positionFile });
  return {
    配置: directories,
    读位置: readLocation,
    读设置: () => structuredClone(读JSON(settingsFile)),
    写设置: patch => enqueue(async () => {
      const value = { ...读JSON(settingsFile), ...patch };
      await 写JSON(settingsFile, value);
      return structuredClone(value);
    }),
    设置数据目录: destination => enqueue(async () => {
      if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw new Error('STORAGE_BAD_PATH: 请输入数据目录的绝对路径');
      const value = path.resolve(destination);
      await 写JSON(positionFile, { 数据目录: value });
      nextRoot = value;
      return readLocation();
    }),
  };
}
