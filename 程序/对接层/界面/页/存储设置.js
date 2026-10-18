'use strict';

/* 存储位置与本地模型选择面板。 */
(function installStorageSettings(root) {
  const doc = root.document;
  if (!doc) return;
  const $ = id => doc.getElementById(id);
  const status = $('storageStatus');
  const explain = value => value?.reason || value?.message || '请求失败';

  async function post(route, body = {}) {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toolbox-token': root.__令牌__ || '' },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok || value?.ok === false) throw new Error(explain(value));
    return value;
  }

  function showModels(list) {
    const choices = [
      ['vision', 'storageVisionModel'],
      ['translation', 'storageTranslationModel'],
    ];
    for (const [kind, id] of choices) {
      const select = $(id);
      const models = Array.isArray(list?.[kind]) ? list[kind] : [];
      select.replaceChildren();
      const automatic = doc.createElement('option');
      automatic.value = '';
      automatic.textContent = '自动选择已安装模型';
      select.append(automatic);
      for (const model of models) {
        const option = doc.createElement('option');
        option.value = model.id;
        option.textContent = `${model.名字 || model.id}${model.装好了 ? '' : `（缺少：${(model.缺什么 || []).join('、')}）`}`;
        option.disabled = !model.装好了;
        option.selected = model.这次用 === true;
        select.append(option);
      }
      if (!models.some(model => model.这次用)) select.value = '';
      select.onchange = async () => {
        select.disabled = true;
        try {
          const result = await post('/toolbox/模型', { 换: { 类别: kind, id: select.value } });
          if (result.ok !== true) throw new Error(explain(result));
          showModels(result.data);
          status.textContent = '模型选择已保存。';
        } catch (error) {
          status.textContent = explain(error);
          await refreshModels();
        } finally {
          select.disabled = false;
        }
      };
    }
  }

  async function refreshModels() {
    const result = await post('/toolbox/模型');
    showModels(result.data);
    return result.data;
  }

  async function refreshLocation() {
    const result = await post('/toolbox/存储');
    const location = result.data || {};
    $('storageDataPath').textContent = location.数据目录 || '未设置';
    $('storageModelPath').textContent = location.模型目录 || location.程序目录 || '未设置';
    $('storageDataInput').value = location.下次数据目录 || location.数据目录 || '';
    $('storageDataNext').textContent = location.下次数据目录 && location.下次数据目录 !== location.数据目录
      ? `下次启动将使用：${location.下次数据目录}`
      : '下次启动仍使用当前数据目录。';
  }

  $('storageDataSave')?.addEventListener('click', async () => {
    const button = $('storageDataSave');
    button.disabled = true;
    try {
      const result = await post('/toolbox/存储', { 数据目录: $('storageDataInput').value.trim() });
      const location = result.data || {};
      $('storageDataPath').textContent = location.数据目录 || '未设置';
      $('storageDataInput').value = location.下次数据目录 || '';
      $('storageDataNext').textContent = `已保存。下次启动将使用：${location.下次数据目录 || ''}；现有数据不会自动移动。`;
      status.textContent = '数据位置已保存。';
    } catch (error) {
      status.textContent = explain(error);
    } finally {
      button.disabled = false;
    }
  });

  $('storageModelRefresh')?.addEventListener('click', async () => {
    try {
      await refreshModels();
      status.textContent = '模型列表已刷新。';
    } catch (error) {
      status.textContent = explain(error);
    }
  });

  Promise.all([refreshLocation(), refreshModels()]).catch(error => {
    status.textContent = explain(error);
  });
})(typeof window !== 'undefined' ? window : globalThis);
