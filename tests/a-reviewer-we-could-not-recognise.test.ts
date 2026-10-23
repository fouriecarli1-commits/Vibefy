/**
 * A reviewer told the queue is not for them, because we could not read their
 * row.
 *
 * Six places asked the same question and every one of them dropped the error:
 *
 *     const { data: profile } = await supabase
 *       .from('users').select('platform_role').eq('id', user.id).single();
 *     if (profile?.platform_role !== 'reviewer') refuse();
 *
 * The refusal is right and stays. A role we cannot read has not been proved,
 * and the one direction that must never happen here is a failed read letting
 * somebody into the review queue — so this is fail-closed and remains so.
 *
 * What was wrong is what the person was told. A reviewer whose own row could
 * not be read was shown "this queue is for VibefyCode reviewers": a sentence
 * about them, when the truth was a sentence about us. Nothing recorded that the
 * question had failed, so the only person who could ever find out was the one
 * being refused, and what they had to go on was a message saying the refusal
 * was correct.
 *
 * Same shape as `whoIsSignedIn`, same answer: refuse as before, say which
 * refusal it is, and write the failure down once a minute rather than never.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPlatformStaff,
  roleFrom,
  whyTheyCannotBeLetIn,
} from '../apps/web/lib/what-role-they-have.ts';
import { forgetWhatWasSaid } from '../apps/web/lib/said-recently.ts';
import { commentsBlanked } from './setup/source.ts';

let said: { message: string; detail: Record<string, unknown> }[];

beforeEach(() => {
  forgetWhatWasSaid();
  said = [];
  vi.spyOn(console, 'error').mockImplementation((message: unknown, detail?: unknown) => {
    said.push({ message: String(message), detail: (detail ?? {}) as Record<string, unknown> });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetWhatWasSaid();
});

describe('a role we could read', () => {
  it('comes back as itself, quietly', () => {
    expect(roleFrom({ data: { platform_role: 'reviewer' }, error: null }, 'u')).toBe('reviewer');
    expect(roleFrom({ data: { platform_role: 'admin' }, error: null }, 'u')).toBe('admin');
    expect(said).toEqual([]);
  });

  it('is none for a customer, which is not a failure', () => {
    expect(roleFrom({ data: { platform_role: 'customer' }, error: null }, 'u')).toBe('none');
    expect(roleFrom({ data: { platform_role: null }, error: null }, 'u')).toBe('none');
    expect(said).toEqual([]);
  });

  it('is none for a row that is not there, which is the ordinary case', () => {
    /*
     * PostgREST answers `single()` with PGRST116 when nothing matched, and
     * under row-level security that is also what somebody sees when the row
     * exists and is not theirs. Either way it is an answer, and saying it would
     * be a line every time a customer opens a page that happens to ask.
     */
    expect(roleFrom({ data: null, error: { code: 'PGRST116', message: 'no rows' } }, 'u')).toBe(
      'none',
    );
    expect(said).toEqual([]);
  });
});

describe('a question we could not ask', () => {
  it('is unknown, which is not none', () => {
    const role = roleFrom({ data: null, error: { message: 'statement timeout' } }, 'u-1');
    expect(role).toBe('unknown');
    // Fail-closed: the one direction that must never happen is a failed read
    // letting somebody into the queue.
    expect(isPlatformStaff(role)).toBe(false);
  });

  it('is said, with what the person got instead', () => {
    roleFrom({ data: null, error: { message: 'statement timeout' } }, 'u-1');
    expect(said).toHaveLength(1);
    expect(said[0]!.message).toBe(
      'could not read the platform role of somebody asking for a staff page',
    );
    expect(String(said[0]!.detail.shown)).toMatch(/could not check/i);
    expect(said[0]!.detail.userId).toBe('u-1');
    expect(said[0]!.detail.error).toBe('statement timeout');
  });

  it('is told to the person as ours rather than as theirs', () => {
    const ordinary = 'This queue is for VibefyCode reviewers.';
    const ours = whyTheyCannotBeLetIn('unknown', ordinary);
    expect(ours).toMatch(/could not check/i);
    expect(ours).toMatch(/our fault rather than anything about your account/i);
    expect(ours).toMatch(/reload/i);
    expect(ours).toContain('reviewer');
  });

  it('keeps each page\u2019s own ordinary sentence, because none of them was wrong', () => {
    const ordinary = 'This dashboard is for VibefyCode administrators.';
    expect(whyTheyCannotBeLetIn('none', ordinary, 'administrator')).toBe(ordinary);
    expect(whyTheyCannotBeLetIn('reviewer', ordinary, 'administrator')).toBe(ordinary);
    // And says which audience it is about, where the audience differs.
    expect(whyTheyCannotBeLetIn('unknown', ordinary, 'administrator')).toContain('administrator');
  });
});

describe('everywhere that asks', () => {
  it('reads the role, and never decides from it on the spot', async () => {
    /*
     * The six sites may still write their own query — `roleFrom` takes what
     * came back rather than the client, because describing the client
     * structurally made TypeScript give up ("type instantiation is excessively
     * deep"). What none of them may do is compare the value themselves, which
     * is the step that cannot tell a failed read from a customer.
     */
    const { execFileSync } = await import('node:child_process');
    const files = execFileSync('git', ['ls-files', 'apps/web'], { encoding: 'utf8' })
      .split('\n')
      .filter((path) => /\.tsx?$/.test(path));
    const compared: string[] = [];
    for (const path of files) {
      if (path === 'apps/web/lib/what-role-they-have.ts') continue;
      const lines = commentsBlanked(readFileSync(path, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (!/platform_role\s*[!=]==?/.test(line)) return;
        compared.push(`${path}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(
      compared,
      `these compare a platform role on the spot, so a read that failed reads as a customer:\n${compared.join('\n')}`,
    ).toEqual([]);
  });
});
