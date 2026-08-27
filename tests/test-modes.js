// 测试模式（--pushtest / --smoke / --uitest / --shot）
// 从 main.js 抽出，保持主进程只做启动 + IPC 注册。
// 返回 true 表示已进入测试模式（主进程应停止正常启动）。
'use strict';

async function runPushTest(deps) {
  const { app, pushComfy } = deps;
  try {
    const sample = {
      "1": { class_type: 'UNETLoader', inputs: { unet_name: 'anima-base-v1.0.safetensors', weight_dtype: 'default' } },
      "2": { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_06b_base.safetensors', type: 'qwen_image' } },
      "3": { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
      "4": { class_type: 'CLIPTextEncode', inputs: { text: 'TESTPOSPROMPT_XYZZY', clip: ['2', 0] } },
      "5": { class_type: 'CLIPTextEncode', inputs: { text: 'TESTNEGPROMPT_XYZZY', clip: ['2', 0] } },
      "6": { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 640, batch_size: 1 } },
      "7": { class_type: 'KSampler', inputs: { seed: 42, steps: 8, cfg: 2.2, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0] } },
      "8": { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
      "9": { class_type: 'SaveImage', inputs: { filename_prefix: 'aitag_push', images: ['8', 0] } }
    };
    const r = await pushComfy({ url: 'http://127.0.0.1:8188', workflowJson: JSON.stringify(sample), prompt: 'TESTPOSPROMPT_XYZZY', negative: 'TESTNEGPROMPT_XYZZY' });
    console.log('PUSHTEST: ' + JSON.stringify(r));
    app.exit(r && r.ok ? 0 : 1);
  } catch (e) {
    console.log('PUSHTEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

async function runSmoke(deps, imgArg, modelArg) {
  const { app, BrowserWindow, path, fs, MODELS, ensureSession, loadOrt, arrangePixels, tensorDims } = deps;
  try {
    const modelId = (modelArg && MODELS[modelArg]) ? modelArg : 'eva02';
    const ensured = await ensureSession(modelId);
    if (!ensured.ok) { console.log('SMOKE FAIL load: ' + ensured.error); app.exit(1); return; }
    const { m, st } = ensured;
    const o = loadOrt();
    let pixels = null;
    if (imgArg && fs.existsSync(imgArg)) {
      const buf = fs.readFileSync(imgArg);
      const mime = /\.png$/i.test(imgArg) ? 'image/png' : 'image/jpeg';
      const dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
      const w2 = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
      await w2.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
      await new Promise(r => setTimeout(r, 800));
      pixels = await w2.webContents.executeJavaScript('window.__wdPreprocess && window.__wdPreprocess(' + JSON.stringify(dataUrl) + ')');
      console.log('SMOKE preprocess out len: ' + (pixels ? pixels.length : 0));
    }
    if (!pixels) pixels = new Float32Array(448 * 448 * 3).fill(255);
    const arr = arrangePixels(pixels, 448, m);
    const tensor = new o.Tensor('float32', Float32Array.from(arr), tensorDims(m, 448));
    const feeds = {};
    feeds[st.inputName] = tensor;
    const t0 = Date.now();
    const results = await st.session.run(feeds);
    console.log('SMOKE infer ms: ' + (Date.now() - t0));
    const logits = results[st.outName];
    console.log('SMOKE out len: ' + logits.data.length + ' tagsMeta: ' + (st.tagsMeta ? st.tagsMeta.length : 0));
    const probs = Array.from(logits.data).map((v, i) => ({ i, p: v }));
    probs.sort((a, b) => b.p - a.p);
    console.log('SMOKE top: ' + probs.slice(0, 15).map(x => (st.tagsMeta && st.tagsMeta[x.i] ? st.tagsMeta[x.i].name : '#' + x.i) + ':' + x.p.toFixed(3)).join(' | '));
    console.log('SMOKE >=thresh: ' + probs.filter(x => x.p >= m.threshold).length);
    console.log('SMOKE stage: done');
    app.exit(0);
  } catch (e) {
    console.log('SMOKE FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

async function runTranslationTest(deps) {
  const { app, ensureTranslationPipeline } = deps;
  try {
    const samples = [
      ['zh-en', '蓝色头发的女孩站在教室里。'],
      ['en-zh', 'A girl with blue hair is standing in a classroom.']
    ];
    for (const [direction, input] of samples) {
      const ensured = await ensureTranslationPipeline(direction);
      if (!ensured.ok) throw new Error(direction + ' load: ' + ensured.error);
      const result = await ensured.pipe(input, { max_new_tokens: 128 });
      const first = Array.isArray(result) ? result[0] : result;
      const output = String(first && (first.translation_text || first.translation || first.text) || '').trim();
      if (!output) throw new Error(direction + ' returned empty output');
      console.log('TRANSLATIONTEST ' + direction + ': ' + input + ' => ' + output);
    }
    console.log('TRANSLATIONTEST stage: done');
    app.exit(0);
  } catch (e) {
    console.log('TRANSLATIONTEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

// 翻译提示词纯 UI 回归：不调用远程 API，也不读取/清理用户 Key。
async function runTranslationPromptTest(deps) {
  const { app, BrowserWindow, path } = deps;
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 900));
    const result = await w.webContents.executeJavaScript(`(function(){
      const zh = __translationPrompt('蓝色头发的女孩站在教室里', 'zh-en');
      const en = __translationPrompt('1girl, blue_hair, standing, classroom', 'en-zh');
      const weighted = __translationPrompt('(blue_hair:1.2), standing', 'en-zh');
      let captured = null;
      window.chatComplete = messages => { captured = messages; return Promise.resolve('mock-translation'); };
      const input = document.getElementById('translateInput');
      const direction = document.getElementById('translateDirection');
      direction.value = 'en-zh'; input.value = '1girl, blue_hair, standing, classroom';
      return __translationAi().then(() => ({
        zhRefs: zh.references.length,
        enRefs: en.references.length,
        zhHasBlueHair: /blue[ _]hair/.test(JSON.stringify(zh.references)),
        enHasBlueHair: /blue[ _]hair/.test(JSON.stringify(en.references)),
        zhHasInstruction: /标准英文绘图 Tag/.test(zh.system) && /只输出逗号分隔的英文 Tag/.test(zh.system),
        enHasInstruction: /翻译成自然、准确的中文/.test(en.system) && /不要生成新的英文 Tag/.test(en.system),
        zhHasInput: zh.user.indexOf('蓝色头发的女孩站在教室里') >= 0,
        enHasInput: en.user.indexOf('1girl, blue_hair, standing, classroom') >= 0,
        multiChineseNames: en.references.some(x => x.en === 'blue hair' && Array.isArray(x.zhAliases) && x.zhAliases.length > 0),
        weightedTag: weighted.references.some(x => x.en === 'blue hair' && x.matchedTerms && x.matchedTerms.indexOf('(blue_hair:1.2)') >= 0) && weighted.user.indexOf('(blue_hair:1.2)') >= 0,
        dispatched: Array.isArray(captured) && captured.length === 2 && captured[0].role === 'system' && captured[1].role === 'user' && /blue[ _]hair/.test(captured[1].content)
      }));
    })()`);
    console.log('TRANSLATIONPROMPTTEST result: ' + JSON.stringify(result));
    const ok = result && result.zhRefs > 0 && result.enRefs > 0 && result.zhHasBlueHair && result.enHasBlueHair && result.zhHasInstruction && result.enHasInstruction && result.zhHasInput && result.enHasInput && result.multiChineseNames && result.weightedTag && result.dispatched;
    console.log('TRANSLATIONPROMPTTEST stage: ' + (ok ? 'done' : 'failed'));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('TRANSLATIONPROMPTTEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

async function runErrorMessageTest(deps) {
  const { app, BrowserWindow, path } = deps;
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 700));
    const result = await w.webContents.executeJavaScript(`(function(){
      const auth = formatAppError(new Error("Error invoking remote method 'ai:complete': Error: HTTP 401：Authentication Fails (governor)"), 'AI 翻译');
      const net = formatAppError(new Error('Failed to fetch'), 'AI 请求');
      const comfy = formatAppError(new Error('ComfyUI 生成超时（10 分钟未返回图像）'), 'ComfyUI');
      const secret = formatAppError(new Error('HTTP 401：Bearer sk-secret-token'), 'AI 请求');
      const d = __appErrorDiagnostics();
      return { auth, net, comfy, secret, authCode:/AI_AUTH_401/.test(auth), authGuide:/重新保存 Key/.test(auth), netCode:/NETWORK_REQUEST/.test(net), comfyCode:/COMFY_TIMEOUT/.test(comfy), redacted:secret.indexOf('sk-secret-token') < 0 && secret.indexOf('[已隐藏]') >= 0, diagnostic:d && d.code };
    })()`);
    console.log('ERRORMESSAGETEST result: ' + JSON.stringify(result));
    const ok = result && result.authCode && result.authGuide && result.netCode && result.comfyCode && result.redacted && result.diagnostic === 'AI_AUTH_401';
    console.log('ERRORMESSAGETEST stage: ' + (ok ? 'done' : 'failed'));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('ERRORMESSAGETEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

async function runI18nTest(deps) {
  const { app, BrowserWindow, path } = deps;
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 1000));
    const result = await w.webContents.executeJavaScript(`(async function(){
      const oldState = localStorage.getItem('dbt_locale_v1');
      const available = __i18nAvailable();
      const toEn = await __i18nSetLocale('en-US', 'manual');
      await new Promise(r => setTimeout(r, 80));
      const en = { lang: document.documentElement.lang, translate: document.getElementById('translateAi').textContent.trim(), direction: document.querySelector('#translateDirection option[value="zh-en"]').textContent.trim(), category: document.querySelector('#catList .cat:nth-child(2) span:nth-child(2)') && document.querySelector('#catList .cat:nth-child(2) span:nth-child(2)').textContent.trim(), error: formatAppError(new Error('HTTP 401: Authentication Fails (governor)'), 'AI') };
      const toZh = await __i18nSetLocale('zh-CN', 'manual');
      await new Promise(r => setTimeout(r, 80));
      const zh = { lang: document.documentElement.lang, translate: document.getElementById('translateAi').textContent.trim(), direction: document.querySelector('#translateDirection option[value="en-zh"]').textContent.trim() };
      const invalid = await __i18nImportPack('{bad json');
      if (oldState === null) localStorage.removeItem('dbt_locale_v1'); else localStorage.setItem('dbt_locale_v1', oldState);
      return { available, toEn, en, toZh, zh, invalid };
    })()`);
    console.log('I18NTEST result: ' + JSON.stringify(result));
    const ids = (result && result.available || []).map(x => x.id);
    const ok = result && result.toEn && result.toZh && ids.includes('zh-CN') && ids.includes('en-US') && result.en.lang === 'en-US' && /AI Translate/.test(result.en.translate) && /Chinese/.test(result.en.direction) && /AI authentication failed/i.test(result.en.error) && result.zh.lang === 'zh-CN' && /AI 翻译/.test(result.zh.translate) && /Tag/.test(result.zh.direction) && result.invalid && result.invalid.ok === false && result.invalid.code === 'LOCALE_INVALID_JSON';
    console.log('I18NTEST stage: ' + (ok ? 'done' : 'failed'));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('I18NTEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

async function runTimeoutTest(deps) {
  const { app, BrowserWindow, path } = deps;
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 700));
    const result = await w.webContents.executeJavaScript(`(async function(){
      const old = AIClient.complete;
      const states = [];
      const uiDefaults = { enabled: document.getElementById('aiTimeoutEnabled') && document.getElementById('aiTimeoutEnabled').checked, seconds: document.getElementById('aiTimeoutSec') && document.getElementById('aiTimeoutSec').value, disabled: document.getElementById('aiTimeoutSec') && document.getElementById('aiTimeoutSec').disabled };
      AIClient.complete = () => new Promise(resolve => setTimeout(() => resolve('done'), 120));
      const started = Date.now();
      const value = await AIJobController.complete([{ role:'user', content:'timeout-disabled' }], { onStatus: s => states.push(s) });
      const disabled = { value, elapsedMs: Date.now() - started, status: states[states.length - 1], hasTimer: states.some(s => s.timeoutEnabled) };
      AIClient.complete = () => new Promise(resolve => setTimeout(() => resolve('late'), 250));
      const timed = [];
      let timeoutError = '';
      try { await AIJobController.complete([{ role:'user', content:'timeout-enabled' }], { timeoutMs:60, allowShortTimeout:true, onStatus: s => timed.push(s) }); } catch (e) { timeoutError = String(e && e.message || e); }
      const minStates = [];
      const abort = new AbortController();
      AIClient.complete = (messages, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      const minTask = AIJobController.complete([{ role:'user', content:'timeout-minimum' }], { timeoutMs:1, signal: abort.signal, onStatus: s => minStates.push(s) }).catch(() => null);
      await new Promise(r => setTimeout(r, 20));
      abort.abort();
      await minTask;
      AIClient.complete = old;
      return { disabled, timed: timed[timed.length - 1], timeoutError, minimum: minStates.find(s => s.state === 'running'), uiDefaults };
    })()`);
    console.log('TIMEOUTTEST result: ' + JSON.stringify(result));
    const ok = result && result.disabled && result.disabled.value === 'done' && result.disabled.elapsedMs >= 100 && result.disabled.status && result.disabled.status.state === 'succeeded' && result.disabled.hasTimer === false && result.timed && result.timed.state === 'timeout' && /超时/.test(result.timeoutError || '') && result.timed.elapsedMs >= 50 && result.minimum && result.minimum.timeoutMs >= 300000 && result.uiDefaults && result.uiDefaults.enabled === false && String(result.uiDefaults.seconds) === '300' && result.uiDefaults.disabled === true;
    console.log('TIMEOUTTEST stage: ' + (ok ? 'done' : 'failed'));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('TIMEOUTTEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

// 主进程安全 API 请求回归：验证 Key 可写入系统安全存储、不会出现在普通配置，
// 且实际请求由主进程带上 Authorization 后返回结果。
async function runSecureAiTest(deps) {
  const { app, BrowserWindow, path } = deps;
  const http = require('http');
  const port = 17838;
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ auth: req.headers.authorization || '', body });
      const data = JSON.parse(body || '{}');
      if (data.model === 'slow-model') {
        setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'too-late' } }] })); }, 500);
        return;
      }
      if (data.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking-' } }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'stream-' } }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'secure-transport-ok' } }] }));
      }
    });
  });
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 1000));
    const result = await w.webContents.executeJavaScript(`(async function(){
      const api = window.aiTag && window.aiTag.ai;
      if (!api) return { error: '安全 AI 桥不存在' };
      await api.keyClear();
      const before = await api.keyStatus();
      const saved = await api.keySet('secure-transport-test-key');
      const after = await api.keyStatus();
      const reply = await api.complete([{ role:'user', content:'ping' }], { base:'http://127.0.0.1:${port}/v1', model:'mock-model', stream:false });
      const deltas = [];
      const streamed = await api.complete([{ role:'user', content:'ping' }], { base:'http://127.0.0.1:${port}/v1', model:'mock-model', stream:true, onDelta:(content, reasoning) => deltas.push([content, reasoning]) });
      aiCfg.base = 'http://127.0.0.1:${port}/v1'; aiCfg.model = 'mock-model'; aiCfg.temp = 0.7;
      const controlled = await chatComplete([{ role:'user', content:'controller' }], { stream:false });
      let timeoutError = '';
      aiCfg.model = 'slow-model';
      try { await chatComplete([{ role:'user', content:'slow' }], { stream:false, timeoutMs:80, allowShortTimeout:true }); } catch (e) { timeoutError = String(e && e.message || e); }
      const cfg = localStorage.getItem('dbt_ai_v2') || '';
      const cleared = await api.keyClear();
      const finalState = await api.keyStatus();
      return { before, saved, after, reply, streamed, deltas, controlled, timeoutError, activeJobs: (window.__aiJobs ? window.__aiJobs() : []), cfgHasKey: /"key"\\s*:/.test(cfg), cleared, finalState };
    })()`);
    console.log('SECUREAITEST result: ' + JSON.stringify(result));
    const requestsOk = seen.length >= 4 && seen.every(x => x.auth === 'Bearer secure-transport-test-key');
    const ok = result && result.saved && result.saved.ok && result.after && result.after.configured && result.reply && result.reply.text === 'secure-transport-ok' && result.streamed && result.streamed.text === 'stream-ok' && result.deltas && result.deltas.length >= 2 && result.controlled === 'secure-transport-ok' && /超时/.test(result.timeoutError || '') && Array.isArray(result.activeJobs) && result.activeJobs.length === 0 && !result.cfgHasKey && result.cleared && result.finalState && !result.finalState.configured && requestsOk;
    console.log('SECUREAITEST request: ' + JSON.stringify(seen.map(x => ({ auth: x.auth, body: x.body.slice(0, 180) }))));
    console.log('SECUREAITEST stage: ' + (ok ? 'done' : 'failed'));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('SECUREAITEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  } finally {
    try { server.close(); } catch (e) {}
  }
}

async function runImageStorageTest(deps) {
  const { app, BrowserWindow, path } = deps;
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 700));
    const result = await w.webContents.executeJavaScript(`(async function(){
      const key = 'dbt_image_storage_test';
      const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const value = [{ id:'m1', text:'image-test', imgs:[data] }];
      const persisted = await __persistWithImageRefs(key, value);
      const raw = localStorage.getItem(key) || '';
      const clean = JSON.parse(raw);
      const id = clean[0] && clean[0].imageIds && clean[0].imageIds[0];
      const storedWithoutInlineData = Array.isArray(clean[0] && clean[0].imgs) && clean[0].imgs.length === 0 && raw.indexOf(data) < 0;
      const storedImage = id ? await __imageStore.get(id) : '';
      const restored = await __restoreImageRefs(clean);
      const ok = persisted === true && !!id && storedWithoutInlineData && storedImage === data && restored[0].imgs[0] === data;
      localStorage.removeItem(key);
      if (id) await __imageStore.del(id);
      return { ok, persisted, rawBytes: raw.length, hasImageId: !!id, inlineDataRemoved: storedWithoutInlineData, imageRoundTrip: storedImage === data, restoredImages: restored[0].imgs.length };
    })()`);
    console.log('IMAGESTORAGETEST result: ' + JSON.stringify(result));
    console.log('IMAGESTORAGETEST stage: ' + (result && result.ok ? 'done' : 'failed'));
    app.exit(result && result.ok ? 0 : 1);
  } catch (e) {
    console.log('IMAGESTORAGETEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

async function runTranslationUiTest(deps, outArg) {
  const { app, BrowserWindow, path, fs } = deps;
  const w = new BrowserWindow({ width: 1440, height: 940, show: true, x: -3000, y: -3000, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  w.webContents.setBackgroundThrottling(false);
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 1400));
    const navBefore = await w.webContents.executeJavaScript(`(function(){
      const read = id => { const e = document.getElementById(id); const r = e && e.getBoundingClientRect(); return r ? { left:r.left, top:r.top, width:r.width } : null; };
      return { translate:read('translateBtn'), theme:read('themeBtn'), ai:read('aiBtn'), workspace:read('headerWorkspace') };
    })()`);
    await w.webContents.executeJavaScript(`(async function(){
      await __translationOpen();
      const input = document.getElementById('translateInput');
      input.value = '蓝色头发的女孩站在教室里。';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const navAfter = await w.webContents.executeJavaScript(`(function(){
      const read = id => { const e = document.getElementById(id); const r = e && e.getBoundingClientRect(); return r ? { left:r.left, top:r.top, width:r.width } : null; };
      return { translate:read('translateBtn'), theme:read('themeBtn'), ai:read('aiBtn'), workspace:read('headerWorkspace') };
    })()`);
    let state = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      state = await w.webContents.executeJavaScript(`(function(){
        const view = document.getElementById('translateView');
        const input = document.getElementById('translateInput');
        const output = document.getElementById('translateOutput');
        return {
          open: !view.hidden && getComputedStyle(view).display !== 'none',
          input: input.value,
          output: output.value,
          status: document.getElementById('translateStatus').textContent,
          tags: document.querySelectorAll('#translateTags .translate-tag').length,
          tagLibraryHidden: document.getElementById('tagLibraryView').hidden,
          sidebarHidden: getComputedStyle(document.getElementById('sidebar')).display === 'none',
          aiButtonVisible: getComputedStyle(document.getElementById('translateAi')).display !== 'none'
        };
      })()`);
      if (state && (state.output || /失败|未找到/.test(state.status || ''))) break;
    }
    console.log('TRANSLATIONUITEST state: ' + JSON.stringify(state));
    const out = outArg || path.join(__dirname, '..', 'translation-ui.png');
    fs.writeFileSync(out, (await w.webContents.capturePage()).toPNG());
    console.log('TRANSLATIONUITEST screenshot: ' + out);
    const stable = (a, b) => a && b && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1;
    const navStable = stable(navBefore.translate, navAfter.translate) && stable(navBefore.theme, navAfter.theme) && stable(navBefore.ai, navAfter.ai) && stable(navBefore.workspace, navAfter.workspace);
    console.log('TRANSLATIONUITEST navBefore: ' + JSON.stringify(navBefore));
    console.log('TRANSLATIONUITEST navAfter: ' + JSON.stringify(navAfter));
    console.log('TRANSLATIONUITEST navStable: ' + navStable);
    const ok = state && state.open && state.tagLibraryHidden && state.sidebarHidden && state.aiButtonVisible && state.tags > 0 && !!state.output && /本地翻译/.test(state.status || '') && navStable;
    console.log('TRANSLATIONUITEST stage: ' + (ok ? 'done' : 'failed'));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('TRANSLATIONUITEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

async function runUiTest(deps, imgArg) {
  const { app, BrowserWindow, path, fs } = deps;
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  w.webContents.on('console-message', (e, a, b) => {
    const msg = b !== undefined ? b : (a && a.message ? a.message : a);
    if (String(msg).indexOf('Electron Security') >= 0) return;
    console.log('[page] ' + msg);
  });
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 1500));
    const run = (js) => w.webContents.executeJavaScript(js);
    let perrs = '';
    try { perrs = await run('(window.__errs||[]).join(" ||| ")'); } catch (e) { perrs = 'read-fail'; }
    if (perrs) console.log('UITEST PAGEERRS: ' + perrs);
    const boot = await run('JSON.stringify({ wd: typeof __wdPreprocess, talk: typeof __talkRun, add: typeof __addTalkImg, wb: typeof __wbWorlds, p: typeof __presetList, storage: typeof __storageDiagnostics, stat: (document.querySelector("#talkStatus")||{}).textContent, visGen: document.getElementById("tabGen").style.display, visTalk: document.getElementById("tabTalk").style.display, visVis: document.getElementById("tabVis").style.display, visChat: document.getElementById("tabChat").style.display, visComfy: document.getElementById("tabComfy").style.display, wbActive: (__wbActive()||{}).name || "", preset: (__activePreset()||{}).name || "" })');
    console.log('UITEST boot: ' + boot);
    const cs = await run('JSON.stringify({ g: (composeSystem("gen",{text:"测试"})||"").length, r0: (composeSystem("rk",{text:"测试",phase:0})||"").length, r1: (composeSystem("rk",{text:"测试",phase:1})||"").length, c: (composeSystem("comfy")||"").indexOf("COMFY") >= 0, a: (composeSystem("assist")||"").length, compiler: !!window.__promptCompile, compilerGen: (window.__promptCompile("gen",{text:"测试"})||{}).system.length > 300, synonymStats: !!window.__synonymStats && window.__synonymStats.newChineseAliases > 0, synonymHairTube: __matchTagsForText("束发套").some(t => t.en === "hair_tubes"), synonymBreasts: __matchTagsForText("乳房").some(t => t.en === "breasts"), synonymManual: __matchTagsForText("公主卷").some(t => t.en === "drill hair"), synonymDisplay: __tagZhDisplay({ zh: "钻头卷发", al: ["钻头卷", "螺旋卷", "公主卷", "drill hair"] }) === "钻头卷发 / 钻头卷 / 螺旋卷 / 公主卷" })');
    console.log('UITEST prompt compose: ' + cs);
    const r1 = await run(`(function(){
      const w = __wbActive();
      const single = __wbBuildSingle(w);
      const p1 = __wbParseEntries(JSON.stringify(single));
      const all = __wbBuildAll();
      const multiCount = all.worlds ? all.worlds.length : 0;
      const firstWorldEntries = (all.worlds && all.worlds[0] && all.worlds[0].entries) ? Object.keys(all.worlds[0].entries).length : 0;
      return JSON.stringify({ activeName: (w||{}).name || "", singleEntries: single.entries ? Object.keys(single.entries).length : 0, p1: p1 ? p1.length : 0, multiCount, firstWorldEntries, presetCount: __presetList().length });
    })()`);
    console.log('UITEST wb roundtrip: ' + r1);
    const r2 = await run(`(function(){
      const worldsBefore = __wbWorlds().length;
      const activeBefore = __wbActive() ? __wbActive().id : null;
      const schema = __wbNormalizeEntry({ name: 'schema-test', key: ['蓝发', '蓝发', 'blue_hair'], content: '  内容  ', constant: 'true' });
      const data = { name: 'uitest书', entries: {
        '0': { comment: '测试条目A', key: ['测试A'], content: '内容A', constant: false },
        '1': { comment: '测试条目B', key: ['测试B'], content: '内容B', constant: true, disable: true }
      } };
      const parsed = __wbParseEntries(JSON.stringify(data));
      __wbOpenImportModal(parsed, 'uitest.json');
      const boxes = Array.from(document.querySelectorAll('#wbImportList .wbimp input'));
      const total = boxes.length;
      boxes.forEach((ck, i) => { ck.checked = (i === 0); });
      __wbDoImport();
      const worldsAfter = __wbWorlds().length;
      const activeAfter = __wbActive() ? __wbActive().id : null;
      const newCnt = __wbActive() ? __wbActive().entries.length : 0;
      const hasA = __wbActive().entries.some(e => e.name === '测试条目A');
      const hasB = __wbActive().entries.some(e => e.name === '测试条目B');
      const saved = { worldsBefore, worldsAfter, activeChanged: activeAfter !== activeBefore, newCnt, hasA, hasB, total, modalClosed: !document.getElementById('wbModal').classList.contains('show'), schemaOk: schema && schema.keys.length === 2 && schema.constant === true && schema.content === '内容' };
      __wbWorlds().length = worldsBefore;
      __setActiveWorld(activeBefore);
      return JSON.stringify(saved);
    })()`);
    console.log('UITEST wb import: ' + r2);
    const imgCandidates = [
      imgArg,
      path.join(__dirname, '..', 'node_modules', 'dotenv-expand', 'dotenv-expand.png'),
      path.join(__dirname, '..', 'translation-ui.png')
    ].filter(Boolean);
    const imgPath = imgCandidates.find(p => fs.existsSync(p));
    if (!imgPath) throw new Error('测试图片不存在');
    const buf = fs.readFileSync(imgPath);
    const mime = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';
    const dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
    await run(`(function(){ const b = document.getElementById('aiBtn'); if (b && b.style.display !== 'none') b.click(); __addTalkImg(${JSON.stringify(dataUrl)}, null); const el = document.getElementById('tpIdentify'); if (el) el.click(); })()`);
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const st = await run('document.querySelector("#talkStatus").textContent');
      if (/✅|❌|⚠️/.test(st || '')) break;
    }
    const r3 = await run(`(function(){
      const tpm = document.getElementById('tpModes');
      // 用固定样例验证折叠组件本身，不依赖本机是否安装了 1.3GB 识图模型。
      __showTagPane(${JSON.stringify(dataUrl)}, [{tag:'builtin_a',category:0,prob:.99},{tag:'builtin_b',category:0,prob:.99}], [{tag:'model_a',category:0,prob:.9}], true);
      const mods = tpm ? Array.from(tpm.querySelectorAll('.tp-mod')) : [];
      const builtin = mods.find(m => (m.textContent || '').indexOf('原图内置') >= 0);
      const foldedInitially = !!(builtin && builtin.classList.contains('collapsed'));
      if (builtin) builtin.querySelector('.tpm-head').click();
      const expandedAfterClick = !!(builtin && !builtin.classList.contains('collapsed') && getComputedStyle(builtin.querySelector('.tpm-body')).display !== 'none');
      const tabs = Array.from(document.querySelectorAll('.ai-module-tab'));
      const clickTab = id => { const b = document.getElementById(id); if (b) b.click(); };
      clickTab('aiModuleApi'); const apiState = { api: document.getElementById('tabApi').style.display !== 'none', thumb: document.querySelector('.ai-module-thumb').style.width };
      clickTab('aiModulePrompt'); const promptState = document.getElementById('tabPrompt').style.display !== 'none';
      clickTab('aiModuleTalk'); const talkState = document.getElementById('tabTalk').style.display !== 'none';
      const h = __talkHist();
      const titles = mods.map(m => (m.textContent||''));
      const hasModel = titles.some(t => t && t.indexOf('模型识别') >= 0);
      const status = document.querySelector('#talkStatus').textContent;
      const modeOn = document.querySelector('.tkmode.on');
      const modeThumb = document.getElementById('tkThumb');
      const modeDefault = !!(modeOn && modeOn.dataset.mode === 'assist');
      const modeThumbVisible = !!(modeThumb && parseFloat(getComputedStyle(modeThumb).width) > 0);
      return JSON.stringify({ histN: h.length, paneModel: hasModel, builtinFolded: foldedInitially, builtinToggle: expandedAfterClick, paneHas: tpm ? tpm.querySelectorAll('.wdtag').length : 0, status, apiState, promptState, talkState, modeDefault, modeThumbVisible });
    })()`);
    console.log('UITEST talk identify: ' + r3);
    console.log('UITEST talk cleanup: hist=' + JSON.stringify((await run('__talkHist().length'))));
    const o1 = JSON.parse(r1), o2 = JSON.parse(r2), o3 = JSON.parse(r3), oBoot = JSON.parse(boot), oCs = JSON.parse(cs);
    const identifySettled = /本地识图完成|未找到|推理引擎|模型|未识别到|本地识图失败|仅在桌面版/.test(o3.status || '');
    const ok = oBoot.visGen === 'none' && oBoot.visVis === 'none' && oBoot.visChat === 'none' && oBoot.visComfy === 'none' && oBoot.visTalk === '' && oBoot.storage === 'function' && o1.singleEntries >= 1 && o1.p1 === o1.singleEntries && o1.multiCount >= 1 && o1.presetCount >= 1 && o2.worldsAfter === o2.worldsBefore + 1 && o2.activeChanged && o2.newCnt === 1 && o2.hasA && !o2.hasB && o2.total === 2 && o2.modalClosed && o2.schemaOk && o3.builtinFolded && o3.builtinToggle && o3.paneHas >= 3 && o3.apiState.api && Number(o3.apiState.thumb.replace('px','')) > 0 && o3.promptState && o3.talkState && o3.modeDefault && o3.modeThumbVisible && identifySettled && oCs.g > 300 && oCs.r0 > 100 && oCs.r1 > 300 && oCs.c && oCs.a > 0 && oCs.compiler && oCs.compilerGen && oCs.synonymStats && oCs.synonymHairTube && oCs.synonymBreasts && oCs.synonymManual && oCs.synonymDisplay;
    console.log('UITEST stage: ' + (ok ? 'done' : 'failed'));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('UITEST FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

async function runShot(deps, outArg) {
  const { app, BrowserWindow, path, fs } = deps;
  const w = new BrowserWindow({ width: 1440, height: 980, show: true, x: -3000, y: -3000, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  w.webContents.setBackgroundThrottling(false);
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 1500));
    // 测试图片优先使用历史依赖中的样例；精简发布包没有该依赖时，
    // 回退到随应用分发的翻译页截图，避免 --shot 因测试素材缺失失败。
    const demoCandidates = [
      path.join(__dirname, '..', 'node_modules', 'dotenv-expand', 'dotenv-expand.png'),
      path.join(__dirname, '..', 'translation-ui.png')
    ];
    const demoPath = demoCandidates.find(p => fs.existsSync(p));
    if (!demoPath) throw new Error('测试图片不存在');
    const demoImg = 'data:image/png;base64,' + fs.readFileSync(demoPath).toString('base64');
    await w.webContents.executeJavaScript(`(function(){
      const b = document.getElementById("aiBtn"); if (b) b.click();
      const h = __talkHist();
      h.length = 0;
      h.push({ role:'user', text:'帮我把这张图转成最终提示词', imgs:[{dataUrl:${JSON.stringify(demoImg)}}], imgRef:'【附图组】共 1 张\\n图1：1girl, pov, peeing, spread legs', mode:'gen', ts:Date.now() });
      h.push({ role:'assistant', text:'【最终提示词】\\n1girl, pov, peeing, spread legs, from below, looking down', mode:'gen', ts:Date.now() });
      __addTalkImg(${JSON.stringify(demoImg)}, null);
      __talkRender();
      __talkRenderSidebar();
      const ai = __startAiBubble(talkHist.length);
      ai.think.textContent = '我先把这张图解析为可用 Tag：1girl、pov、peeing、spread legs，再结合仰视视角确定构图。';
      ai.body.textContent = '(思考中…)';
      __showTagPane(${JSON.stringify(demoImg)}, [{tag:'1girl',category:0,prob:.99},{tag:'pov',category:0,prob:.99},{tag:'peeing',category:0,prob:.99}], [{tag:'1girl',category:4,prob:.93},{tag:'pov',category:8,prob:.9},{tag:'peeing',category:9,prob:.86},{tag:'spread legs',category:2,prob:.8},{tag:'looking down',category:2,prob:.72},{tag:'blush',category:2,prob:.68}], true);
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 600));
    const cnt = await w.webContents.executeJavaScript('JSON.stringify({ ai: document.querySelectorAll(".cmsg.ai .cacts .cico").length, user: document.querySelectorAll(".cmsg.user .cacts .cico").length })');
    console.log('SHOT acts: ' + cnt);
    const ictest = await w.webContents.executeJavaScript('(function(){ var s = UI.ic("copy",14); return JSON.stringify({ kids: s.childNodes.length, tag: s.firstChild ? s.firstChild.tagName : null, def: typeof ICONS.copy }); })()');
    console.log('SHOT ictest: ' + ictest);
    const perMsg = await w.webContents.executeJavaScript('(function(){ var out=[]; document.querySelectorAll("#talkConv .cmsg").forEach(function(m){ out.push({ cls:m.className, n:m.querySelectorAll(".cacts .cico").length, icons:Array.from(m.querySelectorAll(".cacts .cico svg")).map(function(s){return s.firstChild?s.firstChild.tagName:"?"}).join(",") }); }); return JSON.stringify(out); })()');
    console.log('SHOT perMsg: ' + perMsg);
    const img = await w.webContents.capturePage();
    const out = outArg || 'shot.png';
    const png = img.toPNG();
    fs.writeFileSync(out, png);
    console.log('SHOT saved: ' + out + ' bytes=' + png.length);
    app.exit(0);
  } catch (e) {
    console.log('SHOT FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

// 视觉回归截图：同时覆盖浅色 / 深色主题，并验证普通、负面、成人标签
// 的选中态仍使用高对比文字与彩色边框，而不是整块高饱和背景。
async function runThemeShot(deps, outArg) {
  const { app, BrowserWindow, path, fs } = deps;
  const w = new BrowserWindow({ width: 1440, height: 980, show: true, x: -3000, y: -3000, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false } });
  w.webContents.setBackgroundThrottling(false);
  try {
    await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 1200));
    const state = await w.webContents.executeJavaScript(`(function(){
      const ns = document.getElementById('nsfwBtn');
      if (ns && !ns.classList.contains('on')) ns.click();
      const read = el => { if (!el) return null; const c = getComputedStyle(el); return { background:c.backgroundColor, border:c.borderColor, color:c.color, boxShadow:c.boxShadow, fontSize:c.fontSize }; };
      const pick = (catSelector, chipSelector) => {
        const cat = document.querySelector(catSelector); if (cat) cat.click();
        const chip = document.querySelector(chipSelector); if (chip) chip.click();
        return read(document.querySelector('.chip.sel'));
      };
      const normal = pick('.cat:not(.neg):not(.nsfw)', '.chip:not(.nsfw):not(.neg)');
      const negative = pick('.cat.neg', '.chip.neg');
      const adult = pick('.cat.nsfw', '.chip.nsfw');
      const adultText = document.querySelector('.chip.nsfw') ? (document.querySelector('.chip.nsfw').innerText || '') : '';
      return { normal, adult, negative, adultText, selected:document.querySelectorAll('.chip.sel').length };
    })()`);
    const base = outArg || path.join(__dirname, '..', 'theme-shot.png');
    const lightPng = (await w.webContents.capturePage()).toPNG();
    fs.writeFileSync(base, lightPng);
    await w.webContents.executeJavaScript(`(function(){
      const p = document.getElementById('themePop');
      const b = p && p.querySelector('[data-theme="dark"]');
      if (b) b.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 250));
    const darkPath = base.replace(/\.png$/i, '-dark.png');
    fs.writeFileSync(darkPath, (await w.webContents.capturePage()).toPNG());
    const darkState = await w.webContents.executeJavaScript(`(function(){
      const el = document.querySelector('.chip.sel'); if (!el) return null;
      const c = getComputedStyle(el); return { background:c.backgroundColor, border:c.borderColor, color:c.color, outline:c.outlineColor, fontSize:c.fontSize };
    })()`);
    console.log('THEMESHOT state: ' + JSON.stringify(state));
    console.log('THEMESHOT darkState: ' + JSON.stringify(darkState));
    console.log('THEMESHOT light: ' + base);
    console.log('THEMESHOT dark: ' + darkPath);
    const ok = state && state.selected >= 1 && state.normal && state.negative && state.adult && state.adultText && darkState && darkState.border;
    console.log('THEMESHOT stage: ' + (ok ? 'done' : 'failed'));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('THEMESHOT FAIL: ' + (e && e.message || e));
    app.exit(1);
  }
}

// 注册测试模式：若进入任一测试模式返回 true
function initTestModes(deps) {
  const { process } = deps;
  const idx = (f) => process.argv.indexOf(f);
  const after = (f) => process.argv[idx(f) + 1];
  if (idx('--pushtest') >= 0) { runPushTest(deps); return true; }
  if (idx('--smoke') >= 0) { runSmoke(deps, after('--smoke'), process.argv[idx('--smoke') + 2]); return true; }
  if (idx('--translationtest') >= 0) { runTranslationTest(deps); return true; }
  if (idx('--translationprompttest') >= 0) { runTranslationPromptTest(deps); return true; }
  if (idx('--errortest') >= 0) { runErrorMessageTest(deps); return true; }
  if (idx('--i18ntest') >= 0) { runI18nTest(deps); return true; }
  if (idx('--timeouttest') >= 0) { runTimeoutTest(deps); return true; }
  if (idx('--secureaitest') >= 0) { runSecureAiTest(deps); return true; }
  if (idx('--imagestoragetest') >= 0) { runImageStorageTest(deps); return true; }
  if (idx('--translationui') >= 0) { runTranslationUiTest(deps, after('--translationui')); return true; }
  if (idx('--uitest') >= 0) { runUiTest(deps, after('--uitest')); return true; }
  if (idx('--shot') >= 0) { runShot(deps, after('--shot')); return true; }
  if (idx('--theme-shot') >= 0) { runThemeShot(deps, after('--theme-shot')); return true; }
  return false;
}

module.exports = { initTestModes };
