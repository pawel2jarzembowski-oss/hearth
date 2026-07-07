// Tests OllamaClient/listModels/pullModel against a fake local HTTP server that speaks
// Ollama's newline-delimited-JSON streaming format, so these run without a real Ollama install.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { OllamaClient, listModels, pullModel } = require('../out/ollama.js');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function endpointOf(server) {
  return `http://127.0.0.1:${server.address().port}`;
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

test('OllamaClient.chatStream: streams content deltas and parses a tool call', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { role: 'assistant', content: 'Sure, ' } }) + '\n');
    res.write(JSON.stringify({ message: { role: 'assistant', content: 'creating it.' } }) + '\n');
    res.write(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'write_file', arguments: { path: 'a.txt', content: 'hi' } } }],
        },
        done: true,
      }) + '\n'
    );
    res.end();
  });
  try {
    const client = new OllamaClient(endpointOf(server), 'test-model');
    let streamed = '';
    const res = await client.chatStream([{ role: 'user', content: 'make a file' }], [], (d) => (streamed += d));
    assert.equal(streamed, 'Sure, creating it.');
    assert.equal(res.content, 'Sure, creating it.');
    assert.equal(res.toolCalls.length, 1);
    assert.equal(res.toolCalls[0].function.name, 'write_file');
    assert.deepEqual(res.toolCalls[0].function.arguments, { path: 'a.txt', content: 'hi' });
  } finally {
    server.close();
  }
});

test('OllamaClient.chatStream: captures token usage from the final done:true chunk', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { content: 'hi there' } }) + '\n');
    res.write(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 40, eval_count: 7 }) + '\n');
    res.end();
  });
  try {
    const client = new OllamaClient(endpointOf(server), 'test-model');
    const res = await client.chatStream([{ role: 'user', content: 'hi' }], [], () => {});
    assert.deepEqual(res.usage, { promptTokens: 40, completionTokens: 7 });
  } finally {
    server.close();
  }
});

test('OllamaClient.chatStream: parses string-encoded tool call arguments too', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(
      JSON.stringify({
        message: { content: '', tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"b.txt"}' } }] },
        done: true,
      }) + '\n'
    );
    res.end();
  });
  try {
    const client = new OllamaClient(endpointOf(server), 'test-model');
    const res = await client.chatStream([{ role: 'user', content: 'read it' }], [], () => {});
    assert.deepEqual(res.toolCalls[0].function.arguments, { path: 'b.txt' });
  } finally {
    server.close();
  }
});

test('OllamaClient.ping: reports ok when the model endpoint responds', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ details: { family: 'qwen3' } }));
  });
  try {
    const client = new OllamaClient(endpointOf(server), 'test-model');
    const r = await client.ping();
    assert.equal(r.ok, true);
  } finally {
    server.close();
  }
});

test('OllamaClient.ping: reports not-ok when the server is unreachable', async () => {
  const client = new OllamaClient('http://127.0.0.1:1', 'test-model'); // port 1: nothing listens
  const r = await client.ping();
  assert.equal(r.ok, false);
});

test('listModels: parses /api/tags into a plain model list', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'qwen3:14b', size: 123 }, { name: 'llama3.1:8b', size: 456 }] }));
  });
  try {
    const models = await listModels(endpointOf(server));
    assert.deepEqual(models, [
      { name: 'qwen3:14b', size: 123 },
      { name: 'llama3.1:8b', size: 456 },
    ]);
  } finally {
    server.close();
  }
});

test('pullModel: reports progress and resolves on success', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
    res.write(JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) + '\n');
    res.write(JSON.stringify({ status: 'success' }) + '\n');
    res.end();
  });
  try {
    const seen = [];
    await pullModel(endpointOf(server), 'llama3.1:8b', (status, completed, total) => seen.push({ status, completed, total }));
    assert.equal(seen.length, 3);
    assert.equal(seen[1].completed, 50);
    assert.equal(seen[2].status, 'success');
  } finally {
    server.close();
  }
});

test('pullModel: rejects when the stream reports an error object', async () => {
  const server = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ error: 'model not found' }) + '\n');
    res.end();
  });
  try {
    await assert.rejects(
      () => pullModel(endpointOf(server), 'does-not-exist:1b', () => {}),
      /model not found/
    );
  } finally {
    server.close();
  }
});
