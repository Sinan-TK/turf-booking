describe('login code delivery config', () => {
  const productionEnv = (overrides: Record<string, string>): NodeJS.ProcessEnv => ({
    ...process.env,
    NODE_ENV: 'production',
    WEB_APP_URL: 'https://app.example.com',
    ADMIN_APP_URL: 'https://admin.example.com',
    OWNER_APP_URL: 'https://owner.example.com',
    CUSTOMER_SESSION_SECRET: 'x'.repeat(40),
    AUTH_JWT_SECRET: 'y'.repeat(40),
    // The test environment runs Google sign-in in fake mode; production must not.
    GOOGLE_AUTH_MODE: 'google',
    ...overrides,
  });

  // loadEnv caches its first result, so each case loads a fresh copy.
  const load = (env: NodeJS.ProcessEnv) => {
    let result: unknown;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { loadEnv } = require('@venue/config');
      result = loadEnv(env);
    });
    return result as { AUTH_OTP_DELIVERY: string; GOOGLE_AUTH_MODE: string };
  };

  it('refuses AUTH_OTP_DELIVERY=log in production', () => {
    expect(() => load(productionEnv({ AUTH_OTP_DELIVERY: 'log' }))).toThrow(/AUTH_OTP_DELIVERY/);
  });

  it('accepts AUTH_OTP_DELIVERY=whatsapp in production', () => {
    expect(load(productionEnv({ AUTH_OTP_DELIVERY: 'whatsapp' })).AUTH_OTP_DELIVERY).toBe('whatsapp');
  });

  it('refuses the fake Google verifier in production, which would accept unsigned test tokens', () => {
    expect(() => load(productionEnv({ GOOGLE_AUTH_MODE: 'fake' }))).toThrow(/GOOGLE_AUTH_MODE/);
    expect(load(productionEnv({ GOOGLE_AUTH_MODE: 'google', AUTH_OTP_DELIVERY: 'whatsapp' })).GOOGLE_AUTH_MODE).toBe('google');
  });

  it('allows the fake Google verifier outside production', () => {
    expect(load({ ...process.env, NODE_ENV: 'test', GOOGLE_AUTH_MODE: 'fake' }).GOOGLE_AUTH_MODE).toBe('fake');
  });

  it('allows log outside production', () => {
    expect(load({ ...process.env, NODE_ENV: 'test', AUTH_OTP_DELIVERY: 'log' }).AUTH_OTP_DELIVERY).toBe('log');
  });
});
