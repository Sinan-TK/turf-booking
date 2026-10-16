import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';

/** Total number of rows matching the filter, sent beside a page of results. */
export const TOTAL_COUNT_HEADER = 'X-Total-Count';

export interface PageQuery {
  limit: number;
  offset: number;
}

/**
 * Parses ?limit=&offset= for list endpoints. Bodies stay plain arrays (so
 * existing clients keep working); the total travels in X-Total-Count.
 * Malformed values are a 400, never silently replaced.
 */
export function parsePage(
  limit?: string,
  offset?: string,
  defaults: { limit: number; max: number } = { limit: 50, max: 200 },
): PageQuery {
  const int = (raw: string | undefined, name: string, fallback: number) => {
    if (raw === undefined || raw === '') return fallback;
    if (!/^\d+$/.test(raw)) throw new BadRequestException(`${name} must be a non-negative integer`);
    return Number(raw);
  };
  return {
    limit: Math.min(Math.max(int(limit, 'limit', defaults.limit), 1), defaults.max),
    offset: int(offset, 'offset', 0),
  };
}

export function setTotalCount(res: Response, total: number): void {
  res.setHeader(TOTAL_COUNT_HEADER, String(total));
}
