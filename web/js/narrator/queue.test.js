import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, admit, canInterrupt, sparseReady, SPARSE_GAP } from './queue.js';

const L = (id, priority, ttl = 10, text = 'Line ' + id + '.') => ({ id, text, kind: 'ambient', priority, ttl });

test('highest priority first, then oldest', () => {
  const q = createQueue();
  q.push(L(1, 0), 0);
  q.push(L(2, 1), 0.1);
  q.push(L(3, 1), 0.2);
  q.push(L(4, 2), 0.3);
  assert.deepEqual([q.take(1).id, q.take(1).id, q.take(1).id, q.take(1).id], [4, 2, 3, 1]);
  assert.equal(q.take(1), null);
});

test('stale lines expire on TTL', () => {
  const q = createQueue();
  q.push(L(1, 2, 5), 0);
  q.push(L(2, 0, 30), 0);
  assert.equal(q.peek(4.9).id, 1);
  assert.equal(q.take(5.1).id, 2);
  assert.equal(q.size, 0);
});

test('duplicates are ignored; overflow drops the lowest priority oldest line', () => {
  const q = createQueue({ maxLen: 3 });
  assert.equal(q.push(L(1, 1), 0), true);
  assert.equal(q.push({ ...L(9, 1), text: 'Line 1.' }, 0), false);
  q.push(L(2, 0), 0);
  q.push(L(3, 2), 0);
  assert.equal(q.push(L(4, 1), 0), true); // drops line 2 (priority 0)
  assert.deepEqual(q.list().map((x) => x.id).sort(), [1, 3, 4]);
  assert.equal(q.push(L(5, 0), 0), false); // the new one is itself the worst
});

test('interruption only for priority >= 2 against priority 0', () => {
  assert.equal(canInterrupt(L(1, 0), L(2, 2)), true);
  assert.equal(canInterrupt(L(1, 0), L(2, 3)), true);
  assert.equal(canInterrupt(L(1, 0), L(2, 1)), false);
  assert.equal(canInterrupt(L(1, 1), L(2, 3)), false);
  assert.equal(canInterrupt(L(1, 2), L(2, 3)), false);
  assert.equal(canInterrupt(null, L(2, 3)), false);
});

test('frequency setting: off, sparse, normal, chatty', () => {
  assert.equal(admit(L(1, 3), 'off'), false);
  assert.equal(admit(L(1, 0), 'sparse'), false);
  assert.equal(admit(L(1, 1), 'sparse'), true);
  assert.equal(admit(L(1, 0), 'normal'), true);
  assert.equal(admit(L(1, 0), 'chatty'), true);
  assert.equal(admit({ priority: 2 }, 'normal'), false); // no text
  const q = createQueue();
  assert.equal(q.push(L(1, 0), 0, 'sparse'), false);
  assert.equal(q.push(L(2, 1), 0, 'off'), false);
});

test('sparse allows one line per 90 s (milestones exempt)', () => {
  assert.equal(sparseReady('sparse', null, 0, 1), true);
  assert.equal(sparseReady('sparse', 10, 10 + SPARSE_GAP - 1, 1), false);
  assert.equal(sparseReady('sparse', 10, 10 + SPARSE_GAP, 1), true);
  assert.equal(sparseReady('sparse', 10, 11, 3), true);
  assert.equal(sparseReady('normal', 10, 11, 0), true);
});

test('requeue keeps the original expiry', () => {
  const q = createQueue();
  q.push(L(1, 2, 10), 0);
  const it = q.take(1);
  assert.equal(q.requeue(it, 5), true);
  assert.equal(q.peek(9.9).id, 1);
  assert.equal(q.peek(10.1), null);
  assert.equal(q.requeue(it, 11), false);
});

test('a newer identification line replaces a queued older one', () => {
  const q = createQueue();
  q.push({ id: 1, text: 'Hm. That does not fit.', kind: 'identify', priority: 3, ttl: 20 }, 0);
  q.push({ id: 2, text: 'A wren. Of course.', kind: 'identify', priority: 3, ttl: 20 }, 1);
  q.push({ id: 3, text: 'Lovely morning.', kind: 'ambient', priority: 0, ttl: 20 }, 1);
  const texts = q.list().map((it) => it.text);
  assert.deepEqual(texts, ['A wren. Of course.', 'Lovely morning.']);
});
