const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateCostUsd } = require('../out/pricing.js');

test('estimateCostUsd: computes cost for a recognized model from prompt+completion tokens', () => {
  // gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
  const cost = estimateCostUsd('gpt-4o-mini', 1_000_000, 1_000_000);
  assert.ok(Math.abs(cost - 0.75) < 1e-9);
});

test('estimateCostUsd: matches by substring (provider-prefixed model names)', () => {
  const cost = estimateCostUsd('openai/gpt-4o-mini-2024-07-18', 1_000_000, 0);
  assert.ok(Math.abs(cost - 0.15) < 1e-9);
});

test('estimateCostUsd: prefers the longer/more specific match (gpt-4o-mini over gpt-4o)', () => {
  const mini = estimateCostUsd('gpt-4o-mini', 1_000_000, 0);
  const full = estimateCostUsd('gpt-4o', 1_000_000, 0);
  assert.notEqual(mini, full);
  assert.ok(Math.abs(mini - 0.15) < 1e-9);
  assert.ok(Math.abs(full - 2.5) < 1e-9);
});

test('estimateCostUsd: returns undefined for unrecognized/local models — never guesses', () => {
  assert.equal(estimateCostUsd('qwen3:14b', 1000, 1000), undefined);
  assert.equal(estimateCostUsd('llama3.1:8b', 1000, 1000), undefined);
  assert.equal(estimateCostUsd('some-custom-finetune', 1000, 1000), undefined);
});

test('estimateCostUsd: zero tokens costs zero for a recognized model', () => {
  assert.equal(estimateCostUsd('gpt-4o-mini', 0, 0), 0);
});
