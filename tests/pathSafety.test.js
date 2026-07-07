const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveInside } = require('../out/pathSafety.js');

const root = process.platform === 'win32' ? 'C:\\project' : '/project';

test('resolveInside: resolves a normal relative path under the root', () => {
  const abs = resolveInside(root, 'src/index.ts');
  assert.equal(abs, path.resolve(root, 'src/index.ts'));
});

test('resolveInside: "." resolves to the root itself', () => {
  assert.equal(resolveInside(root, '.'), path.resolve(root));
});

test('resolveInside: empty string behaves like "."', () => {
  assert.equal(resolveInside(root, ''), path.resolve(root));
});

test('resolveInside: rejects a simple ../ escape', () => {
  assert.throws(() => resolveInside(root, '../outside.txt'), /escapes the project folder/);
});

test('resolveInside: rejects a deep ../../ escape', () => {
  assert.throws(() => resolveInside(root, '../../../etc/passwd'), /escapes the project folder/);
});

test('resolveInside: rejects an absolute path outside the root', () => {
  const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc';
  assert.throws(() => resolveInside(root, outside), /escapes the project folder/);
});

test('resolveInside: allows nested paths that merely start with the root name', () => {
  // A sibling folder that shares a prefix with root must NOT be treated as "inside".
  const sibling = process.platform === 'win32' ? 'C:\\project-evil\\file.txt' : '/project-evil/file.txt';
  assert.throws(() => resolveInside(root, sibling), /escapes the project folder/);
});
