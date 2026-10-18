import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 临时项目 } from './会话装置.js';

const fixture = 临时项目();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-comfy-address-'));
let waiting;
let entered;
const reachedHistory = new Promise(resolve => { entered = resolve; });
const fake = http.createServer(async (req, res) => {
  for await (const _ of req) { }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/prompt') { res.end(JSON.stringify({prompt_id:'address-flight'})); return; }
  if (req.url.startsWith('/history/')) { waiting = res; entered(); return; }
  res.end(JSON.stringify({system:{comfyui_version:'address-test'},devices:[]}));
});
await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${fake.address().port}`;
let server;
let base;
async function start() {
  server = 起({端口:0,项目根:fixture.root,数据目录:dir});
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  await server.宿主.ready;
  base = `http://127.0.0.1:${server.address().port}`;
}
async function post(route, body={}) {
  return fetch(base+route,{method:'POST',headers:{'content-type':'application/json','x-toolbox-token':这次启动的令牌},body:JSON.stringify(body)}).then(r=>r.json());
}
try {
  await start();
  const defaults = await post('/toolbox/设置');
  assert.equal(typeof defaults.data.comfyUI地址, 'string', 'settings returns the actual configured ComfyUI address');
  assert.equal((await post('/toolbox/设置',{存:{comfyUI地址:address}})).ok,true);
  assert.equal((await post('/toolbox/调',{模块:'comfy',动作:'探活'})).版本,'address-test','saved address changes the actual backend request');
  assert.equal((await post('/toolbox/设置',{存:{comfyUI地址:''}})).ok,false,'empty address is rejected with a visible receipt');
  assert.equal((await post('/toolbox/设置')).data.comfyUI地址,address,'failed edit preserves saved address');
  await server.停止(); server=null;
  await start();
  assert.equal((await post('/toolbox/设置')).data.comfyUI地址,address);
  assert.equal((await post('/toolbox/调',{模块:'comfy',动作:'探活'})).版本,'address-test','restart restores the actual saved endpoint');
  const graph = {
    '1':{class_type:'CLIPTextEncode',inputs:{text:'address test'}},
    '2':{class_type:'EmptyLatentImage',inputs:{width:64,height:64,batch_size:1}},
    '3':{class_type:'KSampler',inputs:{positive:['1',0],negative:['1',0],latent_image:['2',0],seed:1,steps:1,cfg:1,sampler_name:'euler',scheduler:'normal',denoise:1}},
    '4':{class_type:'SaveImage',inputs:{images:['3',0]}},
  };
  await post('/toolbox/调',{模块:'comfy',动作:'存工作流',参数:{图:graph}});
  await post('/toolbox/调',{模块:'comfy',动作:'绘图开关',参数:{启用:true}});
  const drawing = post('/toolbox/调',{模块:'comfy',动作:'出图',参数:{正向:'test'}});
  await reachedHistory;
  const busy = await post('/toolbox/设置',{存:{comfyUI地址:'http://127.0.0.1:1'}});
  assert.equal(busy.ok,false,'in-flight job cannot switch its endpoint');
  assert.match(busy.reason,/COMFY_BUSY/);
  assert.equal((await post('/toolbox/设置')).data.comfyUI地址,address);
  waiting.end(JSON.stringify({'address-flight':{status:{status_str:'success',completed:true},outputs:{}}}));
  await drawing;
  console.log('通过：地址保存影响实际后端请求、失败不覆盖、重启保持、出图中拒绝切换地址');
} finally {
  await server?.停止();
  fake.closeAllConnections();
  await new Promise(resolve=>fake.close(resolve));
  fixture.cleanup();
  fs.rmSync(dir,{recursive:true,force:true});
}
