const test = require('node:test');
const assert = require('node:assert/strict');
const { diffLines, safeDiffLines } = require('../out/diff.js');

test('diffLines: no changes yields only context lines', () => {
  const text = 'a\nb\nc\n';
  const d = diffLines(text, text);
  assert.ok(d.every((l) => l.type === 'ctx'));
});

test('diffLines: detects an added line', () => {
  const d = diffLines('a\nb\n', 'a\nb\nc\n');
  const added = d.filter((l) => l.type === 'add').map((l) => l.text);
  assert.deepEqual(added, ['c']);
});

test('diffLines: detects a removed line', () => {
  const d = diffLines('a\nb\nc\n', 'a\nc\n');
  const removed = d.filter((l) => l.type === 'del').map((l) => l.text);
  assert.deepEqual(removed, ['b']);
});

test('diffLines: a changed line shows as del+add, not ctx', () => {
  const d = diffLines('x\nold\ny\n', 'x\nnew\ny\n');
  // Both texts end in '\n', so split('\n') yields a trailing '' element that also matches as ctx.
  assert.deepEqual(
    d.map((l) => l.type),
    ['ctx', 'del', 'add', 'ctx', 'ctx']
  );
});

test('diffLines: empty old text (new file) is all additions', () => {
  const d = diffLines('', 'one\ntwo\n');
  assert.ok(d.every((l) => l.type === 'add'));
  assert.equal(d.length, 3); // 'one', 'two', '' (trailing split)
});

test('safeDiffLines: falls back to a simplified del+add list for huge files', () => {
  const bigOld = Array.from({ length: 2000 }, (_, i) => `old${i}`).join('\n');
  const bigNew = Array.from({ length: 2000 }, (_, i) => `new${i}`).join('\n');
  const d = safeDiffLines(bigOld, bigNew, 1200);
  // Fallback path: everything old is 'del', everything new is 'add' (capped), no fine-grained diff.
  assert.ok(d.length <= 1200);
  assert.ok(d.every((l) => l.type === 'del' || l.type === 'add'));
});

test('safeDiffLines: uses the precise algorithm under the size limit', () => {
  const d = safeDiffLines('a\nb\n', 'a\nb\nc\n', 1200);
  assert.deepEqual(
    d.map((l) => l.type),
    ['ctx', 'ctx', 'add', 'ctx']
  );
});
