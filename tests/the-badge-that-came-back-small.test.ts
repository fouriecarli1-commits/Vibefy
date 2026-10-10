/**
 * The size nobody asked for.
 *
 * `/badge/{id}.svg` reads an optional `?size=` so the served artwork matches
 * the space it will occupy. The absent case was not spelled out:
 * `searchParams.get` answers `null`, `Number(null)` is 0, and
 * `Number.isFinite(0)` is true — so a URL with no `size` took the branch meant
 * for a size somebody chose and was clamped up to the floor of 64. A garbage
 * value took the `undefined` branch correctly. The inversion is the whole
 * defect: a missing parameter counted as a choice, and a nonsense one as no
 * choice.
 *
 * What it cost. `renderBadgeUnavailableSvg` is the one renderer that reads the
 * number, for the width and height of the frame shown when a badge's status
 * cannot be checked. Every badge URL without `?size=` served that frame at 64
 * by 64 instead of full size — a small grey square where a badge should be,
 * which is how "the badge is not showing" gets described.
 *
 * `docs/DOEN.md` opens its deployment test with `/badge/nonexistent-test-id.svg`,
 * no size parameter, and names a grey frame as the failing outcome. So the one
 * URL the document asks him to try was the one that got the frame a quarter of
 * the size it should be.
 *
 * The embed snippet always writes `?size=`, so a customer following it was
 * never affected. A hand-written embed, or that test URL, was.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderBadgeUnavailableSvg } from '../packages/badge/src/render.ts';
import { VIEWBOX } from '../packages/shared/src/index.ts';

/** The lookup cannot answer, which is the path that renders the frame. */
vi.mock('@/lib/badge-verification', () => ({
  lookUpBadgeVerification: async () => {
    throw new Error('the database did not answer');
  },
}));
vi.mock('@/lib/sql', () => ({ writeAsService: async () => undefined }));

type BadgeRoute = {
  GET: (
    request: unknown,
    context: { params: Promise<{ file: string }> },
  ) => Promise<{ status: number; headers: Headers; text: () => Promise<string> }>;
};

async function loadRoute(): Promise<BadgeRoute> {
  const here = '../apps/web/app/badge/[file]/route.ts';
  return (await import(/* @vite-ignore */ here)) as BadgeRoute;
}

const widthOf = (svg: string) => Number(/width="(\d+)"/.exec(svg)?.[1]);

const previous = process.env.NEXT_PUBLIC_SITE_URL;
beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://vibefycode.com';
});
afterAll(() => {
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previous;
});

const ask = async (query: string) => {
  const { GET } = await loadRoute();
  return GET(
    {
      nextUrl: new URL(`https://vibefycode.com/badge/some-id.svg${query}`),
      headers: new Headers({ 'user-agent': 'vitest' }),
    },
    { params: Promise.resolve({ file: 'some-id.svg' }) },
  );
};

describe('the frame served when we cannot answer', () => {
  it('is full size when no size was asked for', async () => {
    const svg = await (await ask('')).text();
    expect(widthOf(svg), 'the frame came back smaller than the badge it replaces').toBe(VIEWBOX);
  });

  it('is full size when the size is not a number, which already worked', async () => {
    expect(widthOf(await (await ask('?size=abc')).text())).toBe(VIEWBOX);
  });

  it('is full size when the parameter is there but empty', async () => {
    expect(widthOf(await (await ask('?size=')).text())).toBe(VIEWBOX);
  });

  it('is the size the embed snippet asked for when it asked', async () => {
    // The positive control: a fallback that ignored the parameter entirely
    // would satisfy every assertion above.
    expect(widthOf(await (await ask('?size=240')).text())).toBe(240);
  });

  it('is clamped at both ends, because this is a public endpoint', async () => {
    expect(widthOf(await (await ask('?size=1')).text())).toBe(64);
    expect(widthOf(await (await ask('?size=99999')).text())).toBe(1024);
  });
});

describe('the renderer the number reaches', () => {
  it('draws at the viewbox when it is given nothing', () => {
    expect(widthOf(renderBadgeUnavailableSvg())).toBe(VIEWBOX);
  });

  it('draws at what it is given, which is why the absent case mattered', () => {
    expect(widthOf(renderBadgeUnavailableSvg(64))).toBe(64);
    expect(widthOf(renderBadgeUnavailableSvg(300))).toBe(300);
  });
});
