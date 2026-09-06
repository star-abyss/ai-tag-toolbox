'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageRepository } = require('../src/modules/image-repository');

function fixture() {
  const values = new Map([
    ['img-1', { id: 'img-1', filename: 'one.png', source: 'upload' }],
    ['img-2', { id: 'img-2', filename: 'two.png', source: 'comfy' }]
  ]);
  const writes = new Map();
  const sessions = [{ id: 'session-1', messages: [{ id: 'm-1', imageIds: ['img-1'] }] }];
  const images = {
    get: id => values.get(id) || null,
    remove: id => values.delete(id)
  };
  const storage = {
    get: (key, fallback) => writes.has(key) ? writes.get(key) : fallback,
    set: (key, value) => { writes.set(key, value); return value; }
  };
  return { values, writes, sessions, images, storage };
}

test('initializes conversation references from current session messages without legacy migration state', () => {
  const f = fixture();
  const repository = createImageRepository({ images: f.images, storage: f.storage, sessions: () => f.sessions });

  assert.deepEqual(repository.listConversation('session-1').items.map(item => item.imageId), ['img-1']);
  assert.equal(f.writes.has('legacy_collection_image_state'), false);
  assert.equal(f.writes.has('image_repository_migrated_v1'), false);
  assert.equal(typeof repository.migrateLegacy, 'undefined');
  assert.equal(typeof repository.finalizeMigration, 'undefined');
});

test('deleting a session removes only orphaned physical assets and keeps gallery references', () => {
  const f = fixture();
  const repository = createImageRepository({ images: f.images, storage: f.storage, sessions: () => f.sessions });
  repository.addToGallery('img-1');

  const result = repository.deleteSession('session-1');

  assert.equal(result.deletedImages, 0);
  assert.equal(f.values.has('img-1'), true);
  assert.equal(repository.listGallery().items[0].imageId, 'img-1');
});

test('clearing conversation images removes conversation references and orphaned files but keeps gallery files', () => {
  const f = fixture();
  const repository = createImageRepository({ images: f.images, storage: f.storage, sessions: () => f.sessions });
  repository.attachToConversation('session-1', 'img-2', { source: 'upload' });
  repository.addToGallery('img-2');

  const result = repository.clearConversationImages('session-1');

  assert.equal(result.removed, 2);
  assert.equal(result.deletedImages, 1);
  assert.deepEqual(repository.listConversation('session-1').items, []);
  assert.equal(f.values.has('img-1'), false);
  assert.equal(f.values.has('img-2'), true);
  assert.equal(repository.reconcileSessionMessages('session-1'), 0);
});

