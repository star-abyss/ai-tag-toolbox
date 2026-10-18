'use strict';

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../页/views/comfy-view.js');
const { createComfyView } = globalThis.AppViews.comfy;

class Element {
  constructor(value = '') { this.value = value; this.checked = false; this.dataset = {}; this.listeners = new Map(); this.children = []; this.options = []; this.type = 'text'; this.tagName = 'TEXTAREA'; this.disabled = false; this.textContent = ''; this.className = ''; this.style = {}; }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
  async emit(type) { for (const fn of this.listeners.get(type) || []) await fn({ currentTarget: this, target: this }); }
  replaceChildren(...children) { this.children = children; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute() {}
  click() {}
}
const fields = {
  '#comfyBase': new Element('http://a'),
  '#comfyWf': new Element(JSON.stringify({ nodes: [{ id: 1, type: 'A', widgets_values: [1] }], links: [] })),
  '#comfyParameters': new Element(),
  '#comfyOn': new Element(),
};
const document = { activeElement: null, querySelector: selector => fields[selector] || null, createElement: () => new Element(), defaultView: {} };
let base = 'http://initial', workflow = { nodes: [{ id: 1, type: 'A', widgets_values: [1] }], links: [] };
let releaseBase, releaseWorkflow;
const writes = [];
const comfy = {
  getBase: () => base,
  getWorkflow: () => workflow,
  async setBase(value) { writes.push(['base-start', value]); if (value === 'http://a') await new Promise(resolve => { releaseBase = resolve; }); base = value; writes.push(['base-end', value]); },
  async setWorkflow(value) { writes.push(['workflow-start', value.nodes[0].widgets_values[0]]); if (value.nodes[0].widgets_values[0] === 2) await new Promise(resolve => { releaseWorkflow = resolve; }); workflow = value; writes.push(['workflow-end', value.nodes[0].widgets_values[0]]); },
  async clearWorkflow() { workflow = null; },
  async parameters() { return { 节点: [] }; },
  async status() { return { connected: false }; },
};
const api = { getSettings: () => ({ comfyOn: false }), setSettings: async patch => ({ ...patch }) };
const view = createComfyView({ document, comfy, assistant: api, notify: () => {}, autoBind: false });
view.bind();

fields['#comfyBase'].value = 'http://a';
fields['#comfyBase'].emit('input');
await new Promise(resolve => setTimeout(resolve, 420));
fields['#comfyBase'].value = 'http://b';
fields['#comfyBase'].emit('input');
const flushAddress = view.flush();
releaseBase();
await flushAddress;
assert.equal(base, 'http://b', 'flush persists address B after address A finishes');
assert.deepEqual(writes.filter(row => row[0] === 'base-start').map(row => row[1]), ['http://a', 'http://b']);

fields['#comfyWf'].value = JSON.stringify({ nodes: [{ id: 1, type: 'A', widgets_values: [2] }], links: [] });
await fields['#comfyWf'].emit('input');
const saveFirst = view.save();
await new Promise(resolve => setImmediate(resolve));
fields['#comfyWf'].value = JSON.stringify({ nodes: [{ id: 1, type: 'A', widgets_values: [3] }], links: [] });
await fields['#comfyWf'].emit('input');
releaseWorkflow();
await saveFirst;
assert.equal(view.snapshot().comfyWorkflow, fields['#comfyWf'].value, 'in-flight save does not overwrite later JSON draft');
assert.equal(workflow.nodes[0].widgets_values[0], 2, 'later JSON draft remains unsaved until explicit save');
await view.save();
assert.equal(workflow.nodes[0].widgets_values[0], 3, 'explicit save commits the newest JSON draft');
console.log('Comfy 地址和 JSON 草稿在飞写入并发通过');
