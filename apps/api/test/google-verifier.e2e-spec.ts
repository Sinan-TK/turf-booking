import { UnauthorizedException } from '@nestjs/common';
import { loadEnv } from '@venue/config';
import {
  FakeGoogleTokenVerifier,
  RealGoogleTokenVerifier,
  type GoogleLoginTicketClient,
} from '../src/auth/google-token-verifier';

/**
 * The Google ID-token verifier, with the Google library stubbed: what we require of the claims, and that every
 * failure looks the same. (Signature checking itself belongs to google-auth-library.)
 */
function clientReturning(payload: Record<string, unknown> | undefined, seen?: { audience?: string }): GoogleLoginTicketClient {
  return {
    async verifyIdToken(options) {
      if (seen) seen.audience = options.audience;
      return { getPayload: () => payload };
    },
  };
}

const goodPayload = { sub: '1234567890', email: 'Ria.Menon@Gmail.com', email_verified: true, name: ' Ria Menon ', picture: 'https://x/p.png' };

describe('RealGoogleTokenVerifier', () => {
  // loadEnv caches per test file, and nothing here reads it before the first verify() call.
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id-123.apps.googleusercontent.com';
  });

  test('accepts a verified token: email lower-cased, name trimmed, audience is our client id', async () => {
    const seen: { audience?: string } = {};
    const identity = await new RealGoogleTokenVerifier(clientReturning(goodPayload, seen)).verify('token');
    expect(identity).toEqual({ sub: '1234567890', email: 'ria.menon@gmail.com', name: 'Ria Menon', picture: 'https://x/p.png' });
    expect(seen.audience).toBe(loadEnv().GOOGLE_CLIENT_ID);
  });

  test.each([
    ['an unverified email', { ...goodPayload, email_verified: false }],
    ['a missing email_verified', { ...goodPayload, email_verified: undefined }],
    ['no email', { ...goodPayload, email: undefined }],
    ['no subject', { ...goodPayload, sub: undefined }],
    ['no payload', undefined],
  ])('refuses %s', async (_label, payload) => {
    await expect(new RealGoogleTokenVerifier(clientReturning(payload)).verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  test("refuses when Google's library rejects the token (bad signature, expired, wrong audience), with the same message", async () => {
    const throwing: GoogleLoginTicketClient = {
      async verifyIdToken() {
        throw new Error('Wrong recipient, payload audience != requiredAudience');
      },
    };
    const err = await new RealGoogleTokenVerifier(throwing).verify('token').catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(String(err.message)).not.toMatch(/audience|recipient/i);
  });
});

describe('FakeGoogleTokenVerifier', () => {
  const fake = new FakeGoogleTokenVerifier();

  test('reads email, name and sub from a test token', async () => {
    expect(await fake.verify('test:Ria@Example.com|Ria Menon|sub-1')).toEqual({ sub: 'sub-1', email: 'ria@example.com', name: 'Ria Menon', picture: null });
    expect(await fake.verify('test:ria@example.com')).toMatchObject({ email: 'ria@example.com', name: null, sub: 'fake-ria@example.com' });
  });

  test('refuses anything that is not a test token', async () => {
    for (const t of ['', 'eyJhbGciOi.real.token', 'test:', 'test:not-an-email', 'TEST:a@b.c']) {
      await expect(fake.verify(t)).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });
});
