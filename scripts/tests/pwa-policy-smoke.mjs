import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
let options;
const source = ts.transpileModule(fs.readFileSync('next.config.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(source, { exports, process: { env: { NODE_ENV: 'production' } }, require(name) {
  assert.equal(name, '@ducanh2912/next-pwa');
  return { runtimeCaching: require(name).runtimeCaching, default(value) { options = value; return (config) => config; } };
} });
const origin = 'https://erp.test';
function rule(path, init = {}) {
  const url = new URL(path, origin);
  const request = { mode: 'cors', destination: '', headers: new Headers(), ...init };
  return options.workboxOptions.runtimeCaching.find((r) => typeof r.urlPattern === 'function'
    ? r.urlPattern({ url, request, sameOrigin: url.origin === origin })
    : typeof r.urlPattern?.test === 'function' ? r.urlPattern.test(url.href) : false);
}
assert.equal(options.cacheStartUrl, false); assert.equal(options.dynamicStartUrl, false);
assert.equal(rule('/api/customers').handler, 'NetworkOnly');
assert.equal(rule('/clientes', { mode: 'navigate' }).handler, 'NetworkOnly');
assert.equal(rule('/clientes', { headers: new Headers({ RSC: '1' }) }).handler, 'NetworkOnly');
assert.equal(rule('https://radio.test/ao-vivo.m3u8'), undefined);
assert.equal(rule('https://radio.test/stream', { destination: 'audio' }), undefined);
console.log('PASS: configuracao real mantem APIs/paginas/RSC sem cache e exclui streams externos');

const exclude = options.workboxOptions.exclude.find((condition) => typeof condition === 'function');
for (const name of ['app-build-manifest.json', '_next/build-manifest.json', '_next/react-loadable-manifest.json', '_next/server/middleware-build-manifest.js']) {
  assert.ok(options.workboxOptions.exclude.some((condition) => typeof condition.test === 'function' && condition.test(name)));
}
const chunk = { files: new Set(['codec.hash.js']) };
const compilation = { chunks: [chunk], chunkGraph: { getChunkModulesIterable: () => [
  { identifier: () => 'C:\\projeto\\node_modules\\heic-to\\dist\\csp\\index.js' },
] } };
assert.equal(exclude({ asset: { name: 'codec.hash.js' }, compilation }), true);
assert.equal(exclude({ asset: { name: 'main.hash.js' }, compilation }), false);
compilation.chunkGraph.getChunkModulesIterable = () => [{ identifier: () => '/projeto/src/app/page.tsx' }];
assert.equal(exclude({ asset: { name: 'codec.hash.js' }, compilation }), false);
console.log('PASS: somente chunk com codec HEIC e excluido do precache, sem depender do hash');

const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(server, 'listening');
server.on('connection', (socket) => socket.on('message', (data) => socket.send(data)));
const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
try {
  await once(client, 'open');
  const reply = once(client, 'message'); client.send('teste sintetico websocket');
  assert.equal((await reply)[0].toString(), 'teste sintetico websocket');
  const pong = once(client, 'pong'); client.ping('teste'); assert.equal((await pong)[0].toString(), 'teste');
  const closed = once(client, 'close'); client.close(1000); assert.equal((await closed)[0], 1000);
  console.log('PASS: ws atualizado conecta, troca mensagem, responde ping e encerra normalmente');
} finally { client.terminate(); for (const socket of server.clients) socket.terminate(); await new Promise((resolve) => server.close(resolve)); }
