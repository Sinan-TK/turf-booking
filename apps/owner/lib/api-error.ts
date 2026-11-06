/**
 * Turns an API error body into a sentence that says what is wrong. The API's validation failures arrive as
 * `{ message: 'Validation failed', errors: [{ path: ['accountNumber'], code, message, ... }] }`; showing only the message told people nothing,
 * so each problem is written out against its field: "Account number is required." or "Account number: The account number is 9 to 18 digits".
 * (The same file is in the owner, admin and customer apps.)
 */
interface FieldIssue {
  path?: Array<string | number>;
  code?: string;
  message?: string;
  received?: string;
  minimum?: number;
  maximum?: number;
  type?: string;
  validation?: string;
}

const humanize = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'This field';
};

/** Zod's own default wording is not for people; anything the API wrote itself (a full sentence) is kept as it is. */
const ZOD_DEFAULT = /^(Required|Invalid|Expected |String must|Number must|Array must|Too (small|big)|Unrecognized key)/;

function describe(issue: FieldIssue): string {
  const last = [...(issue.path ?? [])].reverse().find((p) => typeof p === 'string') as string | undefined;
  const field = last ? humanize(last) : 'This field';
  const said = issue.message ?? '';
  if (said && !ZOD_DEFAULT.test(said)) return /[.!?]$/.test(said) ? said : `${said}.`;
  if (issue.code === 'invalid_type' && issue.received === 'undefined') return `${field} is required.`;
  if (issue.code === 'too_small' && issue.type === 'string') {
    return (issue.minimum ?? 1) <= 1 ? `${field} is required.` : `${field} needs at least ${issue.minimum} characters.`;
  }
  if (issue.code === 'too_small' && issue.type === 'array') return `Choose at least ${issue.minimum ?? 1} for ${field.toLowerCase()}.`;
  if (issue.code === 'too_small') return `${field} must be at least ${issue.minimum}.`;
  if (issue.code === 'too_big' && issue.type === 'string') return `${field} can be at most ${issue.maximum} characters.`;
  if (issue.code === 'too_big') return `${field} must be at most ${issue.maximum}.`;
  if (issue.code === 'invalid_string' && issue.validation === 'email') return `${field} must be a valid email address.`;
  if (issue.code === 'invalid_string' && issue.validation === 'uuid') return `${field} is not a valid choice.`;
  if (issue.code === 'invalid_enum_value') return `${field} is not one of the allowed choices.`;
  if (issue.code === 'invalid_type') return `${field} is not the right kind of value.`;
  return `${field} is not valid.`;
}

export function describeApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const { message, errors } = body as { message?: unknown; errors?: unknown };
  if (Array.isArray(errors) && errors.length > 0) {
    const lines = [...new Set((errors as FieldIssue[]).map(describe))];
    return lines.join(' ');
  }
  if (Array.isArray(message)) return message.map(String).join(' ');
  return typeof message === 'string' && message ? message : fallback;
}
