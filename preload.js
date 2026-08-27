// AI 绘画 Tag 工具箱 - 预加载桥
// 把主进程的本地 WD Tagger 推理能力安全地暴露给前端
const { contextBridge, ipcRenderer } = require('electron');

const aiCallbacks = new Map();
let aiSeq = 0;
ipcRenderer.on('ai:delta', (ev, payload) => {
  const cb = aiCallbacks.get(payload && payload.requestId);
  if (cb && cb.onDelta) {
    try { cb.onDelta(payload.content || '', payload.reasoning || ''); } catch (e) {}
  }
});
ipcRenderer.on('ai:done', (ev, payload) => {
  const id = payload && payload.requestId;
  // send() 事件与 invoke() 完成通知的顺序在不同 Electron 版本中可能不同，
  // 延后一拍清理，确保最后一批 delta 已交给渲染进程回调。
  setTimeout(() => aiCallbacks.delete(id), 0);
});

contextBridge.exposeInMainWorld('aiTag', {
  // 查询本地识图模型是否可用（返回 {available, models:[{id,name,available}]}）
  available: () => ipcRenderer.invoke('tag:available'),
  // 运行识图：pixels = Float32Array(448*448*3) BGR 0-255，model = 'eva02'，返回 {ok, tags:[{tag,category,prob}]}
  run: (pixels, size, threshold, model) => ipcRenderer.invoke('tag:run', { pixels, size, threshold, model }),
  // 获取指定模型的完整标签表（{ok, id, name, tags:[{name,category,count}]}）
  tags: (model) => ipcRenderer.invoke('tag:tags', { model }),
  // 把工作流推送到应用内 ComfyUI 窗口（载入工作流 + 写入正向/负面提示词）
  // data = {url, workflowJson, prompt, negative}，返回 {ok, msg?, nodes?}
  pushComfyWorkflow: (data) => ipcRenderer.invoke('comfy:push', data),
  // API Key 与 AI 请求由主进程处理；渲染进程只接收结果增量。
  ai: {
    keyStatus: () => ipcRenderer.invoke('ai:key:status'),
    keySet: (key) => ipcRenderer.invoke('ai:key:set', { key }),
    keyClear: () => ipcRenderer.invoke('ai:key:clear'),
    cancel: (requestId) => ipcRenderer.invoke('ai:cancel', { requestId }),
    complete: (messages, options) => {
      options = options || {};
      const requestId = options.requestId || ('ai_' + Date.now() + '_' + (++aiSeq));
      const stream = !!options.stream;
      let abortFn = null;
      const promise = new Promise((resolve, reject) => {
        aiCallbacks.set(requestId, { onDelta: options.onDelta });
        abortFn = () => { ipcRenderer.invoke('ai:cancel', { requestId }).catch(() => {}); };
        ipcRenderer.invoke('ai:complete', {
          requestId,
          base: options.base,
          model: options.model,
          messages,
          stream,
          maxTokens: options.maxTokens || 0,
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.7
        }).then(resolve, reject).finally(() => {
          if (!stream) aiCallbacks.delete(requestId);
        });
      });
      return promise;
    }
  },
  // 本地离线翻译模型（Transformers.js，模型随应用分发）
  translation: {
    available: () => ipcRenderer.invoke('translation:available'),
    run: (text, direction) => ipcRenderer.invoke('translation:run', { text, direction })
  },
  locale: {
    list: () => ipcRenderer.invoke('locale:list'),
    read: id => ipcRenderer.invoke('locale:read', id),
    import: pack => ipcRenderer.invoke('locale:import', pack)
  }
});
