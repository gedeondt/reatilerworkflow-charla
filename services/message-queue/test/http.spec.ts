import { afterEach, beforeAll, expect, it } from 'vitest';
import http from 'http';

const BASE = 'http://127.0.0.1:3005';
function post(path: string, body?: unknown): Promise<{statusCode:number, text:string}> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, text: chunks }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  // Asumimos que el server ya corre en dev; estos tests son smoke externos.
});
afterEach(() => { /* nada */ });

it('health responde', async () => {
  // GET con http simple
  await new Promise<void>((resolve, reject) => {
    http.get(BASE + '/health', (res) => {
      expect(res.statusCode).toBe(200);
      resolve();
    }).on('error', reject);
  });
});

it('push y pop funcionan', async () => {
  const ev = { eventName:'Ping', version:1, eventId:'e1', traceId:'t1', correlationId:'c1', occurredAt:new Date().toISOString(), data:{} };
  const r1 = await post('/queues/test/messages', ev);
  expect(r1.statusCode).toBe(200);
  const r2 = await post('/queues/test:pop');
  expect(r2.statusCode).toBe(200);
  expect(r2.text).toContain('"eventName":"Ping"');
});
