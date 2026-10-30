#!/usr/bin/env node
/**
 * Dependency vulnerability gate (run by .github/workflows/dependency-audit.yml, and by hand: `pnpm audit:check`).
 *
 * It runs `pnpm audit` on the production dependencies and fails when there is a HIGH or CRITICAL advisory that is not in
 * .github/audit-baseline.json. The baseline is the list of advisories that were looked at and accepted for now (each with a reason
 * and a "reviewBy" date): a new advisory fails the check straight away, and an accepted one fails again once its review date has
 * passed, so nothing is ignored forever. Moderate and low advisories are listed but never fail the check.
 *
 *   node scripts/audit-check.mjs            production dependencies (the gate)
 *   node scripts/audit-check.mjs --all      also report the development dependencies (informational, never fails)
 *   node scripts/audit-check.mjs --update   print baseline entries for the advisories that are not in the baseline yet
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(root, '.github/audit-baseline.json');
const args = new Set(process.argv.slice(2));
const GATED = new Set(['high', 'critical']);

function audit(production) {
  const result = spawnSync('pnpm', ['audit', ...(production ? ['--prod'] : []), '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = result.stdout?.trim();
  if (!text) {
    console.error(`pnpm audit produced no output (exit ${result.status}).\n${result.stderr ?? ''}`);
    process.exit(2); // the registry could not be reached: say so, rather than pass silently
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('pnpm audit did not return JSON:\n' + text.slice(0, 500));
    process.exit(2);
  }
  if (json.error) {
    console.error('pnpm audit failed: ' + (json.error.message ?? JSON.stringify(json.error)));
    process.exit(2);
  }
  return Object.values(json.advisories ?? {}).map((a) => ({
    id: a.github_advisory_id,
    package: a.module_name,
    severity: a.severity,
    title: a.title,
    fixedIn: a.patched_versions,
    url: a.url,
  }));
}

const advisories = audit(true);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const accepted = new Map(baseline.accepted.map((e) => [e.id, e]));
const today = new Date().toISOString().slice(0, 10);

const gated = advisories.filter((a) => GATED.has(a.severity));
const fresh = gated.filter((a) => !accepted.has(a.id));
const expired = gated.filter((a) => accepted.has(a.id) && accepted.get(a.id).reviewBy < today);
const stale = [...accepted.values()].filter((e) => !advisories.some((a) => a.id === e.id));

const counts = (list) => ['critical', 'high', 'moderate', 'low'].map((s) => `${list.filter((a) => a.severity === s).length} ${s}`).join(', ');
console.log(`Production dependencies: ${advisories.length} advisories (${counts(advisories)}).`);
console.log(`High or critical: ${gated.length}; accepted in the baseline: ${gated.length - fresh.length}.`);

const show = (title, list) => {
  if (list.length === 0) return;
  console.log(`\n${title}`);
  for (const a of list) console.log(`  [${a.severity}] ${a.package}  ${a.id}  ${a.title}\n      fixed in ${a.fixedIn}  ${a.url}`);
};
show('NEW high or critical advisories (not in the baseline):', fresh);
show('Accepted advisories whose review date has passed:', expired);
if (stale.length > 0) {
  console.log('\nBaseline entries that no longer apply (fixed or gone). Remove them from .github/audit-baseline.json:');
  for (const e of stale) console.log(`  ${e.id}  ${e.package}`);
}

if (args.has('--update')) {
  console.log('\nBaseline entries for the new advisories (fill in the reason, then review the date):');
  console.log(
    JSON.stringify(
      fresh.map((a) => ({ id: a.id, package: a.package, severity: a.severity, reason: 'FILL IN: why this is acceptable for now, and what removes it', reviewBy: '' })),
      null,
      2,
    ),
  );
}

if (args.has('--all')) {
  const everything = audit(false);
  console.log(`\nAll dependencies including development tools: ${everything.length} advisories (${counts(everything)}). Informational only.`);
}

if (fresh.length > 0 || expired.length > 0) {
  console.error(`\nFAILED: ${fresh.length} new and ${expired.length} expired high or critical advisories.`);
  console.error('Update the dependency (pnpm update / an override), or, if it has to be accepted for now, record it in .github/audit-baseline.json with a reason and a review date.');
  process.exit(1);
}
console.log('\nOK: no new high or critical advisories.');
