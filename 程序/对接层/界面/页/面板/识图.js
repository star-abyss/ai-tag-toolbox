// 识图面板：左边"要处理哪一张"，右边结果按类别分组。
//
// 三条路分开摆，因为它们的输入与失败表现都不一样（模块自己也是这么分的）：
//   认图     要本地识图模型（离线，不花钱）
//   读元数据 不要模型，只要字节（解 PNG 的文字块）
//   看图     要一条能看图的链路；界面这一侧现在没有（DSH 的模型调用没接），
//            所以那一个按钮会如实报缺，不假装能用。
//
// **动作名用模块自己那层的**（`认图` / `读元数据` / `看图`）：交付面上的 `动作` 就是它，
// 门面认的也是它。`模型侧` 那套（`detect` / `metadata` / `ask`）只属于工具注册表。
//
// 布局按 布局.md 的乙式：顶栏（上传）/ 身子两栏 / 无底栏。
import { 造, 清, 画回执, 画一个参数, 吐司 } from '../顺手.js';

const 模块 = 'vision';
const 图片 = 'image';
/** 出词顺序住在标签模块里（一份页序），识图这一格不自己排。 */
const 标签模块 = 'tag';

/** 现在要处理的那张图：先看面板上挑的，再看向上一位交下来的。 */
function 手上那张(上下文, 挑的) {
  return 挑的 || (上下文 && 上下文.接过来 ? 上下文.接过来() : null);
}

/**
 * 识图模块的三个动作收的是**扁平**的图引用：存放地 / 条目ID / 会话ID。
 * 交出 `{ 引用 }` 那一种它不认（它会回 VISION_BAD_REF），所以这里摊平。
 */
function 摊引用(一) {
  const 引用 = 一 && 一.引用 ? 一.引用 : 一;
  const 作用域 = (引用 && 引用.作用域) || {};
  const 出 = { 条目ID: 引用 && 引用.条目ID };
  if (作用域.存放地) 出.存放地 = 作用域.存放地;
  if (作用域.会话ID) 出.会话ID = 作用域.会话ID;
  return 出;
}

/** 概率写成人看的百分数：模块给 0~1 就是比例，给 0~100 就直接用。 */
function 概率(值) {
  if (值 === undefined || 值 === null) return '';
  const 数 = Number(值);
  if (!Number.isFinite(数)) return String(值);
  return `${(数 <= 1 ? 数 * 100 : 数).toFixed(1)}%`;
}

export default function 造识图面板({ 宿主, 模子 }) {
  return {
    名: 'vision',
    标题: '识图',
    副题: '本地打标 · 读元数据 · 交给模型看图',
    要的模块: [模块],

    画(墙, 上下文) {
      let 挑的 = null;
      /** 候选：识图工作区那张 + 图库里的那些。 */
      let 库里的 = [];
      const 结果们 = [];

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 文件框 = 造('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      const 上传钮 = 造('button.钮.主', { type: 'button' }, '上传一张…');
      上传钮.addEventListener('click', () => 文件框.click());
      文件框.addEventListener('change', 传一张);
      const 刷库 = 造('button.钮.幽灵', { type: 'button' }, '重列（工作区 + 图库）');
      刷库.addEventListener('click', 列库);
      顶.append(造('div.横排', 造('span.伸'), 刷库, 上传钮), 文件框);

      // ---------- 身子 ----------

      const 左 = 造('section', { style: { minWidth: '0' } });
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏', 左, 右));
      墙.append(顶, 身);

      // ---- 左：工作区那张图 ----
      const 图块 = 造('div.工作区');
      图块.append(造('div.栏头', 造('h3', '现在这一张'), 造('span.伸')));
      const 图框 = 造('div.图框');
      图块.append(图框);
      const 图说明 = 造('div.图说明');
      图块.append(图说明);

      const 挑行 = 造('div.块底');
      const 库选 = 造('select');
      挑行.append(库选);
      图块.append(挑行);
      左.append(图块);

      /** 画"现在手上是哪一张"。 */
      function 画现条() {
        清(图框);
        清(图说明);
        const 一 = 手上那张(上下文, 挑的);
        if (!一 || !一.引用) {
          图框.append(造('div.无', '还没有图。可以从下面挑一张、上传一张，或者去「图片」面板点"把这一张交给后面的面板"。'));
          return;
        }
        图框.append(造('img', { src: 一.缩略 || 宿主.缩略图地址(一.引用, 640), alt: '现在这一张' }));
        const 作用域 = 一.引用.作用域 || {};
        图说明.append(造('span.标签.主', 一.说明 || String(一.引用.条目ID)));
        图说明.append(造('span.码', `${作用域.存放地 || ''} · ${一.引用.条目ID}`));
      }

      // ---- 左：三个动作 ----
      const 做块 = 造('div.工作区', { style: { marginTop: '12px' } });
      做块.append(造('div.栏头', 造('h3', '怎么认这一张')));
      做块.append(造('div.细节',
        `本地模型：${(宿主.桌.模型 && 宿主.桌.模型.这次用.vision) || '（没有装好的识图模型）'} · 在顶上的模型条换`));

      const 打标参 = {};
      for (const 名 of ['阈值', '上限']) {
        const 一 = 宿主.参数(模块, '认图', 名);
        if (!一) continue;
        const { 元, 取值 } = 画一个参数(一);
        打标参[名] = 取值;
        做块.append(元);
      }
      const 打标钮 = 造('button.钮.主', { type: 'button' }, '认图');
      const 元钮 = 造('button.钮', { type: 'button' }, '读元数据');
      const 看钮 = 造('button.钮', { type: 'button' }, 'AI 识图');
      做块.append(造('div.块底', 打标钮, 元钮, 看钮));
      做块.append(造('div.细节', '「AI 识图」要 DSH 的模型调用；这一侧没接，所以它会如实报缺。'));
      左.append(做块);

      // ---- 右：结果按类别分组 ----
      const 结块 = 造('div.工作区');
      结块.append(造('div.栏头', 造('h3', '结果'), 造('span.伸'), 造('span.数', '按类别分组')));
      const 结放 = 造('div');
      结放.append(造('div.空', '认一次就会按类别摆在这儿：原图内置 Tag · 模型识别 Tag · 元数据。'));
      结块.append(结放);
      右.append(结块);

      /** 开一块结果区：标题 + 一个「复制」钮 + 一块放卡片的地方。交回的那一份要用它记行。 */
      function 开一块(标题, 数, 说) {
        const 块 = 造('div', { style: { marginBottom: '12px' } });
        const 复制 = 造('button.钮.小.幽灵', { type: 'button' }, '复制');
        块.append(造('div.栏头', 造('h3', 标题), 造('span.数', 数 || ''), 造('span.伸'), ...(说 ? [造('span.标签', 说)] : []), 复制));
        const 放 = 造('div');
        块.append(放);
        const 区 = { 块, 放, 复制, 行: [] };
        结果们.push(区);
        return 区;
      }

      /** 一行结果：词 · 中文名 · 概率。 */
      function 画一行(区, 词, 译, 值) {
        const 行 = 造('div.条');
        行.append(造('span.名', 词 || '（空）'));
        行.append(造('span.伸'));
        行.append(造('span', 译 || ''));
        if (值 !== '' && 值 !== undefined) 行.append(造('span.标签', 概率(值)));
        区.放.append(行);
        区.行.push(`${词}${译 ? `（${译}）` : ''}`);
      }

      /** 把三块结果清掉。 */
      function 清结果() {
        结果们.length = 0;
        清(结放);
      }

      /** 认图：按类别分组的那种画法（模块给 `分组` 就按它，没给就合成一块）。 */
      async function 画认图(回) {
        清结果();
        const 分组 = Array.isArray(回.分组) && 回.分组.length
          ? 回.分组
          : [{ 类别: '模型识别 Tag', 标签: (回.标签 || []).map((一) => ({ 词: 一.词 || 一.标签, 中文名: 一.中文名, 概率: 一.概率 ?? 一.分数 })) }];
        // 词序走标签模块的「渲染顺序」（作品 → 发色 → 其他外貌 → 服装……）。
        // 打标的先后是概率高低，粘进提示词要的是出词顺序 —— 排序递给标签模块，这一格不自己排。
        const 排好的 = await 排一遍(分组.flatMap((组) => (组.标签 || 组.成员 || []).map((一) => 一.词 || 一.标签 || 一.名称)));
        for (const 组 of 分组) {
          const 标签 = 组.标签 || 组.成员 || [];
          if (!标签.length) continue;
          const 区 = 开一块(组.类别 || 组.名 || '标签', `${标签.length} 个`);
          区.复制.addEventListener('click', () => 复制一段(区.行.join(', '), 组.类别 || '标签'));
          for (const 二 of 标签) 画一行(区, 二.词 || 二.标签 || 二.名称, 二.中文名, 二.概率 ?? 二.分数);
          结放.append(区.块);
        }
        // 再给一块"按出词顺序排好的"：直接能粘进提示词
        if (排好的.length) {
          const 区 = 开一块('按渲染顺序排好的', `${排好的.length} 个`);
          区.复制.addEventListener('click', () => 复制一段(区.词们.join(', '), '排好的词'));
          const 行 = 造('div.细节', { style: { lineHeight: '1.7', wordBreak: 'break-all' } }, 排好的.map((一) => 一.词).join(', '));
          区.放.append(行);
          区.行.push(...排好的.map((一) => 一.词));
          区.词们 = 排好的.map((一) => 一.词);
          结放.append(区.块);
        }
        const 尾 = 造('div.细节');
        if (回.总数 !== undefined) 尾.append(`过了阈值的共 ${回.总数} 个 · 阈值 ${回.阈值}　`);
        if (回.模型) 尾.append(`模型：${typeof 回.模型 === 'string' ? 回.模型 : JSON.stringify(回.模型)}`);
        if (尾.textContent) 结放.append(尾);
        if (!结果们.length) 结放.append(造('div.空', '这一张一个标签都没打出来。'));
      }

      /**
       * 把一批词交给标签模块排一次（表一：页序 → 类序 → 格内序）。
       * 模块没回话就原样返回，不挡住识图这条路。
       */
      async function 排一遍(词们) {
        const 净 = (词们 || []).filter(Boolean);
        if (!净.length) return [];
        const { 回 } = await 宿主.调(标签模块, 'render.sort', { 词们: 净 });
        if (Array.isArray(回)) return 回;
        return 净.map((词) => ({ 词, 页名: null, 在库里: false }));
      }

      /** 读元数据：正负提示词各一块。 */
      function 画元数据(回) {
        清结果();
        const 加一段 = (标题, 文本) => {
          if (!文本) return;
          const 区 = 开一块(标题, `${String(文本).length} 字`);
          区.复制.addEventListener('click', () => 复制一段(String(文本), 标题));
          const 盒 = 造('div', {
            style: { padding: '8px', background: 'var(--板硬)', border: '1px solid var(--线)', borderRadius: 'var(--圆)', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: '11px' },
          }, String(文本));
          区.放.append(盒);
          区.行.push(String(文本));
          结放.append(区.块);
        };
        加一段('正向提示词（原图内置）', 回.提示词);
        加一段('负向提示词（原图内置）', 回.负向提示词);
        const 尾 = 造('div.细节');
        if (回.尺寸) 尾.append(`尺寸 ${JSON.stringify(回.尺寸)}　`);
        if (回.工作流) 尾.append('图里带一份工作流（见底下的回执）　');
        if (回.参数) 尾.append(`参数 ${JSON.stringify(回.参数)}`);
        if (尾.textContent) 结放.append(尾);
        if (!结果们.length) 结放.append(造('div.空', '这张图里没有内置提示词。'));
      }

      async function 复制一段(文, 什么) {
        if (!文) return;
        try { await navigator.clipboard.writeText(文); 吐司(`复制了${什么}`, '成', 1600); } catch (_) { 吐司('复制不了', '错'); }
      }

      // ---------- 候选那张下拉 ----------

      async function 列库() {
        清(库选).append(造('option', { value: '' }, '读着…'));
        // 两处都列：识图工作区是单张槽位，就是"这次要识的那张"；图库是能顺手拿来识的那些。
        const [工, 库] = await Promise.all([
          宿主.调(图片, '列', { 作用域: { 存放地: 'vision' } }),
          宿主.调(图片, '列', { 作用域: { 存放地: 'gallery' } }),
        ]);
        const 坏 = [];
        const 收 = (包, 哪) => {
          const 回 = 包 && 包.回;
          if (!回 || 回.ok === false) { 坏.push(`${哪}：${(回 && 回.reason) || '没回话'}`); return []; }
          return (回.条目 || []).map((一) => ({ ...一, 哪 }));
        };
        const 工作的 = 收(工, '工作区');
        库里的 = [...工作的, ...收(库, '图库')];
        清(库选);
        库选.append(造('option', { value: '' }, 库里的.length ? '（挑一张）' : '（两处都没有图）'));
        for (const 一 of 库里的) {
          库选.append(造('option', { value: String(一.标识) },
            `${一.哪} · ${一.标识} · ${一.完整 === false ? '不完整' : '完整'}`));
        }
        if (坏.length) 库选.append(造('option', { value: '' }, `有一处读不出来：${坏.join('；')}`));
        if (!库里的.length) return;
        // 手上还没有图：工作区里那张就是它（那格恒 0 或 1 张）；没有的话，只有一张候选也就是它。
        const 现在 = 手上那张(上下文, 挑的);
        if (!现在 || !现在.引用) {
          const 一 = 工作的[0] || (库里的.length === 1 ? 库里的[0] : null);
          if (一) {
            挑的 = { 引用: 一.引用, 说明: String(一.标识), 缩略: 宿主.缩略图地址(一.引用, 640) };
            库选.value = String(一.标识);
            画现条();
          }
        }
      }

      库选.addEventListener('change', () => {
        const 一 = 库里的.find((x) => String(x.标识) === 库选.value);
        挑的 = 一 ? { 引用: 一.引用, 说明: String(一.标识), 缩略: 宿主.缩略图地址(一.引用, 640) } : null;
        画现条();
      });

      async function 传一张() {
        const 文件 = 文件框.files && 文件框.files[0];
        if (!文件) return;
        let 字节;
        try {
          字节 = await new Promise((成, 败) => {
            const 读 = new FileReader();
            读.onload = () => 成(String(读.result));
            读.onerror = () => 败(new Error('读不出这个文件'));
            读.readAsDataURL(文件);
          });
        } catch (错) { 吐司(String((错 && 错.message) || 错), '错'); return; }
        // 上传的图落进「识图工作区」：那一格是单张槽位（图片模块 R-F-12），
        // 写入方负责先把上一张清掉，再存这一张。
        const { 回: 清回 } = await 宿主.调(图片, '清空', { 作用域: { 存放地: 'vision' } });
        if (清回 && 清回.ok === false) { 吐司(`清不掉工作区里上一张：${清回.reason || '没回话'}`, '错'); return; }
        const { 回 } = await 宿主.存图({ 作用域: { 存放地: 'vision' }, 字节, 文件名: 文件.name, mime: 文件.type || undefined, 来源: 'upload' });
        if (!回 || 回.ok === false) { 吐司(`存不上：${(回 && 回.reason) || '没回话'}`, '错'); return; }
        挑的 = 回.引用 ? { 引用: 回.引用, 说明: 文件.name } : null;
        await 列库();
        if (挑的 && 挑的.引用) 库选.value = String(挑的.引用.条目ID);
        画现条();
      }

      /** 一句话的拦阻：画在面板里，不弹窗。 */
      function 说一句(话) {
        清结果();
        结放.append(造('div.提示.警', 话));
      }

      // ---------- 三个动作 ----------

      打标钮.addEventListener('click', async () => {
        const 一 = 手上那张(上下文, 挑的);
        if (!一 || !一.引用) { 说一句('先挑一张图：从左边挑一张、上传一张，或者去「图片」面板把一张交给这块。'); return; }
        打标钮.disabled = true;
        打标钮.textContent = '打着…';
        清结果();
        结放.append(造('div.装填', '本地模型打着（第一次要装模型，之后一张约 1 秒）…'));
        const 参数 = { ...摊引用(一) };
        for (const [名, 取值] of Object.entries(打标参)) { const v = 取值(); if (v !== undefined) 参数[名] = v; }
        const { 回, 耗时 } = await 宿主.调(模块, '认图', 参数);
        打标钮.disabled = false;
        打标钮.textContent = '认图';
        if (回 && 回.ok !== false && (Array.isArray(回.标签) || Array.isArray(回.分组))) 画认图(回);
        else { 清结果(); 结放.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 })); }
      });

      元钮.addEventListener('click', async () => {
        const 一 = 手上那张(上下文, 挑的);
        if (!一 || !一.引用) { 说一句('先挑一张图：从左边挑一张、上传一张，或者去「图片」面板把一张交给这块。'); return; }
        元钮.disabled = true;
        清结果();
        结放.append(造('div.装填', '解 PNG 的文字块…'));
        const { 回, 耗时 } = await 宿主.调(模块, '读元数据', 摊引用(一));
        元钮.disabled = false;
        if (回 && 回.ok !== false) 画元数据(回);
        else { 清结果(); 结放.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 })); }
      });

      看钮.addEventListener('click', async () => {
        const 一 = 手上那张(上下文, 挑的);
        if (!一 || !一.引用) { 说一句('先挑一张图：从左边挑一张、上传一张，或者去「图片」面板把一张交给这块。'); return; }
        看钮.disabled = true;
        清结果();
        结放.append(造('div.装填', '问模型…'));
        const { 回, 耗时 } = await 宿主.调(模块, '看图', 摊引用(一));
        看钮.disabled = false;
        清结果();
        结放.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
      });

      if (上下文 && 上下文.盯着) 上下文.盯着(() => 画现条());
      画现条();
      列库();
    },
  };
}
