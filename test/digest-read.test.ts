import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { digestNight, parseLine, readNight } from '../src/digest/read.js';
import type { Night, NightResult } from '../src/digest/types.js';

// Edge cases live in a temp dir; runs/ is read-only.
const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function found(r: NightResult): Night {
  if (!r.found) throw new Error(`night ${r.night} not found`);
  return r;
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = found(readNight('runs', '2026-10-28'));

  it('has 5 jobs, sorted by job, and 1 bad line', () => {
    expect(night.night).toBe('2026-10-28');
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.badLines).toBe(1);
  });

  it('counts valid lines per status', () => {
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('builds each row from the job lines, times as written', () => {
    const byJob = Object.fromEntries(night.rows.map((r) => [r.job, r]));
    expect(byJob['fixtures/refresh']).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(byJob['lane/sync']).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(byJob['notes/backup']).toMatchObject({
      owner: 'lane-07',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });

  it('keeps a row whose owner is null', () => {
    expect(night.rows.find((r) => r.job === 'digest/render')).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok' });
  });
});

describe('readNight edge cases', () => {
  it('a night with no file is not found', () => {
    expect(readNight(tmp, '2026-01-01')).toEqual({ found: false, night: '2026-01-01' });
  });

  it('a missing runs dir is not found', () => {
    expect(readNight(join(tmp, 'nope'), '2026-01-01').found).toBe(false);
  });

  it('a name that is not a night is not found and is never read', () => {
    writeFileSync(join(tmp, 'secret.jsonl'), '{"at":"x","job":"j","status":"ok","owner":null}\n');
    expect(readNight(tmp, 'secret').found).toBe(false);
    expect(readNight(join(tmp, 'sub'), '../secret').found).toBe(false);
  });

  it('an empty file is found, with no rows', () => {
    writeFileSync(join(tmp, '2026-01-02.jsonl'), '');
    expect(readNight(tmp, '2026-01-02')).toEqual({
      found: true,
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('blank lines are skipped, not counted as bad', () => {
    writeFileSync(join(tmp, '2026-01-03.jsonl'), '\n  \r\n{"at":"2026-01-03T01:00:00-05:00","job":"a","status":"ok","owner":null}\r\n\n');
    const night = found(readNight(tmp, '2026-01-03'));
    expect(night.badLines).toBe(0);
    expect(night.rows).toEqual([
      { job: 'a', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-01-03T01:00:00-05:00', lastAt: '2026-01-03T01:00:00-05:00' },
    ]);
  });

  it('a file of only bad lines is found, with no rows and every line counted', () => {
    writeFileSync(join(tmp, '2026-01-04.jsonl'), 'not json\n{"job":"a"}\n[1]\n');
    const night = found(readNight(tmp, '2026-01-04'));
    expect(night.rows).toEqual([]);
    expect(night.badLines).toBe(3);
  });
});

describe('digestNight', () => {
  it('takes owner, status and error from the latest line by file order', () => {
    const text = [
      '{"at":"2026-01-05T01:00:00+01:00","job":"j","status":"retry","owner":"rook","error":"503"}',
      '{"at":"2026-01-05T00:30:00+01:00","job":"j","status":"fail","owner":null,"error":"quota"}',
    ].join('\n');
    expect(digestNight('2026-01-05', text).rows[0]).toEqual({
      job: 'j',
      owner: null,
      runs: 2,
      retries: 1,
      lastStatus: 'fail',
      lastError: 'quota',
      firstAt: '2026-01-05T01:00:00+01:00',
      lastAt: '2026-01-05T00:30:00+01:00',
    });
  });
});

describe('parseLine', () => {
  it('accepts a full line and a line without owner or error', () => {
    expect(parseLine('{"at":"t","job":"j","status":"fail","owner":"o","error":"e"}')).toEqual({ at: 't', job: 'j', status: 'fail', owner: 'o', error: 'e' });
    expect(parseLine('{"at":"t","job":"j","status":"ok"}')).toEqual({ at: 't', job: 'j', status: 'ok', owner: null });
  });

  it.each([
    ['truncated', '{"at":"t","job":"lane/sy'],
    ['not an object', '"ok"'],
    ['null', 'null'],
    ['unknown status', '{"at":"t","job":"j","status":"skipped","owner":null}'],
    ['no job', '{"at":"t","status":"ok","owner":null}'],
    ['empty job', '{"at":"t","job":"","status":"ok","owner":null}'],
    ['no at', '{"job":"j","status":"ok","owner":null}'],
    ['owner not a string', '{"at":"t","job":"j","status":"ok","owner":7}'],
    ['error not a string', '{"at":"t","job":"j","status":"retry","owner":null,"error":{"code":503}}'],
  ])('rejects a line that is %s', (_why, line) => {
    expect(parseLine(line)).toBeNull();
  });
});
