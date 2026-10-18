// 图片面板：一个选择器 —— 左边存放地与收藏分类，中间图卡片墙，底下已选栏。
//
// 三个存放地（图库 / 会话 / 识图工作区）走同一套：`列` 拿条目 → **只拿缩略图** → 铺卡片。
// 详情（宽高 · 文件名 · 显示名 · 元数据）不当场取：几百条一起取会把宿主压住，
// 而且缩略图墙本来就不需要它。要看一条就点开。
//
// 一条要紧的事实：`列` 只给 4 个键（引用 / 标识 / 修改时间 / 完整），宽高与文件名都要
// `取详情`。所以卡片上先只有标识与时间，点开才有全的。
//
// 大图永远不进 JSON：缩略图走 `/缩略图`、原图走 `/字节`，两条都是 GET。
import { 造, 清, 画回执, 一个动作钮, 说字节, 说时间, 吐司, 要人填, 分段 } from '../顺手.js';

const 模块 = 'image';
const 存放地们 = ['gallery', 'session', 'vision'];
const 存放地说法 = { gallery: '图库', session: '会话图', vision: '识图工作区' };

function 钮话(宿主, 动作, 兜底) {
  const 摘 = 宿主.摘要(模块, 动作);
  const 头 = 摘 ? 摘.split(/[:：]/)[0].trim() : '';
  return 头 || 兜底 || 动作;
}

export default function 造图片面板({ 宿主, 模子, 交出去, 接过来 }) {
  return {
    名: 'image',
    标题: '图片',
    副题: '图的存放与取回 · 归属写在路径里，所以不需要引用计数',
    要的模块: [模块],

    画(墙, 上下文) {
      const 状态 = {
        存放地: 'gallery',
        选中: new Map(),      // 标识 → 条目
        类: null,             // 左边点中的收藏分类
        条目: [],
        代数: 0,
      };
      const 还作数 = (这一趟) => 这一趟 === 状态.代数;

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 文件框 = 造('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
      const 上传钮 = 造('button.钮.主', { type: 'button' }, '上传图…');
      上传钮.addEventListener('click', () => 文件框.click());
      文件框.addEventListener('change', () => 传图([...文件框.files]));
      const 重列钮 = 造('button.钮', { type: 'button' }, 钮话(宿主, '列', '重列'));
      重列钮.addEventListener('click', () => 列一地(状态.存放地));
      const 体检钮 = 造('button.钮.幽灵', { type: 'button' }, 钮话(宿主, '维护.报告', '体检'));
      const 体检放 = 造('div');
      体检钮.addEventListener('click', async () => {
        体检钮.disabled = true;
        const { 回, 耗时 } = await 宿主.调(模块, '维护.报告', {});
        体检钮.disabled = false;
        清(体检放).append(画回执({ 回, 耗时, 模子, 收起: true }));
      });

      const 地条 = 分段(
        存放地们.map((一) => ({ 值: 一, 话: 存放地说法[一] })),
        'gallery',
        (值) => 列一地(值),
      );
      顶.append(造('div.横排', 造('span.伸'), 体检钮, 重列钮, 上传钮), 造('div.分段条', 地条.元), 体检放, 文件框);

      // ---------- 身子 ----------

      const 左 = 造('aside');
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏.窄左', 左, 右));

      // ---------- 底栏 ----------

      const 底 = 造('div.墙底');
      const 底数 = 造('span.数');
      const 复制 = 造('button.钮', { type: 'button' }, '复制引用');
      const 存藏 = 造('button.钮', { type: 'button' }, '存进收藏');
      const 交出去钮 = 造('button.钮', { type: 'button' }, '交给后面的面板');
      const 删 = 造('button.钮.危', { type: 'button' }, '删');
      const 清空 = 造('button.钮.幽灵', { type: 'button' }, '清空');
      底.append(底数, 造('span.伸'), 清空, 删, 交出去钮, 存藏, 复制);

      墙.append(顶, 身, 底);

      /** 底栏跟着已选重画。 */
      function 画底() {
        const 几 = 状态.选中.size;
        底数.textContent = 几 ? `已选 ${几} 个` : '一个都没选';
        复制.disabled = !几;
        存藏.disabled = !几;
        交出去钮.disabled = 几 !== 1;
        删.disabled = 几 !== 1;
      }

      /** 一条的标识。 */
      const 标识们 = () => [...状态.选中.values()].map((一) => 一.标识);

      function 点卡片(一) {
        const 键 = String(一.标识);
        if (状态.选中.has(键)) 状态.选中.delete(键);
        else 状态.选中.set(键, 一);
        画底();
        for (const 卡 of 右.querySelectorAll('.卡片')) {
          卡.setAttribute('aria-selected', String(状态.选中.has(String(卡.dataset.标识))));
        }
      }

      /** 造一张图卡片：缩略图 + 标识 + 时间。 */
      function 一张图卡(一) {
        const 卡 = 造('div.卡片', { dataset: { 标识: String(一.标识) }, style: { padding: '0', gap: '0' } });
        const 框 = 造('div.图框', { style: { border: '0', borderRadius: '0', minHeight: '110px' } });
        if (一.完整 === false) {
          框.append(造('div.无', '这个条目不完整'));
        } else {
          框.append(造('img', {
            alt: String(一.标识),
            loading: 'lazy',
            src: 宿主.缩略图地址(一.引用, 320),
          }));
        }
        const 说明 = 造('div', { style: { padding: '6px 8px', borderTop: '1px solid var(--线)' } });
        说明.append(造('div.名', { title: String(一.标识) }, String(一.标识)));
        说明.append(造('div.译', 说时间(一.修改时间) || '（没有时间）'));
        卡.append(框, 说明);
        卡.setAttribute('aria-selected', String(状态.选中.has(String(一.标识))));
        卡.addEventListener('click', () => 点卡片(一));
        return 卡;
      }

      // ---------- 取数 ----------

      /** 列一个存放地。 */
      async function 列一地(地) {
        const 这一趟 = 状态.代数 + 1;
        状态.代数 = 这一趟;
        状态.存放地 = 地;
        状态.选中.clear();
        状态.类 = null;
        画底();
        地条.选(地);
        清(右).append(造('div.装填', '读目录…'));
        清(左).append(造('div.装填', '读收藏表…'));
        const [{ 回, 耗时 }, { 回: 藏 }, { 回: 类 }] = await Promise.all([
          宿主.调(模块, '列', { 作用域: { 存放地: 地 } }),
          宿主.调(模块, '表.收藏', { 动作: '读' }),
          宿主.调(模块, '表.分类', { 动作: '读' }),
        ]);
        if (!还作数(这一趟)) return;
        清(右);
        if (!回 || 回.ok === false) {
          右.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          状态.条目 = [];
          画左栏(藏, 类);
          return;
        }
        状态.条目 = 回.条目 || [];
        右.append(造('div.栏头',
          造('h2', 存放地说法[地]),
          造('span.伸'),
          造('span.数', `共 ${回.总数} 条 · 列目录 ${耗时 < 1 ? '<1' : Math.round(耗时)} 毫秒`)));
        if (!状态.条目.length) {
          右.append(造('div.空', 地 === 'gallery'
            ? '这个存放地是空的。上传几张就能用。'
            : 地 === 'session' ? '会话图由对话那边放进来。' : '识图工作区一次只留一张。'));
        } else {
          const 格 = 造('div.卡片们');
          右.append(格);
          for (const 一 of 状态.条目) 格.append(一张图卡(一));
          右.append(造('div.细节', { style: { marginTop: '10px' } },
            '卡片上是缩略图（宿主现缩）。宽高与文件名点开一条才有，列目录不给那几样。'));
        }
        画左栏(藏, 类);
      }

      /** 左栏：收藏的类 + 与图片有关的动作。 */
      function 画左栏(藏, 类) {
        清(左);
        左.append(造('div.栏头', 造('h2', '收藏分类'), 造('span.伸')));
        const 收藏着 = Array.isArray(藏) && 状态.选中.size === 1 && 藏.includes(Number(标识们()[0]));
        const 表 = 类 && 类.ok !== false ? Object.entries(类) : [];
        if (!表.length) {
          左.append(造('div.空', '还没有分类。'));
        } else {
          const 栏 = 造('div.类栏');
          for (const [类ID, 一类] of 表) {
            const 项 = 造('button.类项', { type: 'button' });
            项.append(造('span.名', 一类.名 || 类ID));
            项.append(造('span.数', String((一类.成员 || []).length)));
            项.addEventListener('click', () => 点一类(类ID, 一类));
            栏.append(项);
          }
          左.append(栏);
        }
        const 建 = 造('button.钮.幽灵', { type: 'button', style: { marginTop: '6px' } }, '＋ 建一个分类');
        建.addEventListener('click', 建分类);
        左.append(建);

        const 块 = 造('div.块', { style: { marginTop: '12px' } });
        块.append(造('h3', '这一张'));
        if (状态.选中.size !== 1) {
          块.append(造('div.细节', '挑一张（只挑一张）才谈得上收藏与分类。'));
        } else {
          const 一 = [...状态.选中.values()][0];
          块.append(造('div.细节', { style: { marginBottom: '6px' } }, `现在手上：#${一.标识}`));
          const 藏钮 = 造('button.钮', { type: 'button' }, 收藏着 ? '取消收藏' : '收藏');
          藏钮.addEventListener('click', async () => {
            藏钮.disabled = true;
            const { 回 } = await 宿主.调(模块, '表.收藏', { 动作: 收藏着 ? '去' : '加', 标识: String(一.标识) });
            藏钮.disabled = false;
            if (回 && 回.ok === false) { 吐司(`不成：${回.reason}`, '错'); return; }
            await 列一地(状态.存放地);
          });
          块.append(造('div.钮组', 藏钮));
        }
        块.append(造('div.块底', 造('span.细节', 状态.选中.size === 1 ? '也可以按底下的「存进收藏」' : '按底下的钮批量走')));
        左.append(块);

        const 看 = 造('button.钮.幽灵', { type: 'button', style: { marginTop: '12px' } }, '看这一条的详情');
        看.addEventListener('click', () => {
          if (状态.选中.size === 1) 开详情([...状态.选中.values()][0]);
          else 吐司('挑一张（只挑一张）再看详情', '警');
        });
        左.append(看);
      }

      /** 看一个收藏分类里的图。 */
      async function 点一类(类ID, 一类) {
        const 这一趟 = 状态.代数 + 1;
        状态.代数 = 这一趟;
        状态.类 = { ID: 类ID, 一类 };
        清(右).append(造('div.装填', `读着「${一类.名 || 类ID}」…`));
        const 名单 = 一类.成员 || [];
        if (!名单.length) {
          清(右).append(造('div.空', '这个分类是空的。'));
          return;
        }
        // 分类里存的是标识，详情一条都没有：按标识从当前那一地里挑出来。
        const 对上 = 名单.map((标) => 状态.条目.find((一) => String(一.标识) === String(标))).filter(Boolean);
        清(右);
        右.append(造('div.栏头',
          造('h2', 一类.名 || 类ID),
          造('span.伸'),
          造('span.数', `${名单.length} 个成员 · 这一地里找得到 ${对上.length} 个`)));
        if (!对上.length) {
          右.append(造('div.空', `这些成员不在「${存放地说法[状态.存放地]}」这一地里。`));
          return;
        }
        const 格 = 造('div.卡片们');
        右.append(格);
        for (const 一 of 对上) 格.append(一张图卡(一));
      }

      // ---------- 建分类 ----------

      async function 建分类() {
        const 名框 = 造('input', { type: 'text', placeholder: '分类名' });
        const 结果 = await 要人填({
          标题: '建一个分类',
          身: 造('div.字段', 造('div.标', '分类名'), 名框),
          确定: '建',
          要: () => 名框.value.trim(),
        });
        if (!结果) return;
        const { 回 } = await 宿主.调(模块, '表.分类', { 动作: '建类', 名: 结果 });
        if (回 && 回.ok === false) 吐司(`建不了：${回.reason}`, '错');
        else 吐司(`建好了：${结果}`, '成');
        await 列一地(状态.存放地);
      }

      // ---------- 上传 ----------

      function 读成dataUrl(文件) {
        return new Promise((成, 败) => {
          const 读 = new FileReader();
          读.onload = () => 成(String(读.result));
          读.onerror = () => 败(new Error('读不出这个文件'));
          读.readAsDataURL(文件);
        });
      }

      async function 传图(文件们) {
        if (!文件们.length) return;
        const 放 = 造('div.块', { style: { marginTop: '10px' } });
        放.append(造('h3', `上传 ${文件们.length} 个`));
        清(体检放).append(放);
        for (const 文件 of 文件们) {
          const 行 = 造('div.条');
          const 尾 = 造('span.耗时', '传着…');
          行.append(造('span.名', 文件.name), 造('span.伸'), 尾);
          放.append(行);
          try {
            const 字节 = await 读成dataUrl(文件);
            // 识图工作区是单张槽位（图片模块 R-F-12）：写入方先把上一张清掉，再存这一张。
            if (状态.存放地 === 'vision') {
              const { 回: 清回 } = await 宿主.调(模块, '清空', { 作用域: { 存放地: 'vision' } });
              if (清回 && 清回.ok === false) {
                尾.textContent = '';
                行.append(造('span.标签.错', `清不掉上一张：${清回.reason || '没回话'}`));
                continue;
              }
            }
            const { 回, 耗时 } = await 宿主.存图({
              作用域: { 存放地: 状态.存放地 },
              字节,
              文件名: 文件.name,
              mime: 文件.type || undefined,
              来源: 'upload',
            });
            if (回 && 回.ok === false) {
              尾.textContent = '';
              行.append(造('span.标签.错', 回.reason || '存不上'));
            } else {
              尾.textContent = `好了 · ${说字节((字节.length * 3) / 4)} · ${Math.round(耗时)} 毫秒`;
            }
          } catch (错) {
            尾.textContent = '';
            行.append(造('span.标签.错', String((错 && 错.message) || 错)));
          }
        }
        await 列一地(状态.存放地);
      }

      // ---------- 详情（要人填那种小框，不占身子） ----------

      async function 开详情(一) {
        const { 回: 版, 耗时 } = await 宿主.调(模块, '取详情', { 引用: 一.引用 });
        if (!版 || 版.ok === false) {
          吐司(`取不到详情：${(版 && 版.reason) || '没回话'}（${耗时} 毫秒）`, '错');
          return;
        }
        const 身框 = 造('div');
        const 图框 = 造('div.图框');
        图框.append(造('img', { src: 宿主.图地址(一.引用, 'original'), alt: 版.文件名 || String(一.标识) }));
        身框.append(图框);
        const dl = 造('dl');
        const 加 = (k, v) => { dl.append(造('dt', k), 造('dd', v)); };
        加('标识', String(版.标识));
        加('文件名', 版.文件名 || '（空）');
        加('尺寸', `${版.宽}×${版.高}`);
        加('大小', 说字节(版.字节数));
        加('类型', 版.mime || '（空）');
        加('来源', 版.来源 || '（空）');
        加('变体', Object.keys(版.变体 || {}).join(' · ') || '（只有原图）');
        加('创建', 说时间(版.创建时间));
        加('更新', 说时间(版.更新时间));
        const 元 = 版.元数据 && Object.keys(版.元数据).length ? JSON.stringify(版.元数据, null, 2) : '（空）';
        加('元数据', 造('span.码', 元));
        身框.append(造('div.细节', { style: { marginTop: '10px' } }, dl));
        await 要人填({ 标题: 版.显示名 || 版.文件名 || String(一.标识), 身: 身框, 确定: '关上' });
      }

      // ---------- 底栏那几个动作 ----------

      复制.addEventListener('click', async () => {
        const 们 = [...状态.选中.values()];
        if (!们.length) return;
        const 文 = 们.map((一) => 一.引用.条目ID || 一.标识).join('\n');
        try {
          await navigator.clipboard.writeText(文);
          吐司(`复制了 ${们.length} 个引用`, '成');
        } catch (_) { 吐司('复制不了', '错'); }
      });

      交出去钮.addEventListener('click', async () => {
        if (状态.选中.size !== 1) return;
        const 一 = [...状态.选中.values()][0];
        const { 回: 版 } = await 宿主.调(模块, '取详情', { 引用: 一.引用 });
        交出去({
          引用: 一.引用,
          说明: (版 && 版.ok !== false && (版.显示名 || 版.文件名)) || String(一.标识),
          缩略: 宿主.缩略图地址(一.引用, 320),
        });
        吐司('交出去了 · 去「识图」「装订」或「comfyUI」用它', '成');
      });

      存藏.addEventListener('click', async () => {
        if (!状态.选中.size) return;
        const 们 = [...状态.选中.values()];
        let 成 = 0;
        const 坏 = [];
        for (const 一 of 们) {
          const { 回 } = await 宿主.调(模块, '表.收藏', { 动作: '加', 标识: String(一.标识) });
          if (回 && 回.ok === false) 坏.push(`${一.标识}：${回.reason}`);
          else 成 += 1;
        }
        if (坏.length) 吐司(`收藏了 ${成} 个，${坏.length} 个没成：${坏[0]}`, '警', 4200);
        else 吐司(`收藏了 ${成} 个`, '成');
        await 列一地(状态.存放地);
      });

      删.addEventListener('click', async () => {
        if (状态.选中.size !== 1) return;
        const 一 = [...状态.选中.values()][0];
        const 是 = await 要人填({
          标题: `删掉 ${一.标识}？`,
          身: 造('div.细节', '删只影响这一条。模块那边会走它自己那套（移进 .deleting/）。'),
          确定: '删',
          危: true,
          要: () => true,
        });
        if (!是) return;
        const { 回, 耗时 } = await 宿主.调(模块, '删', { 引用: 一.引用 });
        if (回 && 回.ok === false) 吐司(`删不了：${回.reason}`, '错');
        else 吐司(`删掉了（${Math.round(耗时)} 毫秒）`, '成');
        await 列一地(状态.存放地);
      });

      清空.addEventListener('click', async () => {
        const 是 = await 要人填({
          标题: `把「${存放地说法[状态.存放地]}」里的条目全清掉？`,
          身: 造('div.细节', '模块会走它自己那套（移进 .deleting/），不是直接抹掉。'),
          确定: '清空',
          危: true,
          要: () => true,
        });
        if (!是) return;
        const { 回, 耗时 } = await 宿主.调(模块, '清空', { 作用域: { 存放地: 状态.存放地 } });
        if (回 && 回.ok === false) 吐司(`清不掉：${回.reason}`, '错');
        else 吐司(`清空了（${Math.round(耗时)} 毫秒）`, '成');
        await 列一地(状态.存放地);
      });

      // ---------- 起 ----------

      画底();
      return 列一地('gallery').then(() => () => { /* 这一块没有持续订阅，切走即可 */ },
        (错) => {
          清(右).append(造('div.提示.错', `起手那一趟没走完：${String((错 && 错.message) || 错)}`));
          return () => {};
        });
    },
  };
}
