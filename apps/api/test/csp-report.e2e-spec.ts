import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';

/** Browsers report Content-Security-Policy violations here: accepted quietly, logged cleaned up, never stored. */
describe('CSP report endpoint', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test('accepts a report under the browser content type and logs only cleaned fields', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const res = await request(app.getHttpServer())
        .post('/csp-report?app=web')
        .set('Content-Type', 'application/csp-report')
        .send(JSON.stringify({ 'csp-report': { 'document-uri': 'https://x.test/a?token=SECRET#frag', 'effective-directive': 'img-src', 'blocked-uri': 'https://evil.test/i.png?k=SECRET', disposition: 'report', cookie: 'sid=SECRET' } }));
      expect(res.status).toBe(204);
      const line = warn.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[csp]')) ?? '';
      expect(line).toContain('img-src');
      expect(line).toContain('https://evil.test/i.png');
      expect(line).not.toContain('SECRET');
    } finally {
      warn.mockRestore();
    }
  });

  test('garbage and oversized bodies never break it', async () => {
    const quiet = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect((await request(app.getHttpServer()).post('/csp-report').set('Content-Type', 'application/json').send('{"a":1}')).status).toBe(204);
      const big = await request(app.getHttpServer()).post('/csp-report').set('Content-Type', 'application/json').send(JSON.stringify({ x: 'y'.repeat(300_000) }));
      expect(big.status).toBe(413);
    } finally {
      quiet.mockRestore();
    }
  });
});
