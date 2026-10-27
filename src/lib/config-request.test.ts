import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestConfig } from './config-request';

test('compartilha leitura concorrente, volta ao servidor depois e permite repetir apos falha', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release!: (response: Response) => void;
  globalThis.fetch = async () => {
    calls++;
    return new Promise<Response>((resolve) => { release = resolve; });
  };
  try {
    const first = requestConfig();
    const second = requestConfig();
    assert.equal(calls, 1);
    release(Response.json({ config: { id: 1 } }));
    assert.deepEqual(await first, await second);
    const failed = requestConfig();
    assert.equal(calls, 2);
    release(new Response(null, { status: 503 }));
    await assert.rejects(failed, /503/);
    const retry = requestConfig();
    assert.equal(calls, 3);
    release(Response.json({ config: { id: 2 } }));
    assert.equal((await retry).config?.id, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
