'use strict';
/*
 * comfyUI 模块 · 内存适配器。自包含，不 require 任何别的模块。
 *
 *   createMemoryAdapter({
 *     节点定义: { KSampler: { output_node:false, input:{…} }, … }   默认一套常用的
 *     产出:     [{ 节点, 种类, 文件名, 子目录, 类型 }, …]           跑完给这些文件
 *     状态序列: ['running','running','success']                     每次看任务前进一格
 *     提交失败: '参数不对' | null                                    提交时返回的失败话
 *     执行失败话: 'CUDA out of memory'                              状态里带 error 时给的错误原文
 *     探活失败: '连不上' | null
 *     文件:     { '文件名': 字节 }                                  取结果文件用
 *   })
 *
 * 返回值：{ 探活, 看队列, 看节点定义, 提交, 看任务, 取结果文件, 送图片, 记 }
 *   记.提交过的  每次提交的入参
 *   记.送过的    每次送图片的入参（文件名 / mime / 字节数）
 *   记.取过的    每次取结果文件的入参
 *   记.看任务次数 看任务被调了几次
 */

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话) => ({ ok: false, reason: `${码}: ${话 || 码}`, code: 码 });

const 默认节点定义 = Object.freeze({
  KSampler: { output_node: false, input: { required: { model: ['MODEL'], seed: ['INT'], steps: ['INT'], cfg: ['FLOAT'], sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['normal', 'karras']], positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'], denoise: ['FLOAT'] } } },
  CLIPTextEncode: { output_node: false, input: { required: { text: ['STRING'], clip: ['CLIP'] } } },
  CheckpointLoaderSimple: { output_node: false, input: { required: { ckpt_name: [['model.safetensors']] } } },
  EmptyLatentImage: { output_node: false, input: { required: { width: ['INT'], height: ['INT'], batch_size: ['INT'] } } },
  VAEDecode: { output_node: false, input: { required: { samples: ['LATENT'], vae: ['VAE'] } } },
  LoadImage: { output_node: false, input: { required: { image: [['a.png']] } } },
  VAEEncode: { output_node: false, input: { required: { pixels: ['IMAGE'], vae: ['VAE'] } } },
  SaveImage: { output_node: true, input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } } },
});

function createMemoryAdapter(选项 = {}) {
  const 节点定义 = 选项.节点定义 || 默认节点定义;
  const 产出 = Array.isArray(选项.产出) && 选项.产出.length
    ? 选项.产出
    : [{ 节点: '9', 种类: 'image', 文件名: 'memory_00001_.png', 子目录: '', 类型: 'output' }];
  const 状态序列 = Array.isArray(选项.状态序列) && 选项.状态序列.length ? 选项.状态序列 : ['running', 'success'];
  const 文件 = 选项.文件 || {};
  const 记 = { 提交过的: [], 送过的: [], 取过的: [], 看任务次数: 0 };
  let 第几次 = 0;
  let 当前任务号 = null;

  async function 探活() {
    if (选项.探活失败) return fail('COMFY_UNREACHABLE', 选项.探活失败);
    return ok({ 版本: 'memory-0.0.1', 设备: '假显卡', 显存总量: 0, 显存可用: 0 });
  }

  async function 看队列() {
    return ok({ 运行中: 当前任务号 ? 1 : 0, 排队中: 0 });
  }

  async function 看节点定义() {
    return ok(节点定义);
  }

  async function 提交(接口图, 附带 = {}) {
    记.提交过的.push({ 接口图, 附带 });
    if (选项.提交失败) return fail('COMFY_PROMPT_REJECTED', 选项.提交失败);
    第几次 += 1;
    当前任务号 = `mem-${第几次}`;
    return ok({ 任务号: 当前任务号 });
  }

  async function 看任务(任务号) {
    记.看任务次数 += 1;
    const 状态 = 状态序列[Math.min(记.看任务次数 - 1, 状态序列.length - 1)];
    if (状态 === 'running') return ok({ 状态: 'running', 完成: false, 产出: [], 错误: [] });
    当前任务号 = null;
    if (/error/i.test(状态)) {
      return ok({ 状态, 完成: true, 产出: [], 错误: [选项.执行失败话 || '假适配器：执行失败'] });
    }
    return ok({ 状态: 'success', 完成: true, 产出, 错误: [] });
  }

  async function 取结果文件(文件名, 位置 = {}) {
    记.取过的.push({ 文件名, 位置 });
    const 值 = 文件[文件名];
    if (!值) return fail('COMFY_FILE_MISSING', `假适配器里没有这个文件：${文件名}`);
    return ok({ 字节: Buffer.isBuffer(值) ? 值 : Buffer.from(值), mime: 'image/png' });
  }

  async function 送图片(字节, 文件名, mime) {
    记.送过的.push({ 文件名, mime, 字节数: 字节 ? 字节.length : 0 });
    return ok({ 文件名: `input-${文件名 || 'a.png'}`, 子目录: '', 类型: 'input' });
  }

  return Object.freeze({ 探活, 看队列, 看节点定义, 提交, 看任务, 取结果文件, 送图片, 记 });
}

module.exports = { createMemoryAdapter };
