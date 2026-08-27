// AI 绘画 Tag 工具箱 - Electron 主进程
// 职责：创建窗口、加载前端、提供本地 WD Tagger（onnxruntime-node）多模型推理桥
const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let ort = null;
const aiRequests = new Map();

// API Key 只保存在 Electron safeStorage 加密文件中，不再回传给渲染进程。
function aiKeyPath() {
  return path.join(app.getPath('userData'), 'secure', 'api-key.bin');
}
function aiKeyAvailable() {
  try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch (e) { return false; }
}
function readAiKey() {
  if (!aiKeyAvailable()) return '';
  try {
    const p = aiKeyPath();
    if (!fs.existsSync(p)) return '';
    return safeStorage.decryptString(fs.readFileSync(p));
  } catch (e) { return ''; }
}
function writeAiKey(value) {
  const key = String(value == null ? '' : value);
  if (!key) {
    try { if (fs.existsSync(aiKeyPath())) fs.unlinkSync(aiKeyPath()); } catch (e) {}
    return { ok: true, configured: false };
  }
  if (!aiKeyAvailable()) return { ok: false, error: '系统安全存储不可用，请重启应用后重试' };
  try {
    const dir = path.dirname(aiKeyPath());
    fs.mkdirSync(dir, { recursive: true });
    const tmp = aiKeyPath() + '.tmp';
    fs.writeFileSync(tmp, safeStorage.encryptString(key), { mode: 0o600 });
    fs.renameSync(tmp, aiKeyPath());
    return { ok: true, configured: true };
  } catch (e) {
    return { ok: false, error: 'API Key 安全保存失败：' + (e && e.message || e) };
  }
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(x => typeof x === 'string' ? x : (x && (x.text || x.content) || '')).join('');
  return String(content || '');
}

function aiApiUrl(base) {
  const raw = String(base || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) throw new Error('API 地址必须以 http:// 或 https:// 开头');
  const u = new URL(raw + '/chat/completions');
  return u.toString();
}
function aiLocalBase(base) {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(String(base || '')).hostname); } catch (e) { return false; }
}
function comfyUrl(raw) {
  const u = new URL(String(raw || '').trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error('ComfyUI 地址必须使用 http:// 或 https://');
  const h = u.hostname.toLowerCase();
  const loopback = h === 'localhost' || h === '::1' || /^127\./.test(h);
  const privateV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h);
  if (!loopback && !privateV4) throw new Error('出于安全原因，ComfyUI 仅允许连接本机或局域网地址');
  return u;
}

ipcMain.handle('ai:key:status', async () => ({ available: aiKeyAvailable(), configured: !!readAiKey() }));
ipcMain.handle('ai:key:set', async (ev, payload) => {
  const key = String(payload && payload.key || '').trim();
  if (key.length > 4096) return { ok: false, error: 'API Key 过长' };
  return writeAiKey(key);
});
ipcMain.handle('ai:key:clear', async () => writeAiKey(''));

// AI 请求在主进程执行：渲染进程只接收流式正文/思考增量，不接触明文 Key。
ipcMain.handle('ai:complete', async (ev, payload) => {
  const requestId = String(payload && payload.requestId || '');
  const base = String(payload && payload.base || '');
  const model = String(payload && payload.model || '').trim();
  const messages = payload && Array.isArray(payload.messages) ? payload.messages : [];
  const stream = !!(payload && payload.stream);
  const maxTokens = payload && Number(payload.maxTokens) > 0 ? Number(payload.maxTokens) : 0;
  const temperature = payload && typeof payload.temperature === 'number' ? payload.temperature : 0.7;
  if (!requestId) throw new Error('AI 请求缺少 requestId');
  if (!model) throw new Error('未填写模型名');
  if (!messages.length) throw new Error('AI 请求消息为空');
  const key = readAiKey();
  if (!aiKeyAvailable() && !key && !aiLocalBase(base)) throw new Error('系统安全存储不可用，请在应用重启后重新保存 API Key');
  const controller = new AbortController();
  aiRequests.set(requestId, controller);
  try {
    const headers = { 'Content-Type': 'application/json', 'Accept': stream ? 'text/event-stream' : 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key;
    const body = { model, messages, stream, temperature };
    if (maxTokens) body.max_tokens = maxTokens;
    const res = await fetch(aiApiUrl(base), { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      let t = '';
      try { t = String(await res.text()).slice(0, 300); } catch (e) {}
      throw new Error('HTTP ' + res.status + (t ? '：' + t : ''));
    }
    if (!stream) {
      const j = await res.json();
      const c = j && j.choices && j.choices[0] && j.choices[0].message;
      return { text: c ? contentText(c.content) : '', reasoning: c ? contentText(c.reasoning_content || c.reasoning) : '' };
    }
    if (!res.body || !res.body.getReader) throw new Error('当前环境不支持流式响应');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', done = false, full = '', reasoning = '';
    const sendDelta = (content, thought) => {
      if (!content && !thought) return;
      full += content || '';
      reasoning += thought || '';
      try { ev.sender.send('ai:delta', { requestId, content: content || '', reasoning: thought || '' }); } catch (e) {}
    };
    while (!done) {
      const part = await reader.read();
      if (part.done) break;
      buf += dec.decode(part.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') { done = true; break; }
        try {
          const j = JSON.parse(data);
          const d = j && j.choices && j.choices[0] && j.choices[0].delta;
          if (d) sendDelta(contentText(d.content), contentText(d.reasoning_content || d.reasoning));
        } catch (e) {}
      }
    }
    try { ev.sender.send('ai:done', { requestId }); } catch (e) {}
    return { text: full, reasoning };
  } finally {
    aiRequests.delete(requestId);
  }
});
ipcMain.handle('ai:cancel', async (ev, payload) => {
  const id = String(payload && payload.requestId || '');
  const c = aiRequests.get(id);
  if (c) c.abort();
  return { ok: true };
});

// 模型注册表：只保留大模型（高精度 EVA02 Canary；小模型 SwinV2 已移除）
// 预处理：BGR 通道、白底补方 → 448×448、NCHW [1,3,448,448]、归一化 0-1（除以 255）
const MODELS = {
  eva02: { name: 'WD EVA02 2026 Canary（高精度 · 新角色）', onnx: 'wd-eva02-tagger-2026-canary.onnx', tags: 'tags-canary.json', threshold: 0.6094, layout: 'nchw', bgr: true, norm: true }
};
const sessions = new Map(); // modelId -> { session, inputName, outName, tagsMeta, modelPath }

// 本地翻译模型：只从应用随附目录读取，正式版禁止临时联网下载。
const TRANSLATION_MODELS = {
  'zh-en': 'opus-mt-zh-en',
  'en-zh': 'opus-mt-en-zh'
};
const translationPipelines = new Map();
const translationLoading = new Map();
let transformersRuntime = null;

// 候选模型目录：exe 旁的 models（用户可换模型）→ 打包资源目录 → 开发目录
function modelDirCandidates() {
  const dirs = [];
  try {
    if (app.isPackaged) {
      dirs.push(path.join(path.dirname(app.getPath('exe')), 'models'));
      if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'models'));
    }
  } catch (e) {}
  dirs.push(path.join(__dirname, 'models'));
  return dirs;
}
function findModelFile(name) {
  for (const d of modelDirCandidates()) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function translationDirCandidates() {
  const dirs = [];
  try {
    if (app.isPackaged) {
      dirs.push(path.join(path.dirname(app.getPath('exe')), 'models', 'translation'));
      if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'models', 'translation'));
    }
  } catch (e) {}
  dirs.push(path.join(__dirname, 'models', 'translation'));
  return dirs;
}

function findTranslationRoot() {
  for (const dir of translationDirCandidates()) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, TRANSLATION_MODELS['zh-en'], 'config.json'))) return dir;
  }
  return null;
}

function detectTranslationDirection(text, requested) {
  if (requested === 'zh-en' || requested === 'en-zh') return requested;
  return /[\u3400-\u9fff]/.test(String(text || '')) ? 'zh-en' : 'en-zh';
}

function splitTranslationText(text, limit) {
  limit = limit || 420;
  const source = String(text || '').replace(/\r\n/g, '\n');
  const out = [];
  for (const paragraph of source.split(/\n+/)) {
    const p = paragraph.trim();
    if (!p) continue;
    let rest = p;
    while (rest.length > limit) {
      const window = rest.slice(0, limit + 1);
      let cut = Math.max(window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'), window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '), window.lastIndexOf('；'), window.lastIndexOf('; '), window.lastIndexOf('，'), window.lastIndexOf(', '));
      if (cut < Math.floor(limit * 0.45)) cut = limit;
      else cut += 1;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

async function ensureTranslationPipeline(direction) {
  const modelId = TRANSLATION_MODELS[direction];
  if (!modelId) return { ok: false, error: '不支持的翻译方向' };
  const root = findTranslationRoot();
  if (!root) return { ok: false, error: '未找到本地翻译模型，请确认 models\\translation 目录完整' };
  if (translationPipelines.has(direction)) return { ok: true, pipe: translationPipelines.get(direction), modelId };
  if (translationLoading.has(direction)) return translationLoading.get(direction);
  const loading = (async () => {
    try {
      if (!transformersRuntime) transformersRuntime = await import('@huggingface/transformers');
      const { env, pipeline } = transformersRuntime;
      env.localModelPath = root;
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      const pipe = await pipeline('translation', modelId, { dtype: 'q8' });
      translationPipelines.set(direction, pipe);
      return { ok: true, pipe, modelId };
    } catch (e) {
      return { ok: false, error: '本地翻译模型加载失败：' + (e && e.message || e) };
    } finally {
      translationLoading.delete(direction);
    }
  })();
  translationLoading.set(direction, loading);
  return loading;
}

ipcMain.handle('translation:available', async () => {
  const root = findTranslationRoot();
  const directions = Object.entries(TRANSLATION_MODELS).map(([direction, model]) => ({
    direction,
    model,
    available: !!(root && fs.existsSync(path.join(root, model, 'config.json')) && fs.existsSync(path.join(root, model, 'onnx', 'encoder_model_quantized.onnx')))
  }));
  return { available: directions.some(x => x.available), directions };
});

ipcMain.handle('translation:run', async (ev, payload) => {
  const text = String(payload && payload.text || '').trim();
  if (!text) return { ok: false, error: '请输入要翻译的内容' };
  if (text.length > 20000) return { ok: false, error: '翻译内容过长，请控制在 20000 个字符以内' };
  const direction = detectTranslationDirection(text, payload && payload.direction);
  const ensured = await ensureTranslationPipeline(direction);
  if (!ensured.ok) return ensured;
  try {
    const chunks = splitTranslationText(text);
    const translated = [];
    for (const chunk of chunks) {
      const result = await ensured.pipe(chunk, { max_new_tokens: 512 });
      const first = Array.isArray(result) ? result[0] : result;
      const value = String(first && (first.translation_text || first.translation || first.text) || '').trim();
      if (value) translated.push(value);
    }
    const out = translated.join('\n');
    if (!out) return { ok: false, error: '本地模型没有返回翻译结果' };
    return { ok: true, text: out, direction, model: ensured.modelId };
  } catch (e) {
    return { ok: false, error: '本地翻译失败：' + (e && e.message || e), direction, model: ensured.modelId };
  }
});

function loadOrt() {
  if (ort) return ort;
  try {
    ort = require('onnxruntime-node');
  } catch (e) {
    try {
      ort = require(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node'));
    } catch (e2) {
      ort = null;
    }
  }
  return ort;
}

// 解析标签表（支持数组 或 {"0":["name",category,count],...} 两种格式）
function loadTagsMeta(text) {
  const raw = JSON.parse(text);
  if (Array.isArray(raw)) {
    return raw.map(v => ({ name: (v && Array.isArray(v)) ? v[0] : String(v), category: (v && Array.isArray(v) && typeof v[1] === 'number') ? v[1] : 0, count: (v && Array.isArray(v) && typeof v[2] === 'number') ? v[2] : 0 }));
  }
  const keys = Object.keys(raw).map(Number).sort((a, b) => a - b);
  const arr = [];
  for (const k of keys) {
    const v = raw[String(k)];
    arr.push({ name: (v && Array.isArray(v)) ? v[0] : String(v), category: (v && Array.isArray(v) && typeof v[1] === 'number') ? v[1] : 0, count: (v && Array.isArray(v) && typeof v[2] === 'number') ? v[2] : 0 });
  }
  return arr;
}

// 前端传来的 pixels 始终为 BGR · NHWC（size*size*3，0-255）。按模型的 layout/bgr/norm 排布成最终张量数据。
function arrangePixels(data, size, m) {
  const n = size * size;
  const layout = m.layout, bgr = m.bgr;
  let out;
  if (layout === 'nchw') {
    out = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      const b = data[i * 3], g = data[i * 3 + 1], r = data[i * 3 + 2];
      out[i] = bgr ? b : r;          // channel 0
      out[n + i] = g;                // channel 1
      out[2 * n + i] = bgr ? r : b;  // channel 2
    }
  } else if (!bgr) {
    out = new Float32Array(data.length);
    for (let i = 0; i < n; i++) {
      out[i * 3] = data[i * 3 + 2];
      out[i * 3 + 1] = data[i * 3 + 1];
      out[i * 3 + 2] = data[i * 3];
    }
  } else {
    out = Float32Array.from(data);
  }
  if (m.norm) for (let i = 0; i < out.length; i++) out[i] /= 255;
  return out;
}
function tensorDims(m, size) {
  return m.layout === 'nchw' ? [1, 3, size, size] : [1, size, size, 3];
}

async function ensureSession(modelId) {
  const m = MODELS[modelId] || MODELS.eva02;
  const o = loadOrt();
  if (!o) return { ok: false, error: '推理引擎未安装' };
  const modelPath = findModelFile(m.onnx);
  if (!modelPath) return { ok: false, error: '未找到模型文件 ' + m.onnx + '（请放入应用目录的 models 文件夹）' };
  let st = sessions.get(modelId);
  if (st && st.modelPath === modelPath) return { ok: true, m, st };
  try {
    const session = await o.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
    const inputName = session.inputNames[0];
    const outName = session.outputNames[0];
    let tagsMeta = null;
    const tagsPath = findModelFile(m.tags);
    if (tagsPath) tagsMeta = loadTagsMeta(fs.readFileSync(tagsPath, 'utf8'));
    st = { session, inputName, outName, tagsMeta, modelPath };
    sessions.set(modelId, st);
    return { ok: true, m, st };
  } catch (e) {
    return { ok: false, error: '模型加载失败：' + (e && e.message || e) };
  }
}

function createWindow() {
  // 按当前显示器工作区自适应窗口默认尺寸（不写死；显示器小则随之缩小）
  let dw = 1280, dh = 860;
  try {
    const wa = require('electron').screen.getPrimaryDisplay().workAreaSize;
    if (wa && wa.width) { dw = Math.min(1280, Math.max(1000, wa.width - 80)); dh = Math.min(860, Math.max(660, wa.height - 100)); }
  } catch (e) {}
  win = new BrowserWindow({
    width: dw,
    height: dh,
    minWidth: 900,
    minHeight: 620,
    title: 'AI 绘画 Tag 工具箱',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('will-navigate', ev => ev.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); }
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// IPC：列出可用模型（文件是否存在）
ipcMain.handle('tag:available', async () => {
  if (!loadOrt()) return { available: false, reason: '推理引擎未安装', models: [] };
  const models = Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, available: !!findModelFile(m.onnx) }));
  return { available: models.some(x => x.available), models };
});

// IPC：返回指定模型的完整标签表（供前端标签库与识图模型同步）
ipcMain.handle('tag:tags', async (ev, payload) => {
  const modelId = (payload && payload.model) || 'eva02';
  const m = MODELS[modelId] || MODELS.eva02;
  const tagsPath = findModelFile(m.tags);
  if (!tagsPath) return { ok: false, error: '未找到标签表 ' + m.tags };
  try {
    const meta = loadTagsMeta(fs.readFileSync(tagsPath, 'utf8'));
    return { ok: true, id: modelId, name: m.name, tags: meta.map(t => ({ name: t.name, category: t.category, count: t.count })) };
  } catch (e) {
    return { ok: false, error: '标签表解析失败：' + (e && e.message || e) };
  }
});

// 应用内的 ComfyUI 查看窗口（推送工作流 / 提示词用）
let comfyWin = null;
async function pushComfy(payload) {
  try {
    const url = comfyUrl((payload && payload.url) || 'http://127.0.0.1:8188').toString().replace(/\/+$/, '');
    const workflowJson = String(payload && payload.workflowJson || '');
    const prompt = String(payload && payload.prompt || '');
    const negative = String(payload && payload.negative || '');
    if (!workflowJson) return { ok: false, msg: '工作流为空' };
    if (!comfyWin || comfyWin.isDestroyed()) {
      comfyWin = new BrowserWindow({
        width: 1320, height: 900, title: 'ComfyUI（由 AI 绘画 Tag 工具箱托管）',
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
      });
      comfyWin.on('closed', () => { comfyWin = null; });
      comfyWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      comfyWin.webContents.on('will-navigate', (ev, target) => {
        try { if (new URL(target).origin !== new URL(url).origin) ev.preventDefault(); } catch (e) { ev.preventDefault(); }
      });
    }
    if (String(comfyWin.webContents.getURL() || '').replace(/\/+$/, '') !== url) {
      await comfyWin.loadURL(url + '/');
    }
    comfyWin.show(); comfyWin.focus();
    // 等待前端 ComfyApp 就绪
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { ready = await comfyWin.webContents.executeJavaScript('!!(window.app && typeof window.app.loadApiJson === "function")'); } catch (e) {}
      if (ready) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) return { ok: false, msg: 'ComfyUI 页面已打开，但前端引擎未就绪（请等页面加载完后重新推送）' };
    // 注入：载入 API 工作流 → 把正向/负面提示词写进对应 CLIPTextEncode 节点
    const injectJs = `(async () => {
      const p = ${JSON.stringify({ workflowJson, prompt, negative })};
      const app = window.app;
      try {
        const api = JSON.parse(p.workflowJson);
        let posId = null, negId = null;
        for (const nid of Object.keys(api)) {
          const v = api[nid] || {};
          if (v && /^KSampler/i.test(String(v.class_type || '')) && v.inputs) {
            const ln = l => (Array.isArray(l) && l.length) ? l[0] : null;
            posId = ln(v.inputs.positive); negId = ln(v.inputs.negative);
          }
        }
        if (typeof app.loadApiJson === 'function') await app.loadApiJson(api);
        await new Promise(r => setTimeout(r, 900));
        const getText = id => {
          if (id == null) return null;
          const n = app.graph && app.graph.getNodeById && app.graph.getNodeById(String(id));
          return (n && n.widgets && n.widgets.length) ? n.widgets[0].value : null;
        };
        const setText = (id, text) => {
          const n = app.graph && app.graph.getNodeById && app.graph.getNodeById(String(id));
          if (n && n.widgets && n.widgets.length) n.widgets[0].value = text;
        };
        setText(posId, p.prompt);
        setText(negId, p.negative);
        if (app.graph && app.graph.setDirtyCanvas) { app.graph.setDirtyCanvas(true, true); app.graph.change(); }
        return { ok: true, nodes: app.graph ? (app.graph._nodes || []).length : 0, pos: posId, neg: negId, posText: getText(posId), negText: getText(negId) };
      } catch (e) {
        return { ok: false, msg: String(e && e.message || e) };
      }
    })()`;
    const res = await comfyWin.webContents.executeJavaScript(injectJs);
    return res || { ok: false, msg: '注入无响应' };
  } catch (e) {
    return { ok: false, msg: String(e && e.message || e) };
  }
}
ipcMain.handle('comfy:push', (ev, payload) => pushComfy(payload));

// IPC：运行识图（pixels: Float32Array 448*448*3 BGR, 0-255；model: 'eva02'）
ipcMain.handle('tag:run', async (ev, payload) => {
  const modelId = (payload && payload.model) || 'eva02';
  const ensured = await ensureSession(modelId);
  if (!ensured.ok) return { ok: false, error: ensured.error };
  const { m, st } = ensured;
  try {
    const o = loadOrt();
    const size = (payload && payload.size) || 448;
    const data = payload && payload.pixels;
    if (!data || data.length !== size * size * 3) return { ok: false, error: '图像数据无效' };
    const arr = arrangePixels(data, size, m);
    const tensor = new o.Tensor('float32', Float32Array.from(arr), tensorDims(m, size));
    const feeds = {};
    feeds[st.inputName] = tensor;
    const results = await st.session.run(feeds);
    const logits = results[st.outName];
    const n = logits.data.length;
    const probs = logits.data; // WD Tagger ONNX 输出已内置 sigmoid，数值即 0~1
    const threshold = (payload && typeof payload.threshold === 'number') ? payload.threshold : m.threshold;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (probs[i] >= threshold) {
        const meta = st.tagsMeta && st.tagsMeta[i] ? st.tagsMeta[i] : null;
        out.push({
          tag: meta && meta.name ? meta.name : ('#' + i),
          category: meta && typeof meta.category === 'number' ? meta.category : 0,
          prob: Math.round(probs[i] * 10000) / 10000
        });
      }
    }
    out.sort((a, b) => b.prob - a.prob);
    return { ok: true, tags: out, threshold, model: modelId };
  } catch (e) {
    return { ok: false, error: '推理失败：' + (e && e.message || e) };
  }
});

// 冒烟测试模式（--smoke）在沙箱环境下禁用硬件加速；截图模式（--shot）同理
if (process.argv.includes('--smoke') || process.argv.includes('--shot')) app.disableHardwareAcceleration();

app.whenReady().then(() => {
  // 测试模式（--pushtest / --smoke / --uitest / --shot）已抽到 tests/test-modes.js
  try {
    const { initTestModes } = require('./tests/test-modes.js');
    if (initTestModes({ app, BrowserWindow, path, fs, process, MODELS, ensureSession, ensureTranslationPipeline, loadOrt, arrangePixels, tensorDims, pushComfy })) return;
  } catch (e) {
    console.log('测试模块加载失败（忽略，正常启动）：' + (e && e.message || e));
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
