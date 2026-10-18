// 主 AI 面板：模型与工具设置。
// 默认设置只读；用户设置提供模型、工具与草稿编辑。
import { 造, 清, 画回执, 吐司, 要人填 } from '../顺手.js';

const 模块 = '主AI';

/** 请求表：上层设计 §六 定了四种。界面只拿它当筛选项。 */
const 请求们 = ['主AI', '翻译', '识图', '文生图'];

function 钮话(宿主, 动作, 兜底) {
  const 摘 = 宿主.摘要(模块, 动作);
  const 头 = 摘 ? 摘.split(/[:：]/)[0].trim() : '';
  return 头 || 兜底 || 动作;
}

export default function 造主AI面板({ 宿主, 模子 }) {
  return {
    名: '主AI',
    标题: '主 AI',
    副题: '主 AI 设置：模型 · 工具启用与说明',
    要的模块: [模块],

    画(墙) {
      let 请求 = 请求们[0];
      let 标识 = '';
      let 脏 = false;

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 请选 = 造('select.窄');
      for (const 一 of 请求们) 请选.append(造('option', { value: 一 }, 一));
      请选.value = 请求;
      const 状态标 = 造('span.标签');
      const 存钮 = 造('button.钮.主', { type: 'button' }, 钮话(宿主, '存', '存'));
      const 丢钮 = 造('button.钮', { type: 'button' }, 钮话(宿主, '丢', '丢'));
      const 状态钮 = 造('button.钮.幽灵', { type: 'button' }, 钮话(宿主, '状态', '状态'));
      const 顶放 = 造('div');
      顶.append(造('div.横排', 造('label', '请求'), 请选, 状态标, 造('span.伸'), 存钮, 丢钮, 状态钮), 顶放);

      // ---------- 身子 ----------

      const 左 = 造('aside');
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏', 左, 右));
      墙.append(顶, 身);

      /** 调一次画回执。 */
      async function 调并画(动作, 参数, 放, 收起 = false) {
        const { 回, 耗时 } = await 宿主.调(模块, 动作, 参数);
        清(放).append(画回执({ 回, 耗时, 模子, 收起 }));
        return 回;
      }

      /** 刷新：表 + 启用 + 脏。 */
      async function 刷新() {
        清(左).append(造('div.装填', '读着…'));
        const { 回, 耗时 } = await 宿主.调(模块, '读', { 请求 });
        if (!回 || 回.ok === false) {
          清(左).append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          清(右);
          return;
        }
        脏 = Boolean(回.脏);
        状态标.textContent = 脏 ? '草稿改过，还没存' : (回.冻结 ? `冻结写：${回.冻结}` : '干净（草稿 = 存档）');
        状态标.className = `标签${脏 || 回.冻结 ? ' 警' : ' 成'}`;
        const 表 = 回.表 || [];
        const 启用 = (回.启用 || []).filter((一) => 一.存在);
        const 启用里有的 = new Set(启用.map((一) => 一.标识));

        清(左);
        const 块 = 造('div.块');
        块.append(造('div.栏头', 造('h2', `${请求} 启用哪几套`), 造('span.伸'), 造('span.数', `${表.length} 套`)));
        块.append(造('div.细节', '一个请求可以启用几套；未选择用户设置时使用默认模型与工具设置。'));
        for (const 一 of 表) {
          const 行 = 造('div.条');
          const 框 = 造('input', { type: 'checkbox', checked: 启用里有的.has(一.标识) });
          框.addEventListener('change', async () => {
            const 要 = new Set(启用里有的);
            if (框.checked) 要.add(一.标识); else 要.delete(一.标识);
            const { 回: 成 } = await 宿主.调(模块, '预设', { 动作: '换', 请求, 启用: [...要] });
            if (!成 || 成.ok === false) 吐司(`换不了：${(成 && 成.reason) || '没回话'}`, '错');
            await 刷新();
          });
          const 名 = 造('span.名', { style: { cursor: 'pointer' } }, 一.名字);
          名.addEventListener('click', () => { 标识 = 一.标识; 画一套(); });
          行.append(框, 名);
          if (一.是本子) 行.append(造('span.标签', '只读默认'));
          if (!一.存在) 行.append(造('span.标签.错', '不存在'));
          if (一.读不懂) 行.append(造('span.标签.错', '读不懂'));
          行.append(造('span.伸'), 造('span.数', `${一.工具数} 个工具`));
          块.append(行);
        }
        左.append(块);

        // 管预设：名称一条，动作一条
        const 管块 = 造('div.块', { style: { marginTop: '12px' } });
        管块.append(造('div.栏头', 造('h3', '管预设')));
        const 名框 = 造('input', { type: 'text', placeholder: '新预设的名字（空 = 模块自己起一个）' });
        管块.append(造('div.字段', 造('div.标', '名字'), 名框));
        const 新钮 = 造('button.钮', { type: 'button' }, '新建（抄默认一份快照）');
        新钮.addEventListener('click', async () => {
          新钮.disabled = true;
          const { 回: 成 } = await 宿主.调(模块, '预设', { 动作: '新建', 名字: 名框.value.trim() || undefined, 请求 });
          新钮.disabled = false;
          if (!成 || 成.ok === false) { 吐司(`建不了：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          名框.value = '';
          await 刷新();
        });
        const 复钮 = 造('button.钮', { type: 'button' }, '复制选中的');
        复钮.addEventListener('click', async () => {
          if (!标识) { 吐司('先在下面挑一套', '警'); return; }
          const { 回: 成 } = await 宿主.调(模块, '预设', { 动作: '复制', 预设: 标识, 名字: 名框.value.trim() || undefined });
          if (!成 || 成.ok === false) { 吐司(`复制不了：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          await 刷新();
        });
        const 导框 = 造('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
        const 导钮 = 造('button.钮', { type: 'button' }, '导入…');
        导钮.addEventListener('click', () => 导框.click());
        导框.addEventListener('change', async () => {
          const 文件 = 导框.files && 导框.files[0];
          if (!文件 || typeof 文件.text !== 'function') { 吐司('这个壳里读不了本地文件', '警'); return; }
          const 内容 = await 文件.text();
          const { 回: 成 } = await 宿主.调(模块, '预设', { 动作: '导入', 内容, 请求 });
          if (!成 || 成.ok === false) { 吐司(`导不进：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          await 刷新();
        });
        管块.append(造('div.块底', 新钮, 复钮, 导钮, 导框));
        左.append(管块);

        if (标识) 画一套();
        else 清(右).append(造('div.空', '左边点一套看它的内容。'));
      }

      /** 画一套设置：模型 / 工具表。 */
      async function 画一套() {
        清(右).append(造('div.装填', '读着…'));
        const { 回, 耗时 } = await 宿主.调(模块, '读', { 预设: 标识, 请求 });
        清(右);
        if (!回 || 回.ok === false) {
          右.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return;
        }
        const 套 = 回.预设;
        if (!套) { 右.append(造('div.空', '宿主没给这一套的正文。')); return; }
        const 只读 = Boolean(套.是本子);

        右.append(造('div.栏头',
          造('h2', 套.名字),
          套.是本子 ? 造('span.标签', '只读默认') : null,
          套.读得懂 === false ? 造('span.标签.错', '读不懂') : null,
          造('span.伸'),
          造('span.码', 套.标识)));
        if (只读) {
          右.append(造('div.提示.淡',
            '这是随程序走的只读默认：它不落盘、没有写路径。要改就按左边那个「新建（抄默认一份快照）」，之后你那份与默认各走各的。'));
        }

        // 这一套的动作（改名 / 删 / 导出 / 看草稿）——放在这一套自己的底上
        const 名改 = 造('button.钮', { type: 'button' }, '改名');
        名改.disabled = 只读;
        名改.addEventListener('click', async () => {
          const 名框 = 造('input', { type: 'text', value: 套.名字 });
          const 名字 = await 要人填({
            标题: '改这一套的名字',
            身: 造('div.字段', 造('div.标', '新名字'), 名框),
            确定: '改',
            要: () => 名框.value.trim(),
          });
          if (!名字) return;
          const { 回: 成 } = await 宿主.调(模块, '预设', { 动作: '改名', 预设: 标识, 名字 });
          if (!成 || 成.ok === false) { 吐司(`改不了：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          标识 = '';
          await 刷新();
        });
        const 删钮 = 造('button.钮.危', { type: 'button' }, '删这一套');
        删钮.disabled = 只读;
        删钮.addEventListener('click', async () => {
          const 是 = await 要人填({
            标题: `删掉《${套.名字}》？`,
            身: 造('div.细节', '只删这一套。默认那一份删不动，模块会说理由。'),
            确定: '删',
            危: true,
            要: () => true,
          });
          if (!是) return;
          const { 回: 成 } = await 宿主.调(模块, '预设', { 动作: '删', 预设: 标识 });
          if (!成 || 成.ok === false) { 吐司(`删不了：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          标识 = '';
          await 刷新();
        });
        const 导钮 = 造('button.钮', { type: 'button' }, '导出这一套');
        const 导放 = 造('div', { style: { marginTop: '8px' } });
        导钮.addEventListener('click', async () => {
          const { 回: 成, 耗时: 毫 } = await 宿主.调(模块, '预设', { 动作: '导出', 预设: 标识 });
          清(导放);
          if (成 && 成.ok !== false) {
            const 框 = 造('textarea', { rows: 6 });
            框.value = typeof 成 === 'string' ? 成 : JSON.stringify(成, null, 2);
            导放.append(造('div.提示.成', `导出来了（能再导入）· ${毫 < 1 ? '<1' : Math.round(毫)} 毫秒`), 框);
          } else {
            导放.append(画回执({ 回: 成, 耗时: 毫, 模子 }));
          }
        });
        const 测钮 = 造('button.钮', { type: 'button' }, '看草稿（测）');
        const 改放 = 造('div', { style: { marginTop: '8px' } });
        测钮.addEventListener('click', async () => {
          const { 回: 成, 耗时: 毫 } = await 宿主.调(模块, '测', { 请求, 预设: 标识 });
          清(改放).append(画回执({ 回: 成, 耗时: 毫, 模子, 收起: true }));
        });

        // 模型设置
        const 参块 = 造('div.块', { style: { marginTop: '12px' } });
        参块.append(造('div.栏头', 造('h3', '模型设置')));
        参块.append(造('div.细节', '提示词正文与启用列表在世界书面板管理；此处设置模型。'));
        const 走框 = 造('input', { type: 'text', value: (套.model && 套.model.走) || '', placeholder: '池里的哪一条（空 = 跟随主 AI）' });
        const 模框 = 造('input', { type: 'text', value: (套.model && 套.model.模型) || '', placeholder: '模型名' });
        const 字段排 = 造('div.字段排', { style: { marginTop: '8px' } });
        字段排.append(
          造('div.字段.宽', 造('div.标', '走（池条目）'), 走框),
          造('div.字段.宽', 造('div.标', '模型'), 模框));
        参块.append(字段排);
        右.append(参块);

        // 改这一套：决定就在这一节里执行
        const 改钮 = 造('button.钮.主', { type: 'button' }, '改（只改给的那几格）');
        改钮.disabled = 只读;
        改钮.addEventListener('click', async () => {
          改钮.disabled = true;
          const 参数 = {
            动作: '改',
            预设: 标识,
            model: { 走: 走框.value.trim() || undefined, 模型: 模框.value.trim() || undefined },
          };
          const { 回: 成, 耗时: 毫 } = await 宿主.调(模块, '预设', 参数);
          改钮.disabled = 只读;
          清(改放).append(画回执({ 回: 成, 耗时: 毫, 模子, 收起: true }));
          await 刷新();
        });
        const 改块 = 造('div.块', { style: { marginTop: '12px' } });
        改块.append(造('div.栏头', 造('h3', '这一套的动作'), 造('span.伸'), 造('span.细节', 只读 ? '只读默认：写它的钮都是灰的' : '')));
        改块.append(造('div.块底', 改钮, 测钮, 导钮, 名改, 删钮), 改放, 导放);
        右.append(改块);

        // 工具表
        const 工块 = 造('div.块', { style: { marginTop: '12px' } });
        const 工表 = 套.工具表 || [];
        const 算不出的 = 工表.filter((一) => 一.算得出来 === false);
        工块.append(造('div.栏头',
          造('h3', `工具表（${工表.length} 条）`),
          造('span.伸'),
          算不出的.length ? 造('span.标签.错', `${算不出的.length} 条对不到模块动作`) : 造('span.标签.成', '全部对得上')));
        工块.append(造('div.细节', '这里的每一条就是模型能看见的一个工具。参数与说明都是模块自己交出来的；停用的那几条不会登记进去。'));
        const 表 = 造('table.表', { style: { marginTop: '8px' } });
        表.append(造('tr', 造('th', '开关'), 造('th', '名字'), 造('th', '参数'), 造('th', '对得上模块动作吗'), 造('th', '这一行')));
        for (const 一 of 工表) {
          const 行 = 造('tr');
          if (一.启用 === false) 行.style.opacity = '.55';
          const 框 = 造('input', { type: 'checkbox', checked: 一.启用 !== false });
          框.disabled = 只读;
          框.addEventListener('change', async () => {
            const { 回: 成 } = await 宿主.调(模块, '工具', { 动作: '改', 预设: 标识, 名字: 一.名字, 启用: 框.checked });
            if (!成 || 成.ok === false) 吐司(`改不了：${(成 && 成.reason) || '没回话'}`, '错');
            await 刷新();
            await 画一套();
          });
          行.append(造('td', 框));
          行.append(造('td', { style: { fontFamily: 'Consolas, monospace' } }, 一.名字));
          const 参数名 = Object.keys(一.参数 || {});
          行.append(造('td.窄', { title: 参数名.map((n) => `${n}：${(一.说明 || {})[n] || ''}`).join('\n') }, 参数名.join(' · ') || '—'));
          行.append(造('td.窄', 一.算得出来 === false ? 造('span.标签.错', '对不上') : 造('span.标签.成', '对得上')));
          const 格 = 造('td.窄');
          const 移上 = 造('button.钮.小.幽灵', { type: 'button', title: '往上挪一条' }, '↑');
          移上.disabled = 只读;
          移上.addEventListener('click', async () => {
            await 宿主.调(模块, '工具', { 动作: '移', 预设: 标识, 名字: 一.名字, 方向: '上' });
            await 刷新(); await 画一套();
          });
          const 移下 = 造('button.钮.小.幽灵', { type: 'button', title: '往下挪一条' }, '↓');
          移下.disabled = 只读;
          移下.addEventListener('click', async () => {
            await 宿主.调(模块, '工具', { 动作: '移', 预设: 标识, 名字: 一.名字, 方向: '下' });
            await 刷新(); await 画一套();
          });
          const 删 = 造('button.钮.小.危', { type: 'button', title: '从这一套里删掉这个工具' }, '删');
          删.disabled = 只读;
          删.addEventListener('click', async () => {
            await 宿主.调(模块, '工具', { 动作: '删', 预设: 标识, 名字: 一.名字 });
            await 刷新(); await 画一套();
          });
          格.append(移上, 移下, 删);
          行.append(格);
          表.append(行);
        }
        工块.append(表);
        const 重钮 = 造('button.钮', { type: 'button' }, '把工具表重算成当前的默认');
        重钮.disabled = 只读;
        重钮.addEventListener('click', async () => {
          const { 回: 成, 耗时: 毫 } = await 宿主.调(模块, '工具', { 动作: '重置', 预设: 标识 });
          清(改放).append(画回执({ 回: 成, 耗时: 毫, 模子 }));
          await 刷新();
          await 画一套();
        });
        工块.append(造('div.块底', 重钮));
        右.append(工块);
      }

      // ---------- 事件 ----------
      请选.addEventListener('change', () => { 请求 = 请选.value; 标识 = ''; 刷新(); });
      存钮.addEventListener('click', async () => { await 调并画('存', {}, 顶放); await 刷新(); });
      丢钮.addEventListener('click', async () => {
        if (脏) {
          const 是 = await 要人填({
            标题: '把草稿丢掉？',
            身: 造('div.细节', '丢掉就回到存档那一份，没存的改动全没了。'),
            确定: '丢掉',
            危: true,
            要: () => true,
          });
          if (!是) return;
        }
        await 调并画('丢', {}, 顶放);
        await 刷新();
      });
      状态钮.addEventListener('click', async () => { await 调并画('状态', {}, 顶放); });

      刷新();
    },
  };
}
