import type { NextFunction, Request, Response } from 'express';

/**
 * Browsers send Content-Security-Policy violation reports as application/csp-report or application/reports+json, which the default
 * JSON parser skips. They are JSON, so on the report path they are read as such. Mounted at '/csp-report' (main.ts and the test app).
 */
export function cspReportContentType(req: Request, _res: Response, next: NextFunction) {
  const type = String(req.headers['content-type'] ?? '');
  if (type.startsWith('application/csp-report') || type.startsWith('application/reports+json')) req.headers['content-type'] = 'application/json';
  next();
}
