// 世界书面板：一个请求挂几本世界书 · 条目 · 落点 · 草稿与存档。
//
// 这一块最要紧的一条不是画得好看，而是**把两个状态摆明白**：
// `执行` 读存档、`测` 读草稿。改了东西不按存，上层拿到的还是旧的——这是设计，
// 不是毛病。所以草稿脏了必须在界面上看得见（判据②），并且给"测一下命中"的入口。
//
// 布局按 布局.md 的丙式：顶栏（请求 · 存 · 丢 · 重读 · 状态）/ 身子分节（挂哪几本 · 测命中 ·
// 书与条目）/ 每节的钮贴那一节自己的底。
//
// `落点` 与 `条目` 的字段形状一律从交付面读（`宿主.参数(模块,'条目','条目').界面.字段`），
// 界面里不写第二份字段表。
import { 造, 清, 画回执, 画一个参数, 截, 吐司, 要人填 } from '../顺手.js';

const 模块 = 'worldbook';

/** 请求表：上层设计 §六 定了四种。界面只拿它当筛选项，路由与启用列表以请求名为键。 */
const 请求们 = ['主AI', '翻译', '识图', '文生图'];

function 钮话(宿主, 动作, 兜底) {
  const 摘 = 宿主.摘要(模块, 动作);
  const 头 = 摘 ? 摘.split(/[:：]/)[0].trim() : '';
  return 头 || 兜底 || 动作;
}

export default function 造世界书面板({ 宿主, 模子 }) {
  return {
    名: 'worldbook',
    标题: '世界书',
    副题: '按请求挑出带落点的条目 · 上层拿它拼提示词，界面拿它看命中',
    要的模块: [模块],

    画(墙) {
      let 请求 = 请求们[0];
      let 书标识 = '';
      let 脏 = false;

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 请选 = 造('select.窄');
      for (const 一 of 请求们) 请选.append(造('option', { value: 一 }, 一));
      请选.value = 请求;
      const 状态标 = 造('span.标签');
      const 存钮 = 造('button.钮.主', { type: 'button' }, 钮话(宿主, '存', '存'));
      const 丢钮 = 造('button.钮', { type: 'button' }, 钮话(宿主, '丢', '丢'));
      const 重读钮 = 造('button.钮', { type: 'button' }, 钮话(宿主, '重读', '重读'));
      const 状态钮 = 造('button.钮.幽灵', { type: 'button' }, 钮话(宿主, '状态', '状态'));
      const 顶放 = 造('div');
      顶.append(造('div.横排', 造('label', '请求'), 请选, 状态标, 造('span.伸'), 存钮, 丢钮, 重读钮, 状态钮), 顶放);

      // ---------- 身子 ----------

      const 身 = 造('div.墙身');
      墙.append(顶, 身);

      // 一、挂哪几本
      const 启块 = 造('div.块');
      启块.append(造('div.栏头', 造('h3', '这个请求挂哪几本'), 造('span.伸'), 造('span.数', '挂上 ≠ 命中')));
      启块.append(造('div.细节', '挂上不等于命中：条目还要按自己的条件（恒常 / 关键词）参与。'));
      const 启放 = 造('div', { style: { marginTop: '8px' } });
      启块.append(启放);
      身.append(启块);

      // 二、测命中（读草稿 / 读存档）
      const 测块 = 造('div.块', { style: { marginTop: '12px' } });
      测块.append(造('div.栏头', 造('h3', '这次会命中哪些'), 造('span.伸'), 造('span.数', '测=草稿 · 执行=存档')));
      测块.append(造('div.细节', '拿一段文本试一下。**两个钮读的不是同一份**：这就是"改了没存，上层拿到的还是旧的"那件事。'));
      const 测框 = 造('textarea', { rows: 2, placeholder: '1girl, 分镜, 第一人称, 透视' });
      const 测钮 = 造('button.钮.主', { type: 'button' }, '测草稿');
      const 执钮 = 造('button.钮', { type: 'button' }, '看存档（上层真正拿到的）');
      const 测放 = 造('div', { style: { marginTop: '8px' } });
      测块.append(测框, 造('div.块底', 测钮, 执钮), 测放);
      身.append(测块);

      // 三、书与条目
      const 书左 = 造('section', { style: { minWidth: '0' } });
      const 书右 = 造('section', { style: { minWidth: '0' } });
      const 书块 = 造('div.块', { style: { marginTop: '12px' } });
      书块.append(造('div.栏头', 造('h3', '书与条目'), 造('span.伸'), 造('span.数', '左边挑一本，右边看它的条目')));
      书块.append(造('div.两栏.宽右', 书左, 书右));
      身.append(书块);

      /** 调一次，回执画进容器。 */
      async function 调并画(动作, 参数, 放, 收起 = false) {
        const { 回, 耗时 } = await 宿主.调(模块, 动作, 参数);
        清(放).append(画回执({ 回, 耗时, 模子, 收起 }));
        return 回;
      }

      /** 画命中：正文那一格叫 `文本`。 */
      function 画命中(回) {
        const 盒 = 造('div');
        if (!回 || 回.ok === false) return 盒;
        const 命中 = 回.命中 || [];
        if (!命中.length) {
          盒.append(造('div.提示.淡', `这次一条都没命中（启用了 ${(回.书 || []).length} 本：${
            (回.书 || []).map((一) => 一.名字).join(' · ') || '一本都没有'}）。`));
          return 盒;
        }
        const 堆 = new Map();
        for (const 一 of 命中) {
          const 键 = 一.落点 || '（没写落点）';
          if (!堆.has(键)) 堆.set(键, []);
          堆.get(键).push(一);
        }
        for (const [落点, 们] of 堆) {
          const 头 = 造('div.栏头', 造('h3', `落点《${落点}》`), 造('span.标签', `${们.length} 条`));
          if (落点 === '按深度') {
            头.append(造('span.细节', '这一档本层只落在紧贴输入之前（最浅那一档）；深度字段原样保留'));
          }
          盒.append(头);
          for (const 一 of 们) {
            const 条 = 造('div.块', { style: { marginBottom: '6px' } });
            条.append(造('div.横排',
              造('span.标签.主', 一.书 || ''),
              ...(一.深度 !== undefined ? [造('span.标签', `深度 ${一.深度}`)] : []),
              ...(一.角色 ? [造('span.标签', `角色 ${一.角色}`)] : [])));
            条.append(造('div', {
              style: { whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: '11px', marginTop: '6px' },
            }, 一.文本 || ''));
            盒.append(条);
          }
        }
        return 盒;
      }

      /** 读一次：表 + 启用 + 脏。 */
      async function 刷新() {
        清(启放).append(造('div.装填', '读着…'));
        const { 回, 耗时 } = await 宿主.调(模块, '读', { 请求 });
        if (!回 || 回.ok === false) {
          清(启放).append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          清(书左);
          return;
        }
        脏 = Boolean(回.脏);
        状态标.textContent = 脏 ? '草稿改过，还没存' : '干净（草稿 = 存档）';
        状态标.className = `标签${脏 ? ' 警' : ' 成'}`;

        const 表 = 回.表 || [];
        const 启用 = 回.启用 || [];
        const 启用里有的 = new Set(启用.filter((一) => 一.存在).map((一) => 一.标识));

        清(启放);
        if (!表.length) 启放.append(造('div.空', '一本世界书都没有。'));
        for (const 一 of 表) {
          const 行 = 造('div.条');
          const 框 = 造('input', { type: 'checkbox', checked: 启用里有的.has(一.标识) });
          框.addEventListener('change', async () => {
            const 要 = new Set(启用里有的);
            if (框.checked) 要.add(一.标识); else 要.delete(一.标识);
            // `换` 收的是完整的一份启用列表。
            const { 回: 成 } = await 宿主.调(模块, '书', { 动作: '换', 请求, 启用: [...要] });
            if (!成 || 成.ok === false) 吐司(`换不了：${(成 && 成.reason) || '没回话'}`, '错');
            await 刷新();
          });
          const 名 = 造('span.名', { style: { cursor: 'pointer' } }, 一.名字);
          名.addEventListener('click', () => { 书标识 = 一.标识; 画书(一.标识); });
          行.append(框, 名);
          if (一.是本子) 行.append(造('span.标签', '只读默认'));
          if (!一.存在) 行.append(造('span.标签.错', '不存在'));
          if (一.读不懂) 行.append(造('span.标签.错', '读不懂'));
          行.append(造('span.伸'), 造('span.数', `${一.条目数} 条`), 造('span.码', 一.标识));
          启放.append(行);
        }
        // 启用了却不存在的那些也要露出来（不然用户不知道为什么没生效）。
        for (const 一 of 启用.filter((x) => !x.存在)) {
          启放.append(造('div.条',
            造('span.标签.错', '启用了但没有这本'), 造('span.名', 一.名字), 造('span.码', 一.标识)));
        }

        // 左栏：全部书 + 新建 / 导入
        清(书左);
        书左.append(造('div.栏头', 造('h4', '全部书'), 造('span.伸'), 造('span.数', `${表.length} 本`)));
        const 清单 = 造('div.清单');
        for (const 一 of 表) {
          const 项 = 造('div.清单项');
          项.append(造('div.主行', 造('span.名', 一.名字), 造('span.伸'), 造('span.数', `${一.条目数}`)));
          项.append(造('div.副行', 一.标识));
          项.setAttribute('aria-selected', String(书标识 === 一.标识));
          项.addEventListener('click', () => { 书标识 = 一.标识; 画书(一.标识); });
          清单.append(项);
        }
        书左.append(清单);

        const 名框 = 造('input', { type: 'text', placeholder: '新书的名字' });
        const 新建 = 造('button.钮', { type: 'button' }, '新建一本');
        新建.addEventListener('click', async () => {
          const 名字 = 名框.value.trim();
          if (!名字) { 吐司('先写一个书名', '警'); return; }
          const { 回: 成 } = await 宿主.调(模块, '书', { 动作: '新建', 名字, 请求 });
          if (!成 || 成.ok === false) { 吐司(`建不了：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          名框.value = '';
          await 刷新();
        });
        const 导框 = 造('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
        const 导入 = 造('button.钮', { type: 'button' }, '导入一份…');
        导入.addEventListener('click', () => 导框.click());
        导框.addEventListener('change', async () => {
          const 文件 = 导框.files && 导框.files[0];
          if (!文件 || typeof 文件.text !== 'function') { 吐司('这个壳里读不了本地文件', '警'); return; }
          const 内容 = await 文件.text();
          const { 回: 成 } = await 宿主.调(模块, '书', { 动作: '导入', 内容, 请求 });
          if (!成 || 成.ok === false) { 吐司(`导不进：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          await 刷新();
        });
        书左.append(造('div.字段', { style: { marginTop: '8px' } }, 造('div.标', '名字'), 名框));
        书左.append(造('div.块底', 新建, 导入, 导框));

        if (书标识) 画书(书标识);
        else 清(书右).append(造('div.空', '左边挑一本。'));
      }

      /** 画一本书的条目表。 */
      async function 画书(标识) {
        清(书右).append(造('div.装填', '读着…'));
        const { 回, 耗时 } = await 宿主.调(模块, '读', { 书: 标识 });
        清(书右);
        if (!回 || 回.ok === false) {
          书右.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return;
        }
        const 书 = 回.书;
        if (!书) { 书右.append(造('div.空', '宿主没给这本书的正文。')); return; }
        书右.append(造('div.栏头',
          造('h4', 书.名字),
          书.是本子 ? 造('span.标签', '只读默认（改不动，要改就导出再导入）') : null,
          造('span.伸'),
          造('span.数', `${(书.条目 || []).length} 条`)));

        const 表 = 造('table.表');
        表.append(造('tr',
          造('th', '开关'), 造('th', 'label'), 造('th', '条件'), 造('th', '落点'), 造('th', '正文'), 造('th', '这一行')));
        for (const 一 of 书.条目 || []) {
          const 行 = 造('tr');
          const 框 = 造('input', { type: 'checkbox', checked: 一.enabled !== false });
          框.addEventListener('change', async () => {
            await 宿主.调(模块, '条目', { 动作: '改', 书: 标识, 标识: 一.id, 条目: { enabled: 框.checked } });
            await 刷新();
          });
          行.append(造('td', 框));
          行.append(造('td', 一.label || '（没 label）'));
          行.append(造('td.窄', 一.always ? 造('span.标签.主', '恒常') : 造('span.标签', `关键词 ${(一.keys || []).join(' / ') || '（空）'}`)));
          行.append(造('td.窄', `${一.落点 || ''}${一.深度 !== undefined ? ` · 深度 ${一.深度}` : ''}${一.角色 ? ` · ${一.角色}` : ''}`));
          行.append(造('td', { title: 一.text }, 截(一.text, 90)));
          const 钮格 = 造('td.窄');
          const 编 = 造('button.钮.小', { type: 'button' }, '改');
          编.addEventListener('click', () => 画编(标识, 一));
          钮格.append(编);
          行.append(钮格);
          表.append(行);
        }
        书右.append(表);

        const 加钮 = 造('button.钮', { type: 'button' }, '加一条');
        加钮.addEventListener('click', () => 画编(标识, null));

        const 导出 = 造('button.钮', { type: 'button' }, '导出（能再导入）');
        const 导出放 = 造('div', { style: { marginTop: '8px' } });
        导出.addEventListener('click', async () => {
          const { 回: 成, 耗时: 毫 } = await 宿主.调(模块, '书', { 动作: '导出', 标识 });
          清(导出放);
          if (成 && 成.ok !== false) {
            const 框 = 造('textarea', { rows: 6 });
            框.value = 成.内容 || '';
            导出放.append(造('div.提示.成', `导出来了：${成.名字}`), 框);
          } else {
            导出放.append(画回执({ 回: 成, 耗时: 毫, 模子 }));
          }
        });
        const 改名 = 造('button.钮', { type: 'button' }, '改名');
        改名.addEventListener('click', async () => {
          const 名框 = 造('input', { type: 'text', value: 书.名字 });
          const 名字 = await 要人填({
            标题: '改这本书的名字',
            身: 造('div.字段', 造('div.标', '新名字'), 名框),
            确定: '改',
            要: () => 名框.value.trim(),
          });
          if (!名字) return;
          const { 回: 成 } = await 宿主.调(模块, '书', { 动作: '改名', 标识, 名字 });
          if (!成 || 成.ok === false) { 吐司(`改不了：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          书标识 = '';
          await 刷新();
        });
        const 删 = 造('button.钮.危', { type: 'button' }, '删这本');
        删.addEventListener('click', async () => {
          const 是 = await 要人填({
            标题: `删掉《${书.名字}》？`,
            身: 造('div.细节', '只读默认删不动，模块会说理由。'),
            确定: '删',
            危: true,
            要: () => true,
          });
          if (!是) return;
          const { 回: 成 } = await 宿主.调(模块, '书', { 动作: '删', 标识 });
          if (!成 || 成.ok === false) { 吐司(`删不了：${(成 && 成.reason) || '没回话'}`, '错'); return; }
          书标识 = '';
          await 刷新();
        });
        书右.append(造('div.块底', 加钮, 改名, 导出, 删), 导出放);
      }

      /** 编一条（加 / 改）。字段形状从交付面读。 */
      function 画编(标识, 条目) {
        清(书右);
        书右.append(造('div.栏头', 造('h4', 条目 ? `改 ${条目.label || 条目.id}` : '加一条'), 造('span.伸')));
        const 取值们 = {};
        const 初 = 条目 || { label: '', text: '', always: true, keys: [], enabled: true, 落点: '前' };
        const 参数说明 = 宿主.参数(模块, '条目', '条目');
        const 字段们 = (参数说明 && 参数说明.界面 && 参数说明.界面.字段) || null;
        if (!字段们) {
          书右.append(造('div.提示.警', '宿主没交「条目」这个参数的字段形状，这一处画不出来。'));
          return;
        }
        for (const 字段 of 字段们) {
          const 名 = 字段.名;
          const 值 = 名 === 'keys' ? (初.keys && 初.keys.length ? 初.keys.join(',') : undefined) : 初[名];
          const { 元, 取值 } = 画一个参数({
            名,
            可选: true,
            说明: '',
            界面: 字段,
          }, 值 === '' || 值 === undefined ? undefined : 值);
          取值们[名] = 取值;
          书右.append(元);
        }
        const 放 = 造('div', { style: { marginTop: '8px' } });
        const 存 = 造('button.钮.主', { type: 'button' }, 条目 ? '落这一条' : '加进去');
        存.addEventListener('click', async () => {
          存.disabled = true;
          const 条目值 = {};
          for (const [名, 取值] of Object.entries(取值们)) {
            const v = 取值();
            if (v === undefined) continue;
            条目值[名] = 名 === 'keys' ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : v;
          }
          const { 回, 耗时 } = await 宿主.调(模块, '条目', 条目
            ? { 动作: '改', 书: 标识, 标识: 条目.id, 条目: 条目值 }
            : { 动作: '加', 书: 标识, 条目: 条目值 });
          存.disabled = false;
          清(放).append(画回执({ 回, 耗时, 模子 }));
          if (!回 || 回.ok !== false) await 刷新();
        });
        const 回钮 = 造('button.钮', { type: 'button' }, '不改了');
        回钮.addEventListener('click', () => 画书(标识));
        书右.append(造('div.块底', 存, 回钮), 放);
      }

      // ---------- 事件 ----------
      请选.addEventListener('change', () => { 请求 = 请选.value; 书标识 = ''; 刷新(); });
      存钮.addEventListener('click', async () => {
        const 回 = await 调并画('存', {}, 顶放);
        if (!回 || 回.ok !== false) await 刷新();
      });
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
        const 回 = await 调并画('丢', {}, 顶放);
        if (!回 || 回.ok !== false) await 刷新();
      });
      重读钮.addEventListener('click', async () => { await 调并画('重读', {}, 顶放); await 刷新(); });
      状态钮.addEventListener('click', async () => { await 调并画('状态', {}, 顶放); });
      测钮.addEventListener('click', async () => {
        const { 回, 耗时 } = await 宿主.调(模块, '测', { 请求, 文本: 测框.value });
        清(测放);
        if (回 && 回.ok !== false) 测放.append(画命中(回));
        测放.append(画回执({ 回, 耗时, 模子, 收起: Boolean(回 && 回.ok !== false) }));
      });
      执钮.addEventListener('click', async () => {
        const { 回, 耗时 } = await 宿主.调(模块, '执行', { 请求, 文本: 测框.value });
        清(测放);
        if (回 && 回.ok !== false) 测放.append(画命中(回));
        测放.append(画回执({ 回, 耗时, 模子, 收起: Boolean(回 && 回.ok !== false) }));
      });

      刷新();
    },
  };
}
