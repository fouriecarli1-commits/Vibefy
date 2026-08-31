/**
 * The address the badge is actually served from.
 *
 * The console used to fall back to `https://verify.vibefycode.example` when
 * neither environment variable was set, and hand that out inside the embed
 * snippet. A customer who followed the instructions exactly got a broken image
 * on their own website, and every part of that looks like their mistake rather
 * than ours.
 *
 * Found by the founder pasting the snippet into the wrong tool and me noticing
 * the domain in his screenshot, which is not a way to find defects that scales.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlaceholderOrigin, originFrom } from '../apps/web/lib/verify-origin.ts';

const page = readFileSync(join(process.cwd(), 'apps/web/app/console/apps/[id]/page.tsx'), 'utf8');

describe('resolving the origin', () => {
  it('prefers what the deployment was told, when it was told anything', () => {
    expect(originFrom('https://verify.vibefycode.co.za', 'ignored.test')).toBe(
      'https://verify.vibefycode.co.za',
    );
  });

  it('drops a trailing slash, which would otherwise double up in the URL', () => {
    expect(originFrom('https://vibefycode.co.za/', null)).toBe('https://vibefycode.co.za');
  });

  it('reads the request when nothing was configured', () => {
    // The console is being served from the origin the badge is served from, so
    // requiring somebody to have set a variable whose absence is silent was
    // always asking for a defect.
    expect(originFrom(undefined, 'vibefycode.vercel.app')).toBe('https://vibefycode.vercel.app');
  });

  it('uses http on localhost, so the snippet is testable where it was written', () => {
    expect(originFrom(undefined, 'localhost:3000')).toBe('http://localhost:3000');
    expect(originFrom(undefined, '127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
  });

  it('is obviously wrong rather than plausibly wrong when nothing can be inferred', () => {
    expect(isPlaceholderOrigin(originFrom(undefined, null))).toBe(true);
  });
});

describe('what the console does about it', () => {
  it('says the snippet will not work rather than handing one out silently', () => {
    expect(page).toContain('isPlaceholderOrigin');
    expect(page).toMatch(/will not work yet/i);
  });

  it('names the variable to set, so the message is actionable', () => {
    expect(page).toContain('NEXT_PUBLIC_SITE_URL');
  });
});

describe('the placeholder is recognisable', () => {
  it('for every shape it has taken', () => {
    expect(isPlaceholderOrigin('https://verify.vibefycode.example')).toBe(true);
    expect(isPlaceholderOrigin('https://vibefycode.example')).toBe(true);
    expect(isPlaceholderOrigin('https://vibefycode.co.za')).toBe(false);
  });
});
