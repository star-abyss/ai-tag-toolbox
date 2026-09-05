'use strict';

const definitions = [
  { name: 'images', aliases: ['I', 'image', 'conversation.images', 'conversation.images.list', 'conversation_images_list'], aiInput: {}, defaults: { scope: 'currentSession', filter: 'all' }, scope: 'current-session', permission: 'read', maxPerRound: 1, executor: 'conversation.images.list', resultFormatter: 'compactImageManifest' },
  { name: 'vision', aliases: ['V', 'vision.processOne', 'vision_processOne', 'conversation.images.read'], aiInput: { image: { type: 'imageRef', required: true, maxLength: 80 } }, defaults: { mode: 'ai', includeLocalTags: true }, scope: 'current-session-or-current-vision-temp', permission: 'read', maxPerRound: 3, executor: 'vision.processOne', resultFormatter: 'compactVisionResult' },
  { name: 'render', aliases: ['R', 'comfy', 'comfy.render', 'comfy_render'], aiInput: { positiveTags: { type: 'array', required: true, maxItems: 256 }, negativeTags: { type: 'array', maxItems: 256 } }, defaults: { workflow: 'settings.comfyWorkflow', positiveTags: [], negativeTags: [], batchCount: 'settings.batchCount' }, scope: 'current-session', permission: 'external-effect', maxPerRound: 1, executor: 'comfy.render', resultFormatter: 'compactRenderResult' },
  { name: 'title', aliases: ['T', 'N', 'conversation.images.setTitle', 'conversation_images_setTitle'], aiInput: { image: { type: 'imageRef', required: true, maxLength: 80 }, text: { type: 'string', required: true, maxLength: 40 } }, defaults: {}, scope: 'current-session', permission: 'conversation-metadata-write', maxPerRound: 3, executor: 'conversation.images.setTitle', resultFormatter: 'compactTitleResult' },
  { name: 'search', aliases: ['Q', 'tags', 'tags.search', 'tags_search'], aiInput: { query: { type: 'string', required: true, maxLength: 120 }, precision: { type: 'enum', values: ['exact', 'standard', 'broad'] } }, defaults: { includeAdult: 'tagSetting', limit: 50, category: 'currentCategory', precision: 'standard' }, scope: 'tag-library', permission: 'read', maxPerRound: 1, executor: 'tags.search', resultFormatter: 'compactSearchResult' }
];

const table = Object.freeze(Object.fromEntries(definitions.map(item => [item.name, Object.freeze({ ...item, id: item.name, description: item.description || item.name, aiInput: Object.freeze({ ...item.aiInput }), defaults: Object.freeze({ ...item.defaults }), aliases: Object.freeze(item.aliases.slice()) })])));
const aliases = new Map();
for (const item of definitions) {
  aliases.set(item.name.toLowerCase(), item.name);
  for (const alias of item.aliases) aliases.set(String(alias).toLowerCase(), item.name);
}

function getCallDefinition(name) { return table[aliases.get(String(name || '').trim().toLowerCase())] || null; }
function listCallDefinitions() { return definitions.map(item => ({ ...item, id: item.name, description: item.description || item.name, aiInput: { ...item.aiInput }, defaults: { ...item.defaults }, aliases: item.aliases.slice() })); }

module.exports = { callTable: table, CALL_TABLE: table, getCallDefinition, getCall: getCallDefinition, listCallDefinitions, listCalls: listCallDefinitions, resolveCall: getCallDefinition };
