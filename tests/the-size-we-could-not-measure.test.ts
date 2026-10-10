/**
 * The cap that stops a clone filling the disk, and the direction it failed in.
 *
 * `fetchRepository` polls the clone directory while git writes to it and
 * refuses the repository once it passes the ceiling. The measurement swallowed
 * every failure and returned the bytes it had managed to add up — so a tree it
 * could not read measured zero, and zero is under every ceiling. A cap whose
 * failure mode is "allow" is not a cap.
 *
 * `ENOENT` is the exception, and it is the common case twice over: at the root
 * because the first poll can fire before git has created the directory, and
 * below it because a clone in progress creates and removes files constantly.
 * That is why the catch was there. Anything else is a measurement that did not
 * happen, and it is now raised rather than reported as a small number.
 *
 * Which also fixed a second thing. The poll was `void directorySize(path)
 * .then(...)` with no catch, so a raised failure would have been an unhandled
 * rejection — and Node ends the process over one of those. In the worker that
 * means the request is reclaimed ninety minutes later and the assessment runs
 * a second time, which is the hazard `withRunTimeout` exists to prevent,
 * arriving through a different door.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { directorySize } from '../packages/engine/src/runtime/repository.ts';

describe('measuring a directory', () => {
  it('adds up what is there', async () => {
    // The positive control: an absence of failures means nothing unless the
    // measurement works at all.
    const dir = await mkdtemp(join(tmpdir(), 'size-'));
    await writeFile(join(dir, 'a'), 'x'.repeat(1000));
    await mkdir(join(dir, 'nested'));
    await writeFile(join(dir, 'nested', 'b'), 'y'.repeat(500));
    expect(await directorySize(dir)).toBe(1500);
  });

  it('reads a directory that is not there yet as nothing, because the first poll beats git', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'size-'));
    expect(await directorySize(join(dir, 'not-created-yet'))).toBe(0);
  });

  it('refuses to call a path it cannot read a size of zero', async () => {
    // A file where a directory was expected: readdir answers ENOTDIR, which is
    // not "nothing is there" — it is "this could not be measured". Reported as
    // zero, the ceiling would never fire for the rest of the clone.
    const dir = await mkdtemp(join(tmpdir(), 'size-'));
    const file = join(dir, 'a-file');
    await writeFile(file, 'not a directory');
    await expect(directorySize(file)).rejects.toThrow(/ENOTDIR/);
  });

  it('still ignores a file that vanishes between the listing and the question', async () => {
    // The normal case during a clone, and the reason the swallowing was there.
    // A directory whose entries are gone by the time they are stat-ed measures
    // what is left rather than failing.
    const dir = await mkdtemp(join(tmpdir(), 'size-'));
    await writeFile(join(dir, 'stays'), 'z'.repeat(42));
    await mkdir(join(dir, 'goes'));
    const { rm } = await import('node:fs/promises');
    const measuring = directorySize(dir);
    await rm(join(dir, 'goes'), { recursive: true, force: true });
    expect(await measuring).toBe(42);
  });
});

describe('what the poll does with a failure', () => {
  const source = (() => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    return readFileSync('packages/engine/src/runtime/repository.ts', 'utf8');
  })();

  it('catches it, because an unhandled rejection ends the worker', () => {
    // `void p.then(...)` with no catch is the shape that does it. The assertion
    // is on the catch being attached to the polling call, not merely present
    // somewhere in the file.
    expect(source).toMatch(/void directorySize\(path\)[\s\S]{0,600}?\.catch\(/);
  });

  it('says so once rather than on every tick', () => {
    expect(source).toMatch(/sizeUnmeasured/);
    expect(source).toMatch(/repository size could not be measured while cloning/);
  });
});
