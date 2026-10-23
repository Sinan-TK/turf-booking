import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { loadEnv } from '@venue/config';

/** What Google vouches for. `email` is lower-cased; `name` and `picture` may be absent. */
export interface GoogleIdentity {
  /** Google's stable account id (the "sub" claim). */
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/** Turns the ID token the browser got from Google into a verified identity, or throws 401. */
export interface GoogleTokenVerifier {
  verify(credential: string): Promise<GoogleIdentity>;
}

export const GOOGLE_TOKEN_VERIFIER = Symbol('GOOGLE_TOKEN_VERIFIER');

/** Just the part of google-auth-library that is used, so tests can stub it. */
export interface GoogleLoginTicketClient {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{
    getPayload(): { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string } | undefined;
  }>;
}

const REFUSED = 'Google sign-in failed. Please try again.';

/**
 * Verifies Google's signed ID token: signature (against Google's published keys), issuer, expiry and that it was
 * issued to OUR client id (`audience`), then insists on a verified email. Every failure is the same 401, so
 * nothing about why is revealed.
 */
@Injectable()
export class RealGoogleTokenVerifier implements GoogleTokenVerifier {
  private client: GoogleLoginTicketClient | undefined;

  constructor(client?: GoogleLoginTicketClient) {
    this.client = client;
  }

  async verify(credential: string): Promise<GoogleIdentity> {
    const clientId = loadEnv().GOOGLE_CLIENT_ID;
    if (!clientId) throw new ServiceUnavailableException("Google sign-in isn't set up yet.");
    this.client ??= new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException(REFUSED);
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) throw new UnauthorizedException(REFUSED);
    return {
      sub: payload.sub,
      email: payload.email.trim().toLowerCase(),
      name: payload.name?.trim() || null,
      picture: payload.picture ?? null,
    };
  }
}

/**
 * Development and test only (the production env check refuses GOOGLE_AUTH_MODE=fake): accepts
 * `test:<email>|<name>|<sub>` instead of a real Google token. `name` and `sub` are optional.
 */
@Injectable()
export class FakeGoogleTokenVerifier implements GoogleTokenVerifier {
  async verify(credential: string): Promise<GoogleIdentity> {
    const match = /^test:([^|\s]+@[^|\s]+)(?:\|([^|]*))?(?:\|([^|]+))?$/.exec(credential);
    if (!match) throw new UnauthorizedException(REFUSED);
    const email = match[1]!.toLowerCase();
    return { sub: match[3] ?? `fake-${email}`, email, name: match[2]?.trim() || null, picture: null };
  }
}

/** Chooses the verifier by GOOGLE_AUTH_MODE, once per request (the env is read lazily on purpose). */
@Injectable()
export class ConfiguredGoogleTokenVerifier implements GoogleTokenVerifier {
  private readonly real = new RealGoogleTokenVerifier();
  private readonly fake = new FakeGoogleTokenVerifier();

  verify(credential: string): Promise<GoogleIdentity> {
    return (loadEnv().GOOGLE_AUTH_MODE === 'fake' ? this.fake : this.real).verify(credential);
  }
}
