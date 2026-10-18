// comfyUI 面板：连不连得上 · 存哪张工作流 · 三个口 · 出图 · 取回图。
//
// 出图是唯一那种能跑半小时的活，所以它走**任务**那条路：起任务 → 开一条流看状态 →
// 页面关掉再回来还看得到。进度只报模块报的那种（状态切换），**这里不造百分比**。
//
// 布局按 布局.md 的丙式：顶栏（探活 · 看队列 · 看节点定义）/ 身子分节（分段：出图 / 工作流）
// / 底栏（任务号 · 看这个任务 · 状态与已等时间）。
import { 造, 清, 画回执, 画一个参数, 说字节, 说时间, 吐司, 要人填, 分段 } from '../顺手.js';

const 模块 = 'comfy';

function 钮话(宿主, 动作, 兜底) {
  const 摘 = 宿主.摘要(模块, 动作);
  const 头 = 摘 ? 摘.split(/[:：]/)[0].trim() : '';
  return 头 || 兜底 || 动作;
}

export default function 造comfy面板({ 宿主, 模子 }) {
  return {
    名: 'comfy',
    标题: 'comfyUI',
    副题: '读工作流 · 认三个口 · 填进去出图 · 取回图',
    要的模块: [模块],

    画(墙, 上下文) {
      /** 取回来的产出（取图之后放这儿，好存进图库）。 */
      let 取回的 = null;

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 连放 = 造('div');
      const 连块 = 造('details');
      连块.append(造('summary', '这一台 ComfyUI'), 连放);
      const 探钮 = 造('button.钮.主', { type: 'button' }, 钮话(宿主, '探活', '探活'));
      const 队钮 = 造('button.钮', { type: 'button' }, 钮话(宿主, '看队列', '看队列'));
      const 节钮 = 造('button.钮.幽灵', { type: 'button' }, 钮话(宿主, '看节点定义', '看节点定义'));
      for (const [钮, 动作] of [[探钮, '探活'], [队钮, '看队列'], [节钮, '看节点定义']]) {
        钮.addEventListener('click', async () => {
          钮.disabled = true;
          清(连放).append(造('div.装填', '问着…'));
          连块.open = true;
          const { 回, 耗时 } = await 宿主.调(模块, 动作, {});
          钮.disabled = false;
          清(连放);
          if (回 && 回.ok !== false && typeof 回 === 'object' && !Array.isArray(回)) {
            const dl = 造('dl');
            for (const [k, v] of Object.entries(回)) {
              dl.append(造('dt', k), 造('dd', typeof v === 'object' ? JSON.stringify(v) : String(v)));
            }
            连放.append(造('div.细节', dl));
          }
          if (动作 === '看节点定义' && 回 && 回.ok !== false) {
            const 几 = Array.isArray(回) ? 回.length : Object.keys(回 || {}).length;
            连放.append(造('div.提示.成', `这台机器认得 ${几} 个节点类。整份定义见下面的回执（很大，收着的）。`));
          }
          连放.append(画回执({ 回, 耗时, 模子, 收起: true }));
        });
      }
      顶.append(造('div.横排', 造('span.伸'), 节钮, 队钮, 探钮));
      顶.append(连块);

      // ---------- 身子：两段 ----------

      const 身 = 造('div.墙身');
      const 分段条 = 造('div.分段条');
      const 段放 = 造('div');
      身.append(分段条, 段放);
      墙.append(顶, 身);

      // ---------- 底栏：手上的任务 ----------

      const 底 = 造('div.墙底');
      const 任输入 = 造('input', { type: 'text', placeholder: '任务号（出图时会显示）' });
      const 任看 = 造('button.钮', { type: 'button' }, '看这个任务');
      const 出状 = 造('span.耗时');
      const 任放 = 造('div');
      底.append(造('label', '任务'), 任输入, 任看, 造('span.伸'), 出状);
      墙.append(底);
      // 任务详情摆在身子最后（底栏只放"号 + 看"）
      身.append(任放);

      任看.addEventListener('click', async () => {
        const id = 任输入.value.trim();
        if (!id) { 吐司('先填一个任务号', '警'); return; }
        任看.disabled = true;
        const { 回 } = await 宿主.看任务(id, 0);
        任看.disabled = false;
        清(任放);
        if (!回 || 回.ok === false) { 任放.append(造('div.提示.错', (回 && 回.reason) || '没回话')); return; }
        const d = 回.data || 回;
        const 块 = 造('div.块');
        const dl = 造('dl');
        const 加 = (k, v) => dl.append(造('dt', k), 造('dd', v));
        加('什么', d.什么);
        加('状态', d.状态);
        加('开始', 说时间(d.开始时间));
        if (d.做完时间) 加('做完', 说时间(d.做完时间));
        加('事件', String((d.事件 || []).length));
        块.append(造('div.栏头', 造('h3', `任务 ${id}`)), 造('div.细节', dl));
        任放.append(块);
        if (d.错) 任放.append(造('div.提示.错', d.错));
        if (d.回执) 任放.append(画回执({ 回: d.回执, 模子, 收起: true }));
      });

      // ---------- 一、出图 ----------

      const 出段 = 造('div');
      {
        const 块 = 造('div.块');
        块.append(造('div.栏头', 造('h3', '出图'), 造('span.伸'), 造('span.数', '一次只能飞一个')));
        块.append(造('div.细节',
          '一次只能飞一个（模块自己也是这么挡的）。跑起来之后关掉页面再回来，结果还在——它挂在任务表上。'));

        const 参数们 = {};
        for (const 名 of ['正向', '负向']) {
          const 一 = 宿主.参数(模块, '出图', 名);
          if (!一) continue;
          const { 元, 取值 } = 画一个参数(一);
          参数们[名] = 取值;
          块.append(元);
        }

        // 送一张图进去（图生图）：从上一位交下来
        const 送说 = 造('span.细节', '没有送图（文生图）。');
        const 用交接 = 造('button.钮', { type: 'button' }, '用交接过来的那张图');
        用交接.addEventListener('click', () => {
          const 一 = 上下文 && 上下文.接过来 ? 上下文.接过来() : null;
          if (!一 || !一.引用) {
            吐司('还没有人交图过来：去「图片」面板点"把这一张交给后面的面板"', '警', 3600);
            return;
          }
          送说.textContent = `要送进去的那张：${一.说明 || 一.引用.条目ID}`;
          送说.dataset.条目ID = 一.引用.条目ID;
          送说.dataset.存放地 = (一.引用.作用域 && 一.引用.作用域.存放地) || 'gallery';
          送说.dataset.会话ID = (一.引用.作用域 && 一.引用.作用域.会话ID) || '';
        });
        块.append(造('div.块底', 用交接, 送说));

        const 出钮 = 造('button.钮.主', { type: 'button' }, 钮话(宿主, '出图', '出图'));
        const 事件放 = 造('div', { style: { marginTop: '10px' } });
        const 出放 = 造('div', { style: { marginTop: '10px' } });
        块.append(造('div.块底', 出钮), 事件放, 出放);
        出段.append(块);

        出钮.addEventListener('click', async () => {
          const 参数 = {};
          for (const [名, 取值] of Object.entries(参数们)) { const v = 取值(); if (v !== undefined) 参数[名] = v; }

          // 要送图就把字节取到手（模块要的是 { 字节, 文件名, mime }）。
          if (送说.dataset.条目ID) {
            出钮.disabled = true;
            出状.textContent = '取要送进去的那张图…';
            const 引用 = {
              作用域: { 存放地: 送说.dataset.存放地, ...(送说.dataset.会话ID ? { 会话ID: 送说.dataset.会话ID } : {}) },
              条目ID: 送说.dataset.条目ID,
            };
            const { 回: 图 } = await 宿主.调('image', '取内容', { 引用 });
            if (!图 || 图.ok === false) {
              出钮.disabled = false;
              出状.textContent = '';
              吐司(`取不到那张图的字节：${(图 && 图.reason) || '没回话'}`, '错');
              return;
            }
            参数.图片 = { 字节: 图.字节, 文件名: 图.文件名, mime: 图.mime };
          }

          清(出放);
          清(事件放);
          出钮.disabled = true;
          出状.textContent = '起任务…';
          const { 回: 起了 } = await 宿主.起任务('出图', 参数);
          if (!起了 || 起了.ok === false || !起了.id) {
            出钮.disabled = false;
            出状.textContent = '';
            清(出放).append(画回执({ 回: 起了 || { ok: false, reason: '起不来任务', code: 'PAGE_EMPTY' }, 模子 }));
            return;
          }
          任输入.value = 起了.id;

          const 事件表 = 造('table.表');
          事件表.append(造('tr', 造('th', '时间'), 造('th', '模块报的事件')));
          清(事件放).append(造('div.栏头', 造('h3', `任务 ${起了.id}`), 造('span.伸'), 造('span.数', '只报状态切换，没有百分比')), 事件表);
          const 起时 = Date.now();
          const 滴 = setInterval(() => {
            const 秒 = Math.round((Date.now() - 起时) / 1000);
            出状.textContent = `跑着… 已等 ${Math.floor(秒 / 60)} 分 ${秒 % 60} 秒（模块只报状态切换，没有百分比）`;
          }, 500);

          const 流 = new EventSource(宿主.任务流地址(起了.id, 0));
          流.onmessage = async (e) => {
            let 包;
            try { 包 = JSON.parse(e.data); } catch (_) { return; }
            if (包.类型 === '心跳') return;
            const 事件 = 包.事件 && 包.事件.内容;
            if (事件) {
              事件表.append(造('tr',
                造('td.窄', 说时间(包.事件.时间)),
                造('td', { style: { fontFamily: 'Consolas, monospace', fontSize: '11px' } }, JSON.stringify(事件))));
            }
            if (包.类型 === '完了') {
              流.close();
              clearInterval(滴);
              出状.textContent = '';
              出钮.disabled = false;
              const 回 = 包.回执;
              if (回 && 回.ok !== false) {
                事件表.append(造('tr', 造('td.窄', 说时间(Date.now())), 造('td', '完成')));
                画产出(回);
              } else {
                清(出放).append(画回执({ 回: 回 || { ok: false, reason: 包.错 || '任务失败', code: 'UI_TASK_FAILED' }, 模子 }));
              }
            }
          };
          流.onerror = () => {
            // 流断了不等于任务没了：收掉这一条，让用户按底下的"看这个任务"再看。
            流.close();
            clearInterval(滴);
            出状.textContent = '流断了（任务还在跑：用底下的「看这个任务」再看一眼）';
          };
        });

        /** 出图的产出：一张张画出来，每张都能取回并存进图库。 */
        function 画产出(回) {
          const 产出 = 回.产出 || [];
          清(出放);
          if (!产出.length) { 出放.append(造('div.提示.警', '这回没给产出文件。')); return; }
          出放.append(造('div.提示.成', `跑完了 · 任务号 ${回.任务号 || '（没给）'} · 产出 ${产出.length} 个`));
          const 格 = 造('div.卡片们');
          for (const 一 of 产出) {
            const 盒 = 造('div.卡片', { style: { cursor: 'default' } });
            const 框 = 造('div.图框', { style: { border: '0', borderRadius: '0', minHeight: '120px' } },
              造('div.无', '还没取回来'));
            const 说明 = 造('div', { style: { padding: '6px 8px', borderTop: '1px solid var(--线)' } });
            说明.append(造('div.名', 一.文件名 || '（没文件名）'));
            说明.append(造('div.译', `${一.类型 || ''} ${一.子目录 ? `/ ${一.子目录}` : ''}`));
            const 行 = 造('div.块底', { style: { padding: '6px 8px' } });
            const 存来 = 造('button.钮.小', { type: 'button' }, '存进图库');
            存来.disabled = true;
            const 取 = 造('button.钮.小', { type: 'button' }, '取图');
            取.addEventListener('click', async () => {
              取.disabled = true;
              const { 回: 图 } = await 宿主.调(模块, '取图', { 产出: 一 });
              取.disabled = false;
              if (!图 || 图.ok === false) { 吐司(`取不到：${(图 && 图.reason) || '没回话'}`, '错'); return; }
              取回的 = 图;
              清(框);
              const 咪 = 图.mime || 'image/png';
              const 地址 = 图.字节 ? URL.createObjectURL(new Blob([new Uint8Array(图.字节.data || 图.字节)], { type: 咪 })) : '';
              if (地址) {
                const img = 造('img', { src: 地址, alt: 一.文件名 || '产出' });
                // 点开看原尺寸：新标签页打开这一份对象地址。
                const 大 = 造('a', { href: 地址, target: '_blank', rel: 'noreferrer' }, img);
                框.append(大);
                说明.append(造('div.译', 说字节(图.字节 && (图.字节.length || (图.字节.data || []).length))));
              }
              存来.disabled = false;
            });
            存来.addEventListener('click', async () => {
              if (!取回的) return;
              存来.disabled = true;
              存来.textContent = '存着…';
              const { 回: 成 } = await 宿主.存图({
                作用域: { 存放地: 'gallery' },
                字节: 取回的.字节,
                文件名: 取回的.文件名 || 一.文件名 || '出图.png',
                mime: 取回的.mime || 'image/png',
                来源: 'generation',
                显示名: 一.文件名 || undefined,
              });
              存来.disabled = false;
              if (!成 || 成.ok === false) {
                存来.textContent = '存不上';
                吐司(`存不上：${(成 && 成.reason) || '没回话'}`, '错');
                return;
              }
              存来.textContent = '存好了 · 去「图片」面板看';
            });
            行.append(取, 存来);
            盒.append(框, 说明, 行);
            格.append(盒);
          }
          出放.append(格);
        }
      }

      // ---------- 二、工作流 ----------

      const 图段 = 造('div');
      {
        const 块 = 造('div.块');
        块.append(造('div.栏头', 造('h3', '存着的那张工作流')));
        块.append(造('div.细节', '工作流决定步骤、模型、尺寸、采样参数——这些都在图里，不在这个界面上。'));
        const 图放 = 造('div', { style: { marginTop: '8px' } });
        const 文件框 = 造('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });

        const 存钮 = 造('button.钮.主', { type: 'button' }, 钮话(宿主, '存工作流', '存工作流'));
        存钮.addEventListener('click', () => 文件框.click());
        文件框.addEventListener('change', async () => {
          const 文件 = 文件框.files && 文件框.files[0];
          if (!文件) return;
          if (typeof 文件.text !== 'function') { 吐司('这个壳里读不了本地文件', '警'); return; }
          let 图;
          try { 图 = JSON.parse(await 文件.text()); } catch (错) {
            清(图放).append(造('div.提示.错', `那份文件不是 JSON：${String((错 && 错.message) || 错)}`));
            return;
          }
          const { 回, 耗时 } = await 宿主.调(模块, '存工作流', { 图 });
          清(图放).append(画回执({ 回, 耗时, 模子 }));
          await 看工作流();
        });
        const 取钮 = 造('button.钮', { type: 'button' }, 钮话(宿主, '取工作流', '取工作流'));
        const 认钮 = 造('button.钮', { type: 'button' }, 钮话(宿主, '认', '认口'));
        const 清钮 = 造('button.钮.危', { type: 'button' }, 钮话(宿主, '清工作流', '清工作流'));
        取钮.addEventListener('click', 看工作流);
        认钮.addEventListener('click', 认口);
        清钮.addEventListener('click', async () => {
          const 是 = await 要人填({
            标题: '把存着的那张工作流清掉？',
            身: 造('div.细节', '清掉之后出图会报"没有工作流"。'),
            确定: '清掉',
            危: true,
            要: () => true,
          });
          if (!是) return;
          const { 回, 耗时 } = await 宿主.调(模块, '清工作流', {});
          清(图放).append(画回执({ 回, 耗时, 模子 }));
          await 看工作流();
        });
        块.append(造('div.块底', 存钮, 取钮, 认钮, 清钮, 文件框), 图放);
        图段.append(块);

        async function 看工作流() {
          const { 回, 耗时 } = await 宿主.调(模块, '取工作流', {});
          清(图放);
          if (回 && 回.ok !== false) 图放.append(造('div.提示.成', '存着一张工作流。下面这份回执里有它的全貌（收着的）。'));
          图放.append(画回执({ 回, 耗时, 模子, 收起: true }));
        }

        /** 认口：显示正负图三个口各接在哪个节点上。 */
        async function 认口() {
          清(图放).append(造('div.装填', '认着…'));
          const { 回, 耗时 } = await 宿主.调(模块, '认', {});
          清(图放);
          if (回 && 回.ok !== false) {
            const dl = 造('dl');
            const 说口 = (名, 们) => {
              const 串 = Array.isArray(们) && 们.length
                ? 们.map((一) => (typeof 一 === 'string' ? 一 : (一.节点 ? `节点 ${一.节点}${一.字段 ? ` / ${一.字段}` : ''}` : JSON.stringify(一)))).join(' · ')
                : '（这张图上没有）';
              dl.append(造('dt', 名), 造('dd', 串));
            };
            说口('正向', 回.正向);
            说口('负向', 回.负向);
            说口('图片', 回.图片);
            if (回.采样器不唯一) dl.append(造('dt', '采样器'), 造('dd', '不止一个采样器，只认了主采样器那一组'));
            图放.append(造('div.细节', dl));
          }
          图放.append(画回执({ 回, 耗时, 模子, 收起: Boolean(回 && 回.ok !== false) }));
        }
      }

      // ---------- 分段与起手 ----------

      const 视图 = 分段(
        [{ 值: '出图', 话: '出图' }, { 值: '工作流', 话: '工作流' }],
        '出图',
        (值) => { 清(段放).append(值 === '出图' ? 出段 : 图段); },
      );
      分段条.append(视图.元);
      清(段放).append(出段);

      // 起手先探一次活：省得用户对着一个连不上的地址按半天。
      (async () => {
        const { 回, 耗时 } = await 宿主.调(模块, '探活', {});
        清(连放);
        if (回 && 回.ok !== false) {
          连放.append(造('div.提示.成', { style: { marginTop: '8px' } }, `连得上 · ${JSON.stringify(回).slice(0, 200)}`));
        } else {
          连放.append(画回执({ 回, 耗时, 模子, 收起: true }));
        }
      })();
    },
  };
}
