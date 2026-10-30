// Plan morning-digest § 1. The contract every part of § 2 (page, JSON, board link, route tests)
// builds against. The implementation is `readNight` in `src/digest/read.ts`; it has the type
// `ReadNight` below.

/** One line of `runs/<night>.jsonl` is one of these. */
export type RunStatus = 'ok' | 'retry' | 'fail';

export const RUN_STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

/** A line of the run log after parsing. `at` is kept exactly as written, offset included. */
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

/**
 * One row per job in the night.
 *
 * - `runs`: lines for this job (every status, retries included).
 * - `retries`: lines for this job with status `retry`.
 * - `lastStatus`, `lastError`, `owner`: from the job's latest line by file order. `lastError` is
 *   that line's `error`, or `null` when it has none. `owner` is `null` when the log says so; views
 *   show it as `—`.
 * - `firstAt`, `lastAt`: `at` of the job's first and latest line by file order, as written (never
 *   converted to UTC).
 */
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

/** Valid lines in the night per status (the board's ok / retry / fail counts). */
export type StatusCounts = Record<RunStatus, number>;

/** A night whose file exists. An empty file is a night with no rows ("nothing ran"). */
export type Night = {
  found: true;
  night: string;
  /** Sorted by job (plain string order), so the page and the JSON list jobs the same way. */
  rows: DigestRow[];
  /** Non-blank lines that did not parse into a `RunLine`. Counted, never thrown. */
  badLines: number;
  counts: StatusCounts;
};

/** No `runs/<night>.jsonl`, or `night` is not a `YYYY-MM-DD` name (the page answers 404). */
export type MissingNight = {
  found: false;
  night: string;
};

export type NightResult = Night | MissingNight;

/** Reads `<runsDir>/<night>.jsonl`. Synchronous, like `nightsOnDisk`. Never writes. */
export type ReadNight = (runsDir: string, night: string) => NightResult;
