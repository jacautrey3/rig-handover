import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Nights are written to a temp dir; runs/ is read-only.
const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
const app = createApp(config);

const NORMAL = '2026-05-01';
const EMPTY = '2026-05-02';
const BAD = '2026-05-03';
const MISSING = '2026-05-09';

// File order is not job order: the page and the JSON must both sort by job.
writeFileSync(
  join(runsDir, `${NORMAL}.jsonl`),
  [
    '{"at":"2026-05-01T23:00:00+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
    '{"at":"2026-05-01T23:05:00+01:00","job":"lane/sync","status":"retry","owner":"rook"}',
    '{"at":"2026-05-01T23:10:00+01:00","job":"digest/render","status":"ok","owner":null}',
    '{"at":"2026-05-01T23:15:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
    '',
  ].join('\n'),
);
writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
writeFileSync(
  join(runsDir, `${BAD}.jsonl`),
  [
    '{"at":"2026-05-03T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
    '{"at":"2026-05-03T01:05:00+01:00","job":"digest/render","status":"ok","owner":null}',
    '{"at":"2026-05-03T01:10:00+01:00","job":"lane/sync","status":"ret',
    '',
  ].join('\n'),
);

const NORMAL_JOBS = ['digest/render', 'lane/sync', 'notes/backup'];

/** The job names in the page's table, in the order the page lists them. */
function pageJobs(html: string): string[] {
  return [...html.matchAll(/<tr[^>]*>\s*<td>([^<]*)<\/td>/g)].map((m) => m[1]);
}

describe('GET /digest/:night (page)', () => {
  it('200 for a normal night, listing its jobs', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`digest · ${NORMAL}`);
    expect(pageJobs(html)).toEqual(NORMAL_JOBS);
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).toContain('no digest for this night');
  });

  it('the empty night says "nothing ran"', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(pageJobs(html)).toEqual([]);
  });

  it('a night with a bad line still renders and says so', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line did not parse');
    expect(pageJobs(html)).toEqual(['digest/render', 'lane/sync']);
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('200 for a normal night, with rows for its jobs', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.night).toBe(NORMAL);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(NORMAL_JOBS);
    expect(body.badLines).toBe(0);
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ night: MISSING, found: false });
  });

  it('the empty night is 200 with no rows', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('a night with a bad line counts it', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['digest/render', 'lane/sync']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order for the same night', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const json = await (await app.request(`/api/digest/${NORMAL}`)).json();
    expect(pageJobs(html)).toEqual(json.rows.map((r: { job: string }) => r.job));
  });
});
