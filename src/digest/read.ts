import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RUN_STATUSES,
  type DigestRow,
  type Night,
  type NightResult,
  type ReadNight,
  type RunLine,
  type RunStatus,
  type StatusCounts,
} from './types.js';

// Night names are what `nightsOnDisk` lists; anything else (e.g. "../x") can't be a night.
const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStatus(v: unknown): v is RunStatus {
  return typeof v === 'string' && (RUN_STATUSES as readonly string[]).includes(v);
}

/**
 * One log line → `RunLine`, or `null` if it isn't one. Required: `at` and `job` (non-empty
 * strings), `status` (ok | retry | fail). `owner` is a string or `null` (absent counts as `null`).
 * `error`, if present, must be a string.
 */
export function parseLine(line: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  const { at, job, status, owner, error } = v;
  if (typeof at !== 'string' || at === '') return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (owner !== undefined && owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  const parsed: RunLine = { at, job, status, owner: owner ?? null };
  if (error !== undefined) parsed.error = error;
  return parsed;
}

/**
 * Pure: the text of one night's log → the night. Blank lines are skipped (not bad); every other
 * line that fails `parseLine` adds to `badLines`. Rows are in file order per job: the log is
 * appended as jobs run, so the latest line in the file is the job's last run.
 */
export function digestNight(night: string, text: string): Night {
  const byJob = new Map<string, DigestRow>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const retry = line.status === 'retry' ? 1 : 0;
    const row = byJob.get(line.job);
    if (row === undefined) {
      byJob.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: retry,
        lastStatus: line.status,
        lastError: line.error ?? null,
        firstAt: line.at,
        lastAt: line.at,
      });
    } else {
      row.owner = line.owner;
      row.runs++;
      row.retries += retry;
      row.lastStatus = line.status;
      row.lastError = line.error ?? null;
      row.lastAt = line.at;
    }
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { found: true, night, rows, badLines, counts };
}

function isMissing(e: unknown): boolean {
  return isRecord(e) && e.code === 'ENOENT';
}

/** `<runsDir>/<night>.jsonl` → the night, or `found: false` if there is no such file. */
export const readNight: ReadNight = (runsDir, night): NightResult => {
  if (!NIGHT.test(night)) return { found: false, night };
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (e) {
    if (isMissing(e)) return { found: false, night };
    throw e;
  }
  return digestNight(night, text);
};
