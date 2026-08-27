'use strict';
/* ================= 附图编号与识别（多组图片可稳定引用：图片1..N + 每图识图 Tag） ================= */
async function imgRefBlock(imgs, metas) {
  const per = [];
  const objs = [];
  const lines = ['【附图组 共' + imgs.length + '张】（编号规则：图片1=第1张、图片2=第2张……图片顺序与消息内附件一致）'];
  for (let i = 0; i < imgs.length; i++) {
    let tags = [];
    const meta = metas && metas[i];
    if (meta && meta.tags && meta.tags.length) tags = metaToTags(meta);
    else if (window.aiTag) {
      try { const t = await runLocalTag(imgs[i]); if (t && t.length) tags = t; } catch (e) {}
    }
    const tt = wdTagsText(tags);
    per.push(tt);
    objs.push(tags);
    lines.push('图片' + (i + 1) + '：' + (tt || '（未能识别）'));
  }
  return { ref: lines.join('\n'), per, objs };
}
// 同时提取「原图内置 Tag」与「模型识别 Tag」两套（本地识图用，分模块展示）
async function tagExtract(imgs, metas) {
  const out = [];
  for (let i = 0; i < imgs.length; i++) {
    const item = { builtin: [], model: [] };
    const meta = metas && metas[i];
    if (meta && meta.tags && meta.tags.length) item.builtin = metaToTags(meta);
    if (window.aiTag) {
      try { const t = await runLocalTag(imgs[i]); if (t && t.length) item.model = t; }
      catch (e) { item.error = e && e.message ? e.message : String(e); }
    }
    out.push(item);
  }
  return out;
}
// 渲染一个 Tag 模块（标题 + 芯片）—— 组件模板
function tagModule(title, tags) { return UI.tagModule(title, tags); }
// 同步兜底（老对话数据没有 imgRef 时保证仍有编号说明）
function imgRefFallback(imgs) {
  const c = imgs.length;
  return '【附图组 共' + c + '张】（编号规则：图片1=第1张、图片2=第2张……图片顺序与消息内附件一致）\n' +
    imgs.map((u, i) => '图片' + (i + 1) + '：附件第' + (i + 1) + '张').join('\n');
}
