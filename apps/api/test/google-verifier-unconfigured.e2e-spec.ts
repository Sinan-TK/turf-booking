import { ServiceUnavailableException } from '@nestjs/common';
import { RealGoogleTokenVerifier } from '../src/auth/google-token-verifier';

/** Without GOOGLE_CLIENT_ID, Google sign-in says so (503) instead of failing in some confusing way. */
describe('Google sign-in without a client id', () => {
  test('answers 503 that it is not set up yet', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const err = await new RealGoogleTokenVerifier().verify('any-token').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(String(err.message)).toMatch(/isn't set up yet/);
  });
});
