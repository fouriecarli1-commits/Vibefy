/**
 * Where the code came from, and what its licence asks.
 *
 * Asked for on 2026-10-18, after GitHub made open-source licence compliance
 * generally available two days earlier: Enterprise Cloud, Code Security on,
 * enforced by blocking a pull request whose dependency licences are against
 * the policy. Nobody building an application with an AI assistant is near
 * that, and they are the people most likely to be carrying somebody else's
 * code — a starter template copied whole, a snippet with a copyright header
 * still attached, a font dropped into `public/` because it looked right.
 *
 * `observeProvenance` reads a clone and says what is there. Three rules hold
 * every case in this file:
 *
 *   · it states what is in the repository and what the licence asks, and never
 *     whether the owner is in breach — that depends on whether they distribute,
 *     to whom, under what terms and in which country, none of which this engine
 *     knows and all of which a lawyer asks first;
 *   · what it could not establish is said out loud, because a dependency
 *     licence cannot be read from a manifest and "we did not look" is not
 *     "there is nothing there";
 *   · nothing here is a score. These are observations, and whether provenance
 *     belongs in the published rubric is the founder's decision, recorded in
 *     `docs/OPEN_ITEMS.md` and not taken here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './setup/source.ts';
import {
  copyrightHolders,
  isCopyleft,
  observeProvenance,
  type ProvenanceId,
  type RepositoryView,
} from '../packages/engine/src/stages/provenance.ts';

/** A repository as a literal: every case below is a few files and their text. */
const repository = (files: Record<string, string>): RepositoryView => ({
  files: Object.keys(files),
  read: (path) => files[path] ?? null,
});

const ids = (view: RepositoryView): ProvenanceId[] =>
  observeProvenance(view).map((observation) => observation.id);

const MIT = (holder: string) => `MIT License

Copyright (c) 2026 ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy...`;

describe('a repository that says nothing about its licence', () => {
  it('says so, and says what the default is', () => {
    const observed = observeProvenance(repository({ 'index.ts': 'export const hello = 1;\n' }));
    const licence = observed.find((entry) => entry.id === 'no_licence');
    expect(licence).toBeDefined();
    expect(licence!.detail).toMatch(/nobody may copy/i);
  });

  it('does not say it where a licence file is there', () => {
    expect(
      ids(repository({ LICENSE: MIT('Kettle Ltd'), 'index.ts': 'export const a = 1;\n' })),
    ).not.toContain('no_licence');
  });

  it('finds the licence file whatever it is called', () => {
    for (const name of ['LICENSE', 'LICENCE.md', 'COPYING', 'UNLICENSE', 'LICENSE.txt']) {
      expect(ids(repository({ [name]: 'Public domain.\n' })), name).not.toContain('no_licence');
    }
  });
});

describe('a licence that belongs to somebody else', () => {
  it('names the holder rather than guessing whether it is theirs', () => {
    const observed = observeProvenance(repository({ LICENSE: MIT('Vercel, Inc.') }));
    const holder = observed.find((entry) => entry.id === 'licence_holder_is_somebody_else');
    expect(holder).toBeDefined();
    expect(holder!.detail).toContain('Vercel, Inc.');
    // The judgement is left where it belongs.
    expect(holder!.detail).toMatch(/where that is not you/i);
  });

  it('reads the holder out of the usual forms', () => {
    expect(copyrightHolders('Copyright (c) 2026 Kettle Ltd')).toEqual(['Kettle Ltd']);
    expect(copyrightHolders('Copyright © 2019-2024, Acme Inc. All rights reserved.')).toEqual([
      'Acme Inc',
    ]);
    // A GPL preamble names the Free Software Foundation, which is the licence
    // talking about itself rather than a claim about this repository.
    expect(copyrightHolders('Copyright (C) 2007 Free Software Foundation, Inc.')).toEqual([]);
  });
});

describe('copyleft', () => {
  it('knows the families by their identifier', () => {
    for (const identifier of ['GPL-3.0', 'agpl-3.0-only', 'LGPL-2.1', 'SSPL-1.0']) {
      expect(isCopyleft(identifier), identifier).toBe(true);
    }
    for (const identifier of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC']) {
      expect(isCopyleft(identifier), identifier).toBe(false);
    }
  });

  it('says what the project itself declares', () => {
    const observed = observeProvenance(
      repository({
        LICENSE: 'GNU AFFERO GENERAL PUBLIC LICENSE\n',
        'package.json': JSON.stringify({ name: 'kettle', license: 'AGPL-3.0' }),
      }),
    );
    const declared = observed.find((entry) => entry.id === 'copyleft_declared');
    expect(declared?.title).toContain('AGPL-3.0');
    expect(declared?.detail).toMatch(/same terms/i);
    // Stated as a question about intent, not as a verdict.
    expect(declared?.detail).toMatch(/legitimate choice/i);
  });

  it('finds a copyleft header inside a file whatever the project declares', () => {
    const observed = observeProvenance(
      repository({
        LICENSE: MIT('Kettle Ltd'),
        'package.json': JSON.stringify({ name: 'kettle', license: 'MIT' }),
        'src/encode.ts': '// SPDX-License-Identifier: GPL-3.0-or-later\nexport const encode = 1;\n',
      }),
    );
    const inSource = observed.find((entry) => entry.id === 'copyleft_in_source');
    expect(inSource?.paths).toContain('src/encode.ts');
    expect(inSource?.detail).toMatch(/travel with the file/i);
  });
});

describe('what a clone cannot answer', () => {
  it('says the dependency licences were not established, rather than passing over them', () => {
    const observed = observeProvenance(
      repository({
        LICENSE: MIT('Kettle Ltd'),
        'package.json': JSON.stringify({
          name: 'kettle',
          license: 'MIT',
          dependencies: { next: '^16.0.0', react: '^18.3.1' },
        }),
      }),
    );
    const unknown = observed.find((entry) => entry.id === 'dependency_licences_unknown');
    expect(unknown?.title).toContain('2 direct dependencies');
    // The sentence that matters: this is our gap, not their clean result.
    expect(unknown?.detail).toMatch(/only that they were not read/i);
  });

  it('reads them where the installed tree is committed', () => {
    const observed = observeProvenance(
      repository({
        LICENSE: MIT('Kettle Ltd'),
        'package.json': JSON.stringify({ name: 'kettle', dependencies: { sharp: '^0.33.0' } }),
        'node_modules/sharp/package.json': JSON.stringify({ name: 'sharp', license: 'Apache-2.0' }),
        'node_modules/readline-sync/package.json': JSON.stringify({
          name: 'readline-sync',
          license: 'GPL-3.0',
        }),
      }),
    );
    const declared = observed.find((entry) => entry.id === 'copyleft_declared');
    expect(declared?.title).toContain('1 installed dependency declares');
    expect(declared?.detail).toContain('readline-sync (GPL-3.0)');
    // And it no longer says they were not read, because they were.
    expect(observed.map((entry) => entry.id)).not.toContain('dependency_licences_unknown');
  });
});

describe('what was copied in', () => {
  it('names a copyright holder who is not this project', () => {
    const observed = observeProvenance(
      repository({
        LICENSE: MIT('Kettle Ltd'),
        'src/own.ts': '// Copyright (c) 2026 Kettle Ltd\nexport const own = 1;\n',
        'src/borrowed.ts':
          '/* Copyright (c) 2019 Acme Inc. All rights reserved. */\nexport const b = 2;\n',
      }),
    );
    const foreign = observed.find((entry) => entry.id === 'foreign_copyright');
    expect(foreign?.detail).toContain('Acme Inc');
    // The project's own name is not reported back to it as foreign.
    expect(foreign?.detail).not.toContain('Kettle Ltd');
    expect(foreign?.paths).toContain('src/borrowed.ts');
  });

  it('reports third-party source committed into the repository', () => {
    const observed = observeProvenance(
      repository({
        LICENSE: MIT('Kettle Ltd'),
        'vendor/slugify/index.js': 'module.exports = () => {};\n',
      }),
    );
    expect(observed.find((entry) => entry.id === 'vendored_code')?.paths).toContain(
      'vendor/slugify/index.js',
    );
  });

  it('ignores node_modules, which is somebody else by definition', () => {
    const observed = observeProvenance(
      repository({
        LICENSE: MIT('Kettle Ltd'),
        'node_modules/left-pad/index.js': '// Copyright (c) 2016 azer\nmodule.exports = 1;\n',
      }),
    );
    expect(observed.map((entry) => entry.id)).not.toContain('foreign_copyright');
  });
});

describe('a font dropped into the repository', () => {
  it('is reported when no licence travels with it', () => {
    const observed = observeProvenance(repository({ 'public/fonts/Inter.woff2': '\u0000binary' }));
    const font = observed.find((entry) => entry.id === 'bundled_font_without_a_licence');
    expect(font?.paths).toContain('public/fonts/Inter.woff2');
    // Not an accusation: the terms are missing, not necessarily breached.
    expect(font?.detail).toMatch(/does not say this one may not be used|says the terms/i);
  });

  it('is not reported when the licence sits beside it', () => {
    const observed = observeProvenance(
      repository({
        'public/fonts/Inter.woff2': '\u0000binary',
        'public/fonts/OFL.txt': 'SIL Open Font License\n',
      }),
    );
    expect(observed.map((entry) => entry.id)).not.toContain('bundled_font_without_a_licence');
  });
});

describe('one list, two readers', () => {
  it('is the only place a licence family is named', () => {
    /*
     * `static-intake.ts` had its own `COPYLEFT` and `LICENCE_FILENAMES` and its
     * own `isCopyleft`, written first and copied here the same evening. Two
     * lists is how one of them comes to call LGPL-3.0 copyleft while the other
     * does not — a disagreement nobody notices until two sentences in one
     * report contradict each other.
     */
    const intake = readFileSync(
      join(process.cwd(), 'packages/engine/src/stages/static-intake.ts'),
      'utf8',
    );
    expect(intake).toContain("from './provenance.ts'");
    expect(withoutComments(intake)).not.toMatch(/const COPYLEFT\s*=/);
    expect(withoutComments(intake)).not.toMatch(/const LICENCE_FILENAMES\s*=/);
    expect(withoutComments(intake)).not.toMatch(/function isCopyleft/);
  });
});

describe('a repository with nothing to report', () => {
  it('is quiet about everything it found nothing for', () => {
    // The positive control for the whole file: a project that licenses itself,
    // writes its own code and installs nothing produces no observation at all.
    const observed = observeProvenance(
      repository({
        LICENSE:
          'The Unlicense\n\nThis is free and unencumbered software released into the public domain.\n',
        'package.json': JSON.stringify({ name: 'kettle', license: 'Unlicense' }),
        'src/index.ts': 'export const hello = 1;\n',
      }),
    );
    expect(observed).toEqual([]);
  });
});
