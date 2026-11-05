/**
 * The rules every NEW password must pass (sign-up, reset, change, invite). Signing in never checks them, so older passwords still work.
 * The three web apps repeat these checks in their own validation files, to explain the rule under the field before anything is sent.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const PASSWORD_RULES: ReadonlyArray<{ id: string; label: string; test: (v: string) => boolean }> = [
  { id: 'length', label: `At least ${PASSWORD_MIN} characters`, test: (v) => v.length >= PASSWORD_MIN },
  { id: 'upper', label: 'One capital letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'One small letter', test: (v) => /[a-z]/.test(v) },
  { id: 'digit', label: 'One number', test: (v) => /\d/.test(v) },
  { id: 'special', label: 'One special character, like ! or @', test: (v) => /[^A-Za-z0-9\s]/.test(v) },
];

/** What is wrong with a new password, in one sentence, or undefined when it passes every rule. */
export function passwordPolicyProblem(value: string): string | undefined {
  if (value.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const failed = PASSWORD_RULES.filter((r) => !r.test(value));
  if (failed.length === 0) return undefined;
  if (failed.length === 1 && failed[0]?.id === 'length') return `Use at least ${PASSWORD_MIN} characters.`;
  return `Use at least ${PASSWORD_MIN} characters, with a capital letter, a small letter, a number and a special character.`;
}
