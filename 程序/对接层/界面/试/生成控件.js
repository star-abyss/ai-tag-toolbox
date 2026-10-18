'use strict';

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../页/views/settings-view.js');
const { createSettingsView } = globalThis.AppViews.settings;

class Control {
  constructor(value, checked = false) { this.value = String(value); this.checked = checked; this.listeners = new Map(); }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  async change() { for (const listener of this.listeners.get('change') || []) await listener({ target: this }); }
}

const controls = {
  '#settingsImagesPerRound': new Control(1),
  '#maxAutoRounds': new Control(3),
  '#generationAutoRun': new Control('', true),
};
const document = { querySelector: selector => controls[selector] || null };
let saved = { imagesPerRound: 1, maxAutoRounds: 3, generationAutoRun: true };
const writes = [];
const notifications = [];
const changes = [];
let releaseFirst;
let releaseSecond;
let rejectNext = false;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const secondGate = new Promise(resolve => { releaseSecond = resolve; });
let notifySecondStarted;
const secondStarted = new Promise(resolve => { notifySecondStarted = resolve; });
const api = {
  getSettings() { return { ...saved }; },
  async setSettings(patch) {
    writes.push({ ...patch });
    if (rejectNext) { rejectNext = false; throw new Error('存档写入失败'); }
    if (writes.length === 1) await firstGate;
    if (writes.length === 2) { notifySecondStarted(); await secondGate; }
    saved = { ...saved, ...patch };
    return { ...saved };
  },
};
const view = createSettingsView({ document, api, notify: message => notifications.push(message), onChange: value => changes.push(value), autoBind: false });

assert.equal((controls['#settingsImagesPerRound'].listeners.get('change') || []).length, 0, 'autoBind=false leaves binding to the app');
view.render();
view.bind();
controls['#settingsImagesPerRound'].value = '2';
const first = controls['#settingsImagesPerRound'].change();
controls['#generationAutoRun'].checked = false;
const second = controls['#generationAutoRun'].change();
let flushComplete = false;
const flushing = view.flush().then(() => { flushComplete = true; });
(async () => {
  assert.equal(flushComplete, false, 'flush waits while writes are pending');
  releaseFirst();
  await secondStarted;
  assert.equal(flushComplete, false, 'flush waits for later queued writes too');
  releaseSecond();
  await Promise.all([first, second, flushing]);
  assert.deepEqual(writes.map(({ imagesPerRound, generationAutoRun }) => ({ imagesPerRound, generationAutoRun })), [
    { imagesPerRound: 2, generationAutoRun: true },
    { imagesPerRound: 2, generationAutoRun: false },
  ], 'rapid changes are saved in event order');
  assert.deepEqual(saved, { imagesPerRound: 2, maxAutoRounds: 3, generationAutoRun: false }, 'all three settings persist as one snapshot');
  assert.deepEqual(changes.at(-1), saved, 'onChange receives the saved snapshot');
  assert.deepEqual(notifications, []);
  const reopened = createSettingsView({ document, api, notify: message => notifications.push(message), autoBind: false });
  reopened.render();
  assert.equal(controls['#settingsImagesPerRound'].value, '2', 're-entering the settings view restores the saved image count');
  assert.equal(controls['#maxAutoRounds'].value, '3', 're-entering the settings view restores the saved round limit');
  assert.equal(controls['#generationAutoRun'].checked, false, 're-entering the settings view restores the saved iteration switch');
  rejectNext = true;
  controls['#maxAutoRounds'].value = '4';
  await assert.rejects(reopened.update(), /存档写入失败/, 'save failures propagate to the caller');
  assert.deepEqual(notifications, ['存档写入失败'], 'save failures are shown to the user');
  await assert.rejects(reopened.flush(), /存档写入失败/, 'flush propagates a queued save failure to block sending');
  await reopened.update({ imagesPerRound: 2, maxAutoRounds: 4, generationAutoRun: false });
  await reopened.flush();
  console.log('生成控件设置事件与顺序保存通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
