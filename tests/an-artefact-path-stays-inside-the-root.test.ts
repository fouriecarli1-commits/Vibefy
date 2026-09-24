/**
 * An artefact path stays inside the root, on the way in as well as out.
 *
 * `LocalReportStorage` already had the guard. It called it from `get`, with the
 * comment "a traversal here would read anything on the disk", and from `remove`,
 * with "and a traversal here would delete anything on the disk, which is worse".
 * It did not call it from `put` — the one method that creates directories
 * (`mkdir(dirname(full), { recursive: true })`) and then writes bytes.
 *
 * Nothing escapes today. Every path handed to `put` is built from UUIDs:
 * `reports/${assessmentId}/${tier}.html` in `report.ts` and
 * `assessments/${assessmentId}/evidence/${randomUUID()}` in the engine's
 * evidence recorder. So this is a latent hole rather than an open one, and it is
 * the shape worth closing on that basis alone: the class's own stated defence
 * applied to two of its three methods, and the one it was missing from was the
 * one where a mistake writes rather than reads.
 *
 * The guard was also entirely untested. These are the first tests of it, which
 * is how the gap in `put` was found — not by reading the class, but by asking
 * what covered the line that refuses.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalReportStorage } from '../apps/worker/src/report.ts';

let sandbox: string;
let root: string;
let storage: LocalReportStorage;

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'vibefycode-artefact-'));
  root = join(sandbox, 'artefacts');
  await mkdir(root, { recursive: true });
  storage = new LocalReportStorage(root);
});

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('a path that climbs out of the root', () => {
  it('is refused on the way in', async () => {
    await expect(
      storage.put('reports/../../escaped.html', Buffer.from('out'), 'text/html'),
    ).rejects.toThrow(/\.\./);

    // Said twice on purpose. A guard that throws after the bytes have landed is
    // not a guard, and `put` creates the directory before it writes.
    expect(existsSync(join(sandbox, 'escaped.html'))).toBe(false);
  });

  it('is refused on the way out', async () => {
    const secret = join(sandbox, 'not-ours.txt');
    await writeFile(secret, 'somebody else’s bytes');

    await expect(storage.get('../not-ours.txt')).rejects.toThrow(/\.\./);
    // And the file is still there and still readable by anything entitled to it,
    // so the refusal is the guard rather than an accident of a missing file.
    expect(await readFile(secret, 'utf8')).toContain('bytes');
  });

  it('is refused on the way to deletion', async () => {
    const secret = join(sandbox, 'do-not-delete.txt');
    await writeFile(secret, 'still here');

    await expect(storage.remove('../do-not-delete.txt')).rejects.toThrow(/\.\./);
    expect(existsSync(secret)).toBe(true);
  });
});

describe('a path that stays inside it', () => {
  it('round-trips, so the guard has not simply refused everything', async () => {
    // The direction a guard fails in silence: refusing the legitimate paths too
    // and being noticed only when a reviewer cannot open an artefact.
    const stored = await storage.put(
      'assessments/1b2c/evidence/8f0e',
      Buffer.from('evidence bytes'),
      'text/plain',
    );
    expect(stored.storagePath).toBe('assessments/1b2c/evidence/8f0e');
    expect(stored.byteSize).toBe(14);

    expect((await storage.get('assessments/1b2c/evidence/8f0e'))?.toString()).toBe(
      'evidence bytes',
    );

    await storage.remove('assessments/1b2c/evidence/8f0e');
    expect(await storage.get('assessments/1b2c/evidence/8f0e')).toBeNull();
  });
});
