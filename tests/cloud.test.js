// Tests CloudClient against a fake local HTTP server that speaks OpenAI's SSE streaming
// format, including tool-call arguments split across multiple chunks (as real providers do).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { CloudClient } = require('../out/cloud.js');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function baseUrlOf(server) {
  return `http://127.0.0.1:${server.address().port}`;
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}
function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

test('CloudClient.chatStream: reconstructs a tool call streamed across multiple chunks', async () => {
  const server = await startServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { content: 'On it' } }] });
    sse(res, {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '' } }] } }],
    });
    sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"a.txt",' } }] } }] });
    sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"hi"}' } }] } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  try {
    const client = new CloudClient(baseUrlOf(server), 'test-key', 'gpt-4o-mini');
    let streamed = '';
    const res = await client.chatStream([{ role: 'user', content: 'make a file' }], [], (d) => (streamed += d));
    assert.equal(streamed, 'On it');
    assert.equal(res.toolCalls.length, 1);
    assert.equal(res.toolCalls[0].id, 'call_1');
    assert.equal(res.toolCalls[0].function.name, 'write_file');
    assert.deepEqual(res.toolCalls[0].function.arguments, { path: 'a.txt', content: 'hi' });
  } finally {
    server.close();
  }
});

test('CloudClient.chatStream: handles two independent tool calls by index', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"path":"x"}' } }] } }] });
    sse(res, { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'read_file', arguments: '{"path":"y"}' } }] } }] });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  try {
    const client = new CloudClient(baseUrlOf(server), 'test-key', 'gpt-4o-mini');
    const res = await client.chatStream([{ role: 'user', content: 'read two files' }], [], () => {});
    assert.equal(res.toolCalls.length, 2);
    assert.deepEqual(res.toolCalls.map((c) => c.function.arguments.path).sort(), ['x', 'y']);
  } finally {
    server.close();
  }
});

test('CloudClient.chatStream: captures usage from the final choices-empty chunk', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { content: 'hi' } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
    // OpenAI's stream_options.include_usage sends a trailing chunk with EMPTY choices and the totals.
    sse(res, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  try {
    const client = new CloudClient(baseUrlOf(server), 'test-key', 'gpt-4o-mini');
    const res = await client.chatStream([{ role: 'user', content: 'hi' }], [], () => {});
    assert.deepEqual(res.usage, { promptTokens: 12, completionTokens: 3 });
  } finally {
    server.close();
  }
});

test('CloudClient.ping: fails cleanly with no API key', async () => {
  const client = new CloudClient('http://127.0.0.1:1', '', 'gpt-4o-mini');
  const r = await client.ping();
  assert.equal(r.ok, false);
  assert.match(r.detail, /API key/);
});

test('CloudClient.ping: succeeds against a reachable /models endpoint', async () => {
  const server = await startServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }));
  });
  try {
    const client = new CloudClient(baseUrlOf(server), 'test-key', 'gpt-4o-mini');
    const r = await client.ping();
    assert.equal(r.ok, true);
  } finally {
    server.close();
  }
});

test('CloudClient.chatStream: rejects on a 4xx HTTP error with the response body', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
  });
  try {
    const client = new CloudClient(baseUrlOf(server), 'bad-key', 'gpt-4o-mini');
    await assert.rejects(
      () => client.chatStream([{ role: 'user', content: 'hi' }], [], () => {}),
      /invalid api key/
    );
  } finally {
    server.close();
  }
});
