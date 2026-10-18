'use strict';

function createFakeAdapter(options = {}) {
  const textProcessor = options.文本处理;
  if (!textProcessor || typeof textProcessor.切分 !== 'function' || typeof textProcessor.拼装 !== 'function' ||
    typeof textProcessor.猜方向 !== 'function' || typeof textProcessor.需翻译 !== 'function') {
    throw new Error('假适配器要由调用方传入 文本处理');
  }

  const dictionary = options.词表 && typeof options.词表 === 'object' ? options.词表 : {};
  function 查词(words) {
    if (typeof options.查词 === 'function') return options.查词(words);
    return words.map(word => dictionary[word] === undefined ? null : dictionary[word]);
  }

  async function 译(payload) {
    if (typeof options.译 === 'function') return options.译(payload);
    return {
      模型: '假模型',
      units: payload.units.map(unit => ({ id: unit.id, text: `译:${unit.text}` })),
    };
  }

  return { 文本处理: textProcessor, 查词, 译 };
}

module.exports = { createFakeAdapter };
