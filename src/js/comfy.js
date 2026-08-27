'use strict';
/* ================= ComfyUI 调试模块 ================= */
var COMFY_SLEEP = ms => new Promise(r => setTimeout(r, ms));
function comfyBaseUrl(raw) {
  const u = new URL(String(raw || '').trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error('ComfyUI 地址必须使用 http:// 或 https://');
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = h === 'localhost' || h === '::1' || /^127\./.test(h);
  const privateV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h);
  const localName = h.endsWith('.local');
  if (!loopback && !privateV4 && !localName) throw new Error('出于安全原因，ComfyUI 仅允许连接本机或局域网地址');
  return u;
}
var COMFY = {
  clientId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
  base() { return comfyBaseUrl(aiCfg.comfyBase || 'http://127.0.0.1:8188').toString().replace(/\/+$/, ''); },
  async check() {
    const r = await fetch(this.base() + '/system_stats', { signal: AbortSignal.timeout(4000) });
    return r.ok;
  },
  buildWorkflow(o) {
    return {
      "3": { class_type: 'KSampler', inputs: { seed: o.seed, steps: o.steps, cfg: o.cfg, sampler_name: o.sampler || 'euler', scheduler: o.scheduler || 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      "4": { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: o.ckpt } },
      "5": { class_type: 'EmptyLatentImage', inputs: { width: o.w, height: o.h, batch_size: 1 } },
      "6": { class_type: 'CLIPTextEncode', inputs: { text: o.prompt, clip: ['4', 1] } },
      "7": { class_type: 'CLIPTextEncode', inputs: { text: o.negative, clip: ['4', 1] } },
      "8": { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      "9": { class_type: 'SaveImage', inputs: { filename_prefix: 'aitag', images: ['8', 0] } }
    };
  },
  // 自定义工作流：粘贴的 API 格式 JSON，用 {{占位符}} 替换动态值
  buildWorkflowCustom(jsonText, o) {
    let t = String(jsonText || '');
    const jesc = v => String(v == null ? '' : v)
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    const sub = (k, v) => { t = t.split('{{' + k + '}}').join(jesc(v)); };
    sub('prompt', o.prompt); sub('negative', o.negative); sub('seed', o.seed);
    sub('width', o.w); sub('height', o.h); sub('steps', o.steps); sub('cfg', o.cfg);
    sub('ckpt', o.ckpt); sub('sampler', o.sampler || 'euler'); sub('scheduler', o.scheduler || 'karras');
    try {
      const wf = JSON.parse(t);
      if (!wf || typeof wf !== 'object' || Array.isArray(wf)) throw new Error('工作流必须是节点对象（{"节点id": {class_type, inputs}}）');
      return wf;
    } catch (e) {
      throw new Error('自定义工作流 JSON 解析失败：' + (e && e.message || e));
    }
  },
  viewUrl(img) {
    return this.base() + '/view?filename=' + encodeURIComponent(img.filename || '') + '&subfolder=' + encodeURIComponent(img.subfolder || '') + '&type=' + (img.type || 'output');
  },
  async fetchImage(img) {
    const r = await fetch(this.viewUrl(img), { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('获取图像失败：HTTP ' + r.status);
    const blob = await r.blob();
    const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.onerror = () => res(''); fr.readAsDataURL(blob); });
    if (!dataUrl) throw new Error('图像解码失败');
    return compressDataURL(dataUrl, 1536, 0.9);
  },
  async render(opts) {
    const wf = String(aiCfg.comfyWorkflow || '').trim()
      ? this.buildWorkflowCustom(aiCfg.comfyWorkflow, opts)
      : this.buildWorkflow(opts);
    const r = await fetch(this.base() + '/prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ prompt: wf, client_id: this.clientId }),
      signal: opts.signal
    });
    if (!r.ok) { const t = await r.text(); throw new Error('ComfyUI 提交失败（HTTP ' + r.status + '）：' + t.slice(0, 200)); }
    const j = await r.json();
    if (j.error) throw new Error('ComfyUI 错误：' + JSON.stringify(j.error).slice(0, 300));
    if (!j.prompt_id) throw new Error('ComfyUI 未返回 prompt_id');
    return this.waitDone(j.prompt_id, opts);
  },
  async waitDone(pid, opts) {
    const deadline = Date.now() + 10 * 60 * 1000;
    let last = 0;
    opts = opts || {};
    while (Date.now() < deadline) {
      if (opts.signal && opts.signal.aborted) throw new Error('已停止');
      await COMFY_SLEEP(1500);
      let j = null;
      try {
        const r = await fetch(this.base() + '/history/' + pid, { signal: AbortSignal.timeout(5000) });
        j = await r.json();
      } catch (e) {}
      if (j && j[pid] && j[pid].outputs) {
        for (const nodeId of Object.keys(j[pid].outputs)) {
          const out = j[pid].outputs[nodeId];
          if (out && out.images && out.images.length) {
            const im = out.images[0];
            const dataUrl = await this.fetchImage(im);
            return { filename: im.filename, subfolder: im.subfolder, type: im.type, viewUrl: this.viewUrl(im), dataUrl };
          }
        }
        continue;
      }
      if (opts.onProgress && Date.now() - last > 3000) {
        last = Date.now();
        let remain = null;
        try {
          const q = await (await fetch(this.base() + '/queue', { signal: AbortSignal.timeout(4000) })).json();
          if (q) remain = (q.queue_running || []).length + (q.queue_pending || []).length;
        } catch (e) {}
        opts.onProgress(remain);
      }
    }
    throw new Error('ComfyUI 生成超时（10 分钟未返回图像）');
  }
};
function comfyParseCommands(text) {
  const out = [];
  const re = /<<COMFY>>([\s\S]*?)<<END>>/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1].trim());
  return out;
}
function comfyParseRender(cmd) {
  if (!/^render\b/i.test(String(cmd).trim())) return null;
  const rest = String(cmd).trim().replace(/^render\b\s*:?\s*/i, '');
  const res = { prompt: '', negative: '', size: null, seed: null, steps: null, cfg: null, sampler: null, scheduler: null };
  const promptParts = [];
  for (const raw of rest.split('|')) {
    const s = raw.trim();
    if (!s) continue;
    const m = s.match(/^(negative|size|seed|steps|cfg|sampler|scheduler)\s*[:=]\s*([\s\S]+)$/i);
    if (m) {
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'negative') res.negative = v;
      else if (k === 'size') { const mm = v.match(/(\d+)\s*[x×]\s*(\d+)/i); if (mm) res.size = { w: +mm[1], h: +mm[2] }; }
      else if (k === 'seed') res.seed = parseInt(v) || 0;
      else if (k === 'steps') res.steps = Math.max(1, parseInt(v) || aiCfg.comfySteps);
      else if (k === 'cfg') res.cfg = parseFloat(v) || aiCfg.comfyCfg;
      else if (k === 'sampler') res.sampler = v;
      else if (k === 'scheduler') res.scheduler = v;
    } else promptParts.push(s);
  }
  res.prompt = promptParts.join(', ').replace(/\s+/g, ' ').trim();
  return res;
}
var COMFY_OPS = `【ComfyUI 绘图能力】本工具已连接本机 ComfyUI；你可以通过指令调用它生成图像，并把结果图自动发给你查看：
1. 需要绘图/改图时，在回复中输出（一次回复最多一条，独占一行）：
   <<COMFY>>RENDER: <正向提示词Tag> | negative: <负面Tag> | size: 768x1024 | seed: 42 | steps: 25 | cfg: 7 <<END>>
   说明：正向提示词为英文逗号分隔的 Tag；negative / size / seed / steps / cfg 均可省略并取默认值；seed 省略时随机。
2. 图像生成后本工具会把结果图自动发给你（附带当时 prompt）；请认真查看，分析画面与目标的差距后给出修改说明。
3. 【用户附图优先】用户附图时，工具会把图片与「用户附图 · 本地识图 Tag」一并放进你的输入——改图/复刻需求请直接基于该图与 Tag 分析并输出 RENDER，不要使用 LIST / RELOAD 去找图。
4. 会话中最近一次渲染的图像也会自动发给你；处理"改进已有图"类需求（改色调/表情/动作/构图等）时优先基于它，修改提示词后直接 RENDER。
5. 只有用户明确要求"查看/选择列表里的某张图"时才用 <<COMFY>>LIST<<END>> / <<COMFY>>RELOAD: 文件名<<END>>；RELOAD 文件不存在（或 _temp 临时图）会失败，工具会提示，此时请改用列表中的真实文件名或直接描述需求，不要反复列表。
6. 改图类需求需要图生图(img2img)工作流（含 LoadImage / VAEEncode 节点）；若当前工作流是纯文生图导致无法改图，请直接说明并建议用户使用含 LoadImage 的工作流。
7. 不要假设命令已执行；未输出指令时，正常回复文字即可。`;
var COMFY_TASK_LOOP = `【本次任务：ComfyUI 自动调试循环】用户会给出画面需求（可能附图作为改图基准）。
执行步骤：
1. 生成 【最终提示词】（Tag，含质量前缀，按基础规则），并简述你的思路。
2. 输出一条 <<COMFY>>RENDER: … <<END>> 指令开始渲染。
3. 收到渲染图像后：分析画面与要求的差距（角色/构图/细节/风格/缺失或多余的 Tag），说明问题并修改提示词，然后再次 RENDER 尝试改进。
4. 反复迭代，直到效果达标或达到最大次数；最后一次回复必须以这两段收尾（并不要输出 RENDER）：
   【调试结论】（简短总结：迭代了几次、主要改动、最终效果）
   【最终提示词】（用代码块包裹的最终版 Tag 串）
如果用户需求是修改已有图（改色调/表情/动作/构图等）：直接基于用户附图（及识图 Tag）或最近渲染图分析，修改提示词并 RENDER，不要使用 LIST/RELOAD 找图；若工作流是纯文生图无法改图，请明确说明并建议切换含 LoadImage 的 img2img 工作流。
如果用户给了明确的最大次数限制，请在其限制内完成。`;
var COMFY_TASK_ASSIST = `【本次任务：ComfyUI 助手调试】当前为助手（调试）模式：
- 不强制输出任何固定格式，不强制生成提示词；用户会附图（改图基准）、粘贴/描述想调试的提示词或提出修改要求，你负责分析、提出修改建议、按需调用 ComfyUI 验证效果。
- 用户附图（含识别出的 Tag）优先作为基准；最近渲染的图也会自动发给你。需要看效果时输出 <<COMFY>>RENDER: … <<END>>；收到图后指出问题，等待用户决定下一步。
- 语言简洁专业；除非用户要求，不必输出【最终提示词】区块。`;
var comfyMsgs = [], comfyIter = 0, comfyRenders = 0, comfyBusy = false, comfyAbort = null, comfyLastText = '';
var comfyPendingImgs = [], comfyImgMetas = [];
function comfyRefreshImgs() {
  renderImgRow(comfyImgRow, comfyPendingImgs, i => { comfyPendingImgs.splice(i, 1); comfyImgMetas.splice(i, 1); comfyRefreshImgs(); });
}
function addComfyImg(url, meta) {
  if (comfyPendingImgs.length >= 3) return toast('一次最多 3 张图片');
  comfyPendingImgs.push(url);
  comfyImgMetas.push(meta || null);
  comfyRefreshImgs();
}
var COMFY_INTRO = '在下方输入需求（可先点「📷 图片」上传一张改图基准图，图片会连同本地识图 Tag 一并发给 AI），点「▶ 开始调试」：AI 生成 Tag → 调用 ComfyUI 渲染 → 分析返图 → 修正提示词，自动循环最多「最大迭代」次，最后给出【调试结论】与【最终提示词】。勾选调试模式后为助手模式：不强制格式，适合你手动粘贴提示词反复试。';
function comfySys() {
  let s = effectiveSys();
  s += '\n\n【质量词与画师（默认前缀，提示词开头必须使用）】\n' + effectiveQp();
  const wb = wbEntriesFor(comfyLastText || '', 'comfy');
  if (wb.length) s += '\n\n【拓展提示词（补充规则，优先级高于基础提示词中冲突的部分）】' + wbBlock(wb);
  s += '\n\n' + (state.nsfwOn ? NSFW_ALLOW : NSFW_GUARD);
  const cand = matchTagsForText(comfyLastText || '');
  if (cand.length) {
    s += '\n\n【标签库相关候选（参考用，不必全部使用，仅选用与需求相关的）】\n' +
      cand.slice(0, 120).map(t => t.en + (t.zh ? '（' + t.zh + '）' : '')).join(', ');
  }
  s += '\n\n' + COMFY_OPS;
  s += '\n\n' + COMFY_TASK_LOOP;
  return s;
}
function comfySetStatus(s) { comfyStatus.textContent = s; }
comfyConv.addEventListener('scroll', () => pinFollow(comfyConv));
function comfyAddMsg(kind, text, opts) {
  opts = opts || {};
  const d = document.createElement('div');
  d.className = 'cmsg ' + kind;
  const who = { user: '👤 用户', ai: '🤖 AI', sys: 'ℹ️ 系统', err: '⚠️ 错误', rst: '🖼 结果' }[kind] || '';
  const body = document.createElement('div');
  body.className = 'body';
  body.textContent = String(text == null ? '' : text);
  if (who) { const w = document.createElement('div'); w.className = 'who'; w.textContent = who; d.appendChild(w); }
  d.appendChild(body);
  if (opts.imgs && opts.imgs.length) {
    const row = document.createElement('div'); row.className = 'imgs';
    for (const it of opts.imgs) {
      const a = document.createElement('a');
      a.href = it.viewUrl || it.url; a.target = '_blank'; a.title = it.filename || '点击查看原图';
      const img = document.createElement('img'); img.src = it.dataUrl || it.url; img.alt = it.filename || '';
      a.appendChild(img); row.appendChild(a);
    }
    d.appendChild(row);
  }
  comfyConv.appendChild(d);
  autoScroll(comfyConv); // 智能跟随：仅当用户停留在底部时才自动滚到底
  return { bubble: d, body };
}
async function comfyAiTalk(msgs, bubbleBody) {
  let full = '';
  const upd = () => {
    if (bubbleBody) { bubbleBody.textContent = full; autoScroll(comfyConv); }
  };
  await chatComplete(msgs, {
    stream: true, signal: comfyAbort ? comfyAbort.signal : undefined,
    // 只累计正文 content：思考过程(reasoning)不进消息体，避免污染指令解析与后续上下文
    onDelta: (c) => { if (c) { full += c; upd(); } }
  });
  upd();
  return full;
}
async function comfyRun(mode) {
  if (comfyBusy) return toast('正在调试中，请先停止');
  readCfg();
  if (!aiCfg.model) return toast('请先在「⚙️ API 设置」里填写模型名');
  if (!aiCfg.comfyOn) return toast('请先在「⚙️ API 设置 → ComfyUI」勾选「启用 ComfyUI 迭代」');
  const text = comfyIn.value.trim();
  if (!comfyMsgs.length) {
    if (!text && !comfyPendingImgs.length) return toast('请输入调试需求，或附上一张基准图片');
    comfyLastText = text || '（用户仅提供图片）';
    comfyIter = 0; comfyRenders = 0;
    // 附图：先本地识图取 Tag，再把图片 + Tag + 需求一并发给 AI
    const userImgs = comfyPendingImgs.slice();
    const userMetas = comfyImgMetas.slice();
    let wdTags = [];
    if (userImgs.length) {
      comfySetStatus('🔍 本地识图提取基准图 Tag…');
      for (let i = 0; i < userImgs.length; i++) {
        const meta = userMetas[i];
        if (meta && meta.tags && meta.tags.length) wdTags.push(...metaToTags(meta));
        else if (window.aiTag) { try { const t = await runLocalTag(userImgs[i]); if (t && t.length) wdTags.push(...t); } catch (e) {} }
      }
    }
    let userText = text;
    if (wdTags.length) {
      userText += '\n\n【用户附图 · 本地识图 Tag（基准信息）】\n' + wdTagsText(wdTags);
    } else if (userImgs.length && !userText.trim()) {
      userText = '【用户附图已随本条消息发送，请查看并结合需求分析】';
    }
    comfyAddMsg('user', text || (userImgs.length ? '（附图基准）' : ''));
    if (wdTags.length) comfyAddMsg('sys', '🔍 已识别基准图 Tag：' + wdTagsText(wdTags).slice(0, 220));
    comfyMsgs = [{ role: 'system', content: comfySys() }, { role: 'user', content: contentParts(userText, userImgs) }];
    comfyIn.value = '';
    comfyPendingImgs = []; comfyImgMetas = []; comfyRefreshImgs();
  } else if (text || comfyPendingImgs.length) {
    // 续轮：新输入（可附图）追加为一条用户消息
    let msg = text;
    const imgs = comfyPendingImgs.slice();
    const metas = comfyImgMetas.slice();
    if (imgs.length) {
      let wdTags = [];
      for (let i = 0; i < imgs.length; i++) {
        const meta = metas[i];
        if (meta && meta.tags && meta.tags.length) wdTags.push(...metaToTags(meta));
        else if (window.aiTag) { try { const t = await runLocalTag(imgs[i]); if (t && t.length) wdTags.push(...t); } catch (e) {} }
      }
      if (wdTags.length) msg += '\n\n【用户附图 · 本地识图 Tag】\n' + wdTagsText(wdTags);
      comfyAddMsg('sys', '🔍 已识别基准图 Tag：' + wdTagsText(wdTags).slice(0, 220));
    }
    comfyAddMsg('user', text || (imgs.length ? '（附图基准）' : ''));
    comfyMsgs.push({ role: 'user', content: contentParts(msg, imgs) });
    comfyIn.value = '';
    comfyPendingImgs = []; comfyImgMetas = []; comfyRefreshImgs();
  }
  let ok = false;
  comfySetStatus('正在连接 ComfyUI…');
  try { ok = await COMFY.check(); } catch (e) {}
  if (!ok) {
    comfySetStatus('❌ ' + (typeof appErrorSummary === 'function' ? appErrorSummary('ComfyUI 连接失败', 'ComfyUI') : ('ComfyUI 连接失败（' + aiCfg.comfyBase + '）')));
    comfyAddMsg('err', typeof formatAppError === 'function' ? formatAppError('ComfyUI 连接失败', 'ComfyUI') : ('无法连接 ComfyUI：' + (aiCfg.comfyBase || '未填地址') + '。请确认 ComfyUI 已启动并监听该地址。'));
    return;
  }
  if (!String(aiCfg.comfyWorkflow || '').trim()) {
    comfySetStatus('需要工作流');
    comfyAddMsg('err', '尚未设置工作流：请上传 / 拖入 / 粘贴工作流 JSON 或含工作流的 PNG 图片。');
    return;
  }
  comfyBusy = true; comfyAbort = new AbortController();
  comfyGo.disabled = comfyStep.disabled = true; comfyStop.style.display = '';
  // 每轮（每次点击开始/单步）都重置迭代计数：本轮拥有完整「最大迭代」预算。
  // 修复：此前 comfyIter 为会话累计值，第二轮开头 while(comfyIter < limit) 直接为假 → 卡住不动。
  comfyIter = 0; comfyRenders = 0;
  const maxIters = Math.max(1, parseInt(aiCfg.comfyIters) || 3);
  const limit = mode === 'step' ? 1 : maxIters;
  try {
    while (comfyIter < limit) {
      comfyIter++;
      comfySetStatus('第 ' + comfyIter + ' / ' + maxIters + ' 次 · 🤖 AI 思考中…');
      const el = comfyAddMsg('ai', '');
      const reply = await comfyAiTalk(comfyMsgs, el.body);
      comfyMsgs.push({ role: 'assistant', content: reply });
      const cmds = comfyParseCommands(reply);
      const renderCmd = cmds.find(c => /^render\b/i.test(c));
      if (cmds.length && !renderCmd) {
        // LIST / RELOAD：先处理（本工具直接给出列表，并入会话）
        const listCmd = cmds.find(c => /^list\b/i.test(c));
        const reloadCmd = cmds.find(c => /^reload\b/i.test(c));
        if (listCmd || reloadCmd) {
          let outs = [];
          try {
            const r = await fetch(COMFY.base() + '/history?max_items=20', { signal: AbortSignal.timeout(6000) });
            outs = await r.json();
          } catch (e) {}
          const names = [];
          for (const pid of Object.keys(outs || {})) {
            const item = outs[pid];
            for (const n of Object.keys((item && item.outputs) || {})) {
              const imgs = (item.outputs[n] || {}).images || [];
              for (const im of imgs) if (im && im.filename) names.push(im.filename);
            }
          }
          if (reloadCmd) {
            const fn = reloadCmd.replace(/^reload\b\s*:?\s*/i, '').trim();
            if (fn) {
              const img = { filename: fn, subfolder: '', type: 'output' };
              try {
                img.dataUrl = await COMFY.fetchImage(img);
                img.viewUrl = COMFY.viewUrl(img);
                comfyAddMsg('rst', '加载图像：' + fn, { imgs: [img] });
                comfyMsgs.push({ role: 'user', content: contentParts('这是 ComfyUI 输出图 ' + fn + '，请查看并分析。', [img.dataUrl]) });
                comfySetStatus('第 ' + comfyIter + ' 次 · 图已载入，AI 分析中…');
                continue;
              } catch (e) {
                comfySetStatus('⚠️ ' + (typeof formatAppError === 'function' ? formatAppError('图像加载失败', 'ComfyUI 图像') : '图像加载失败'));
                comfyAddMsg('err', '无法加载图像 ' + fn + '（可能不存在或被删除，临时图 _temp 无效）。');
                comfyMsgs.push({ role: 'user', content: '无法加载图像 ' + fn + '（文件不存在/临时图无效）。请从下面列表里选一个真实存在的文件名输出 RELOAD，或直接描述需求（推荐直接处理最近渲染的图）。' });
                continue;
              }
            }
          }
          const latest = names[0] || '';
          comfyAddMsg('sys', 'ComfyUI 最近图像（最新 → 旧）：\n' + (names.slice(0, 12).join(', ') || '（暂无）') + (latest ? '\n最新一张：' + latest : ''));
          comfyMsgs.push({ role: 'user', content: 'ComfyUI 最近图像列表（最新 → 旧）：' + (names.slice(0, 12).join(', ') || '（暂无）') + (latest ? '。最新一张是 ' + latest + '。' : '') + ' 如需查看某张输出 RELOAD: 文件名；否则建议直接基于最新一张（或用户附图）分析，不要反复列表。' });
          continue;
        }
      }
      if (!renderCmd) break; // AI 未要求渲染，会话结束
      // 渲染
      const p = comfyParseRender(renderCmd);
      if (!p.prompt && !aiCfg.comfyPos) {
        comfyAddMsg('err', 'RENDER 指令缺少正向提示词（已忽略该条指令）。');
        comfyMsgs.push({ role: 'user', content: '你的 RENDER 指令缺少正向提示词，请重新输出格式正确的 RENDER 指令（或给出最终提示词并停止）。' });
        continue;
      }
      comfySetStatus('第 ' + comfyIter + ' 次 · 🎨 ComfyUI 渲染中…');
      let img = null, renderErr = '';
      try {
        img = await COMFY.render({
          prompt: p.prompt || aiCfg.comfyPos || '',
          negative: p.negative || aiCfg.comfyNeg || '',
          seed: p.seed != null && p.seed !== 0 ? p.seed : Math.floor(Math.random() * 1e9),
          w: p.size ? p.size.w : aiCfg.comfyW, h: p.size ? p.size.h : aiCfg.comfyH,
          steps: p.steps || aiCfg.comfySteps, cfg: p.cfg || aiCfg.comfyCfg,
          sampler: p.sampler, scheduler: p.scheduler,
          signal: comfyAbort ? comfyAbort.signal : undefined
        });
      } catch (e) {
        renderErr = (e && e.message) || String(e);
        if (comfyAbort && comfyAbort.signal.aborted) throw e;
      }
      if (renderErr) {
          comfyAddMsg('err', typeof formatAppError === 'function' ? formatAppError(renderErr, 'ComfyUI 渲染') : ('渲染失败：' + renderErr));
        comfySetStatus('第 ' + comfyIter + ' 次 · 渲染失败，请调整后继续');
        comfyMsgs.push({ role: 'user', content: 'ComfyUI 渲染失败：' + renderErr + '。请修正后重试（或给出文字结论，不要重复相同指令）。' });
        continue;
      }
      comfyRenders++;
      const showPrompt = (p.prompt || '').slice(0, 400) + (p.negative ? '\n负面：' + p.negative.slice(0, 200) : '');
      comfyAddMsg('rst', '第 ' + comfyIter + ' 次渲染完成' + (p.seed ? ' · seed=' + p.seed : '') + (showPrompt ? '\n' + showPrompt : ''), { imgs: [img] });
      comfySetStatus('第 ' + comfyIter + ' 次 · 图像已返回，AI 分析中…');
      comfyMsgs.push({
        role: 'user',
        content: contentParts('这是 ComfyUI 第 ' + comfyRenders + ' 次渲染的图像（seed=' + (p.seed != null && p.seed !== 0 ? p.seed : '随机') + '；prompt：' + (p.prompt || '').slice(0, 500) + '）。请分析画面与目标的差距；如需改进请输出修改后的 RENDER 指令；若满意或已到你的判断上限，请输出【调试结论】与【最终提示词】并停止。', [img.dataUrl])
      });
      if (mode === 'step') break;
      // 达到最大迭代上限时，再让 AI 就结果做一次总结（不再执行渲染）
      if (comfyIter >= maxIters) {
        const el2 = comfyAddMsg('ai', '');
        const reply2 = await comfyAiTalk(comfyMsgs, el2.body);
        comfyMsgs.push({ role: 'assistant', content: reply2 });
        break;
      }
    }
    if (comfyAbort && comfyAbort.signal.aborted) {
      comfyAddMsg('sys', '已停止（第 ' + comfyIter + ' 次）。');
      comfySetStatus('已停止');
    } else {
      comfySetStatus(mode === 'step' ? '⏯ 单步完成（已渲染 ' + comfyRenders + ' 次）· 可修改输入后点「单步」继续，或点「开始调试」自动循环' : '✅ 调试完成（AI 迭代 ' + comfyIter + ' 次 · 渲染 ' + comfyRenders + ' 次）');
    }
  } catch (e) {
    if (comfyAbort && comfyAbort.signal.aborted) {
      comfyAddMsg('sys', '已停止（第 ' + comfyIter + ' 次）。');
      comfySetStatus('已停止');
    } else {
      comfyAddMsg('err', aiError(e));
      comfySetStatus('⚠️ 出错');
    }
  } finally {
    comfyBusy = false; comfyAbort = null;
    comfyGo.disabled = comfyStep.disabled = false; comfyStop.style.display = 'none';
  }
}
async function comfyTestConn() {
  readCfg();
  comfyTest.innerHTML = '<span class="spin"></span> 测试中…'; comfyTest.disabled = true;
  try {
    let ok = false;
    try { ok = await COMFY.check(); } catch (e) {}
    if (ok) {
      comfySetStatus('✅ ComfyUI 连接正常（' + aiCfg.comfyBase + '）');
      toast('ComfyUI 连接成功 ✓');
    } else {
      const msg = typeof formatAppError === 'function' ? formatAppError('ComfyUI 连接失败', 'ComfyUI') : 'ComfyUI 连接失败，请检查地址与服务';
      comfySetStatus('❌ ' + msg);
      toast(msg);
    }
  } finally {
    comfyTest.innerHTML = '🔌 测试连接'; comfyTest.disabled = false;
  }
}
function comfyClearAll() {
  comfyMsgs = []; comfyIter = 0; comfyRenders = 0; comfyIn.value = '';
  comfyPendingImgs = []; comfyImgMetas = []; comfyRefreshImgs();
  comfyConv.replaceChildren();
  const d = document.createElement('div');
  d.className = 'cmsg sys';
  const b = document.createElement('div'); b.className = 'body'; b.textContent = COMFY_INTRO;
  d.appendChild(b); comfyConv.appendChild(d);
  comfySetStatus('已清空 · ComfyUI 未连接');
  toast('已清空调试会话');
}
async function comfyProbe() {
  readCfg();
  if (!aiCfg.comfyOn) { if (!comfyBusy) comfySetStatus('未开始 · 未启用（在「⚙️ API 设置 → ComfyUI」勾选启用）'); return; }
  comfySetStatus('正在连接 ComfyUI…');
  let ok = false;
  try { ok = await COMFY.check(); } catch (e) {}
  if (comfyBusy) return;
  if (ok) comfySetStatus('✅ ComfyUI 已连接（' + aiCfg.comfyBase + '）');
  else comfySetStatus('❌ ' + (typeof appErrorSummary === 'function' ? appErrorSummary('ComfyUI 连接失败', 'ComfyUI') : ('ComfyUI 连接失败（' + aiCfg.comfyBase + '）')));
}
comfyGo.onclick = () => comfyRun('auto');
comfyStep.onclick = () => comfyRun('step');
comfyImgBtn.onclick = () => comfyImgFile.click();
comfyImgFile.addEventListener('change', () => {
  for (const f of Array.from(comfyImgFile.files || [])) {
    if (f.size > 10 * 1024 * 1024) { toast('图片过大（>10MB）已跳过'); continue; }
    fileToDataURL(f).then(async url => { if (url) addComfyImg(url, await pngMetaFromFile(f).catch(() => null)); });
  }
  comfyImgFile.value = '';
});
comfyStop.onclick = () => { if (comfyAbort) comfyAbort.abort(); };
comfyClear.onclick = comfyClearAll;
comfyTest.onclick = comfyTestConn;
// 同步工作流设置：读取 ComfyUI 最近一次执行的工作流，把设置同步回本页表单
comfyWfSync.onclick = async () => {
  readCfg();
  comfyWfSync.innerHTML = '<span class="spin"></span> 同步中…'; comfyWfSync.disabled = true;
  try {
    let j = null;
    try { j = await (await fetch(COMFY.base() + '/prompt', { signal: AbortSignal.timeout(6000) })).json(); } catch (e) {}
    const wf = j && j.prompt;
    if (!wf || typeof wf !== 'object' || !Object.keys(wf).length) {
      toast('ComfyUI 暂无已执行的工作流记录：请先在 ComfyUI 页面运行一次（把工作流 Ctrl+V 载入后点 Run），再回来同步');
      return;
    }
    wfApplyImport(JSON.stringify(wf));
    toast('已同步 ComfyUI 最近执行的工作流设置到当前页');
  } finally {
    comfyWfSync.innerHTML = '🔄 同步工作流设置'; comfyWfSync.disabled = false;
  }
};
comfyWfClear.onclick = () => { comfyWf.value = ''; readCfg(); toast('已清空工作流'); };

/* ---------- 工作流：上传 / 自动占位符 / 复制 / 打开 ComfyUI ---------- */
function wfParse(text) {
  let wf;
  try { wf = JSON.parse(text); } catch (e) { throw new Error('工作流 JSON 解析失败：' + (e && e.message || e)); }
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) throw new Error('工作流必须是 API 格式节点对象（{"节点id": {"class_type": …, "inputs": …}}）');
  return wf;
}
// 识别标准文生图节点 → 注入占位符并返回初值
function wfImportApi(text0) {
  const wf = wfParse(text0);
  const entries = Object.entries(wf).filter(([, v]) => v && v.inputs);
  // 兼容 KSampler / KSamplerAdvanced / (Efficient) 等各种采样器
  const ks = entries.find(([, v]) => /^KSampler/.test(String(v.class_type))) || entries.find(([, v]) => /KSampler/i.test(String(v.class_type)));
  let pos = '', neg = '', w = '', h = '', steps = '', cfg = '', seed = '';
  let mutated = false;
  const setText = (nodeId, ph) => {
    const nd = wf[nodeId];
    if (nd && nd.inputs && typeof nd.inputs.text === 'string') {
      const val = nd.inputs.text;
      nd.inputs.text = '{{' + ph + '}}';
      mutated = true;
      return val;
    }
    return '';
  };
  const linkNode = l => (Array.isArray(l) && l.length >= 1) ? l[0] : null;
  if (ks) {
    const [n, v] = ks;
    pos = setText(linkNode(v.inputs.positive), 'prompt');
    neg = setText(linkNode(v.inputs.negative), 'negative');
    for (const [f, ph, key] of [['steps', 'steps', 's'], ['cfg', 'cfg', 'c'], ['seed', 'seed', 'd']]) {
      if (v.inputs[f] !== undefined) {
        const val = v.inputs[f];
        if (ph === 'steps') steps = (typeof val === 'string' ? parseInt(val) : val) || 25;
        else if (ph === 'cfg') cfg = (typeof val === 'string' ? parseFloat(val) : val) || 7;
        else seed = String(val);
        v.inputs[f] = '{{' + ph + '}}';
        mutated = true;
      }
    }
    const ln = linkNode(v.inputs.latent_image);
    if (ln && wf[ln] && wf[ln].inputs) {
      const li = wf[ln].inputs;
      if (li.width !== undefined) { w = li.width; li.width = '{{width}}'; mutated = true; }
      if (li.height !== undefined) { h = li.height; li.height = '{{height}}'; mutated = true; }
    }
  }
  if (!mutated) {
    // 识别不到标准参数节点也照样导入（不加占位符），表单不控制，交给用户
    return { text: JSON.stringify(wf, null, 2), pos: '', neg: '', w: '', h: '', steps: '', cfg: '', seed: '', found: false };
  }
  return { text: JSON.stringify(wf, null, 2), pos, neg, w, h, steps, cfg, seed, found: true };
}
function wfRenderValues() {
  return {
    prompt: comfyPos.value || '',
    negative: comfyNeg.value || '',
    w: parseInt(comfyW.value) || 768,
    h: parseInt(comfyH.value) || 1024,
    steps: parseInt(comfySteps.value) || 25,
    cfg: parseFloat(comfyCfg.value) || 7
  };
}
function wfSubstituted(text, vals) {
  let t = String(text || '');
  // JSON 安全转义：占位符值里若含引号/换行/反斜杠，直接拼接会破坏 JSON
  const jesc = v => String(v == null ? '' : v)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  const sub = (k, v) => { t = t.split('{{' + k + '}}').join(jesc(v)); };
  sub('prompt', vals.prompt); sub('negative', vals.negative); sub('seed', vals.seed);
  sub('width', vals.w); sub('height', vals.h); sub('steps', vals.steps); sub('cfg', vals.cfg);
  sub('sampler', vals.sampler || 'euler'); sub('scheduler', vals.scheduler || 'karras');
  return t;
}
function wfApplyImport(text0) {
  try {
    const r = wfImportApi(text0);
    comfyWf.value = r.text;
    comfyPos.value = String(r.pos != null ? r.pos : '');
    comfyNeg.value = String(r.neg != null ? r.neg : '');
    if (r.w !== '') comfyW.value = r.w;
    if (r.h !== '') comfyH.value = r.h;
    if (r.steps !== '') comfySteps.value = r.steps;
    if (r.cfg !== '') comfyCfg.value = r.cfg;
    readCfg();
    if (r.found) {
      toast('工作流已导入：自动注入占位符，请在上方表单修改参数');
      comfySetStatus('工作流已就绪（' + Object.keys(JSON.parse(r.text)).length + ' 个节点）');
    } else {
      toast('工作流已导入（未找到标准采样器/提示词节点，表单暂不生效，可直接编辑 JSON 或换 API 格式工作流）');
      comfySetStatus('工作流已加载（' + Object.keys(JSON.parse(r.text)).length + ' 个节点，无占位符）');
    }
  } catch (e) {
      toast(typeof formatAppError === 'function' ? formatAppError(e, '导入 ComfyUI 工作流') : ('导入失败：' + (e && e.message || e)));
  }
}
function comfyWfCopy2Clip() {
  readCfg();
  const text = comfyWf.value.trim();
  if (!text) return toast('工作流为空，请先上传 / 粘贴 / 导入');
  let out = text;
  try {
    const vals = wfRenderValues();
    vals.seed = Math.floor(Math.random() * 1e9);
    out = wfSubstituted(text, vals);
    JSON.parse(out);
  } catch (e) { out = text; }
  copyText(out, '已复制工作流（已填入当前参数，可在 ComfyUI 页面 Ctrl+V 载入）');
}
async function comfyWfOpenPage() {
  readCfg();
  let base;
  try { base = COMFY.base(); } catch (e) { return toast(typeof formatAppError === 'function' ? formatAppError(e, 'ComfyUI 地址') : ((e && e.message) || String(e))); }
  const text = comfyWf.value.trim();
  if (!text) { window.open(base, '_blank'); return toast('工作流为空，已打开 ComfyUI 页面'); }
  // 组装"填入当前参数"的完整工作流
  let wfText = text;
  try {
    const vals = wfRenderValues();
    vals.seed = Math.floor(Math.random() * 1e9);
    wfText = wfSubstituted(text, vals);
    JSON.parse(wfText);
  } catch (e) { wfText = text; }
  // 推送：应用内打开 ComfyUI 窗口并载入工作流 + 写入提示词
  if (window.aiTag && window.aiTag.pushComfyWorkflow) {
    comfyWfOpen.disabled = true;
    try {
      const r = await window.aiTag.pushComfyWorkflow({
        url: base,
        workflowJson: wfText,
        prompt: aiCfg.comfyPos || '',
        negative: aiCfg.comfyNeg || ''
      });
      if (r && r.ok) {
        toast('已推送到 ComfyUI 窗口：工作流已载入，正向/负面提示词已写入对应节点');
        comfySetStatus('已推送工作流到 ComfyUI（' + (r.nodes || '?') + ' 节点）');
        return;
      }
      toast((typeof formatAppError === 'function' ? formatAppError((r && r.msg) || '未知错误', '推送 ComfyUI 工作流') : ('推送失败：' + ((r && r.msg) || '未知错误'))) + '；已复制工作流，请手动 Ctrl+V');
    } catch (e) {
      toast((typeof formatAppError === 'function' ? formatAppError(e, '推送 ComfyUI 工作流') : ('推送不可用：' + (e && e.message || e))) + '；已复制工作流，请手动 Ctrl+V');
    } finally {
      comfyWfOpen.disabled = false;
    }
  }
  // 兜底：复制 + 外部浏览器打开
  try { copyText(wfText, '已复制工作流（在 ComfyUI 页面 Ctrl+V 载入）'); } catch (e) {}
  window.open(base, '_blank');
}
comfyWfJson.onclick = () => comfyWfJsonFile.click();
comfyWfJsonFile.addEventListener('change', () => {
  const f = comfyWfJsonFile.files && comfyWfJsonFile.files[0];
  if (f) { const fr = new FileReader(); fr.onload = () => wfApplyImport(String(fr.result || '')); fr.readAsText(f); }
  comfyWfJsonFile.value = '';
});
comfyWfPng.onclick = () => comfyWfPngFile.click();
comfyWfPngFile.addEventListener('change', () => {
  const f = comfyWfPngFile.files && comfyWfPngFile.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    const dataUrl = String(fr.result || '');
    const t = parsePngTextChunks(dataUrl);
    const api = t && t.prompt;
    if (!api) return toast('该 PNG 未内嵌 API 格式工作流（prompt 块）；请在 ComfyUI 用「Workflow → Export (API)」导出 JSON 后上传');
    wfApplyImport(api);
  };
  fr.readAsDataURL(f);
  comfyWfPngFile.value = '';
});
comfyWfCopy.onclick = comfyWfCopy2Clip;
comfyWfOpen.onclick = comfyWfOpenPage;

/* ---------- 拖入工作流 / 含工作流的图片（ComfyUI 页签全域） ---------- */
var tabComfyEl = $('#tabComfy');
tabComfyEl.addEventListener('dragover', e => {
  if (!(e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0)) return;
  e.preventDefault(); e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
});
// 输入区附近拖入图片 = 基准图（先于全局工作流拖放处理）
var comfyInZone = $('#comfyIn');
comfyInZone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
comfyInZone.addEventListener('drop', e => {
  e.preventDefault(); e.stopPropagation();
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  for (const f of Array.from(files)) {
    if (String(f.type || '').indexOf('image/') === 0) {
      if (f.size > 10 * 1024 * 1024) { toast('图片过大（>10MB）已跳过'); continue; }
      fileToDataURL(f).then(async url => { if (url) addComfyImg(url, await pngMetaFromFile(f).catch(() => null)); });
    } else toast('此处只接收图片（基准图）；请把工作流拖到上方「🎛 工作流」区域');
  }
});
tabComfyEl.addEventListener('drop', e => {
  e.preventDefault(); e.stopPropagation();
  readCfg();
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  const f = files[0];
  const name = String(f.name || '').toLowerCase();
  if (name.endsWith('.json') || String(f.type || '').indexOf('json') >= 0) {
    const fr = new FileReader();
    fr.onload = () => { wfApplyImport(String(fr.result || '')); comfyWfOpenPage(); };
    fr.readAsText(f);
  } else if (String(f.type || '').indexOf('image/') === 0) {
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = String(fr.result || '');
      const t = parsePngTextChunks(dataUrl);
      const api = t && t.prompt;
      if (!api) { toast('该图片未内嵌工作流（缺少 prompt 块）；已把它当作基准图'); addComfyImg(dataUrl); return; }
      wfApplyImport(api);
      comfyWfOpenPage();
    };
    fr.readAsDataURL(f);
  } else {
    toast('请拖入工作流 JSON 或含工作流的图片（PNG）');
  }
});
