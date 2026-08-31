/**
 * Telling a real vector from a picture wearing one's clothes.
 *
 * A logo arrives as `logo.svg` from a design tool and is assumed to be a
 * vector because of its extension. Half the time it is a PNG inside an SVG
 * envelope, which looks identical in a file browser, previews identically, and
 * then blurs the first time anybody scales it — usually on a printed banner or
 * a 16-pixel favicon, both of which are found out late.
 *
 * `tools/inspect-svg.mjs` answers that in one command. These tests hold it to
 * the only two answers that matter: it must not call an envelope a vector, and
 * it must not call a vector an envelope.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scratch = mkdtempSync(join(tmpdir(), 'vibefycode-svg-'));

function inspect(name: string, svg: string): { output: string; exitCode: number } {
  const path = join(scratch, name);
  writeFileSync(path, svg, 'utf8');
  try {
    return {
      output: execFileSync('node', ['tools/inspect-svg.mjs', path], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }),
      exitCode: 0,
    };
  } catch (error) {
    const failure = error as { stdout?: string; status?: number };
    return { output: failure.stdout ?? '', exitCode: failure.status ?? -1 };
  }
}

// A one-pixel PNG, so the fixture is a real raster payload rather than a
// string that happens to look like one.
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const WRAPPED = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 384 383.999986">
<metadata><ContainsAiGeneratedContent>Yes</ContainsAiGeneratedContent><c2pa:manifest/></metadata>
<image xlink:href="data:image/png;base64,${ONE_PIXEL_PNG}" width="384" height="384"/>
</svg>`;

const REAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<path d="M136 104 C164 212 198 306 240 354" stroke="currentColor" fill="none"/>
<circle cx="256" cy="256" r="200" fill="none" stroke="currentColor"/>
</svg>`;

describe('a raster wrapped in an SVG envelope', () => {
  const { output, exitCode } = inspect('wrapped.svg', WRAPPED);

  it('is refused rather than accepted on its extension', () => {
    expect(exitCode).toBe(1);
    expect(output).toContain('A picture in a vector envelope');
  });

  it('reports the hidden payload and its format', () => {
    expect(output).toMatch(/payload 1\s+PNG/);
  });

  it('says what will go wrong, not merely that something is wrong', () => {
    expect(output).toContain('blur');
    expect(output).toContain('favicon');
  });

  it('surfaces AI-generation provenance', () => {
    expect(output).toContain('AI provenance');
    expect(output).toContain('C2PA');
  });

  it('does not credit the envelope with geometry it does not have', () => {
    expect(output).toMatch(/Vector geometry\s+none/);
  });
});

describe('a true vector', () => {
  const { output, exitCode } = inspect('real.svg', REAL);

  it('passes', () => {
    expect(exitCode).toBe(0);
    expect(output).toContain('A true vector');
  });

  it('counts the shapes that carry geometry', () => {
    expect(output).toMatch(/carrying shape data: 1/);
  });

  it('reports no embedded picture', () => {
    expect(output).toMatch(/Embedded pictures\s+none/);
  });
});

describe('a <path> element with no shape data', () => {
  // An empty <path> draws nothing. Counting elements is not counting geometry,
  // and some envelopes carry one, which would otherwise read as a vector.
  const { output, exitCode } = inspect(
    'empty-path.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
<path/><image xlink:href="data:image/png;base64,${ONE_PIXEL_PNG}"/>
</svg>`,
  );

  it('is not counted as geometry', () => {
    expect(exitCode).toBe(1);
    expect(output).toContain('A picture in a vector envelope');
  });
});

describe('the marks this product actually ships', () => {
  it('are true vectors, except the badge, which carries the supplied seal', () => {
    // The generated files are the ones that go on somebody else's website at
    // whatever size they choose. If one of them ever became a wrapped raster by
    // accident, it would look fine here and bad there.
    //
    // The badge is the deliberate exception, and the reason is the whole point
    // of this project: a rating whose own mark is a redrawing of itself is not
    // one to trust with anything else. So the badge carries the supplied
    // artwork, and what guards it is `check:brand`'s checksum rather than this
    // gate — provenance in place of geometry.
    //
    // The committed masters in `brand/svg/`, not the generated copies under
    // `apps/web/public/`, so this holds without a build having run.
    for (const file of readdirSync(join(process.cwd(), 'brand/svg')).filter((name) =>
      name.endsWith('.svg'),
    )) {
      // The inspector exits 1 on a wrapped raster, which every badge master now
      // deliberately is, so its output has to be read off the thrown error.
      let output: string;
      try {
        output = execFileSync('node', ['tools/inspect-svg.mjs', join('brand/svg', file)], {
          cwd: process.cwd(),
          encoding: 'utf8',
        });
      } catch (error) {
        output = String((error as { stdout?: Buffer }).stdout ?? '');
      }

      if (file.includes('badge')) {
        expect(output, file).toContain('A picture in a vector envelope');
        continue;
      }
      expect(output, file).toContain('A true vector');
    }
  });
});

describe('live text in a shipped mark', () => {
  it('is called out, because it renders in whatever font the viewer has', () => {
    const { output } = inspect(
      'text.svg',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0 L10 10"/><text x="0" y="0">VERIFIED</text></svg>`,
    );
    expect(output).toContain('Live text');
    expect(output).toContain('outline it before shipping');
  });
});
