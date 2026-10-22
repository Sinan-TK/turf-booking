import { BadRequestException } from '@nestjs/common';

/** A half-open [gte, lt) window on a timestamp column. */
export interface DateRange {
  from?: Date;
  to?: Date;
}

/** Blank/missing means "no filter"; anything else must be one of `allowed`. */
export function parseEnumFilter<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new BadRequestException(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return raw as T;
}

/** ?from=&to= as ISO timestamps; `to` is exclusive so callers pass "start of the next day". */
export function parseDateRange(from?: string, to?: string): DateRange {
  const date = (raw: string | undefined, name: string) => {
    if (raw === undefined || raw === '') return undefined;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be a valid date`);
    return d;
  };
  const range = { from: date(from, 'from'), to: date(to, 'to') };
  if (range.from && range.to && range.from >= range.to) {
    throw new BadRequestException('from must be before to');
  }
  return range;
}

/** Trimmed, length-capped free-text term; blank means "no search". */
export function parseSearch(raw: string | undefined): string | undefined {
  const term = raw?.trim().slice(0, 100);
  return term ? term : undefined;
}

export function dateWhere(range: DateRange | undefined) {
  if (!range || (!range.from && !range.to)) return undefined;
  return { gte: range.from, lt: range.to };
}

export function contains(term: string) {
  return { contains: term, mode: 'insensitive' as const };
}
