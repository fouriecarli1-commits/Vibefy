/**
 * Where the code came from, and what its licence asks of the owner.
 *
 * The founder asked for this after GitHub made open-source licence compliance
 * generally available on 2026-10-16 — for Enterprise Cloud repositories with
 * Code Security on, enforced by blocking a pull request. Nobody building an
 * application with an AI assistant is anywhere near that, and they are the
 * people most likely to be carrying somebody else's code: a starter template
 * copied whole, a snippet with a copyright header still on it, a font dropped
 * into `public/` because it looked right.
 *
 * Everything here is read from the clone and nothing is fetched, which is the
 * same rule `static-intake.ts` states for itself. That bounds what can be
 * established, and the bound is reported rather than passed over: without the
 * installed tree there is no way to know what a dependency's licence is, and
 * "we did not look" is not "there is nothing there".
 *
 * ## What this deliberately does not do
 *
 * It does not say whether anything is a violation. The owner's exposure
 * depends on whether they distribute, to whom, under what terms, and in which
 * country — none of which this engine knows, and all of which a lawyer would
 * ask about first. So every observation states what is in the repository and
 * what the licence asks, and stops there. The brief is explicit that drafted
 * legal text is never presented as final, and a sentence telling somebody they
 * are in breach is worse than drafted: it is a conclusion about them.
 *
 * ## Why nothing emits these yet
 *
 * A finding needs a criterion the published rubric defines, and rubric 1.1.0
 * has forty-nine criteria and not one about licensing or provenance. The
 * licence check that already exists files its observations under `PRD-04`,
 * which is "Environment hygiene: no debug flags, test data or staging
 * endpoints in production" — the wrong question, under which a reader sees the
 * wrong label. Fixing that properly means either a criterion of its own in a
 * new rubric version, or a section of the report that is not a finding at all.
 * That is a decision about the published standard and it is the founder's;
 * `docs/OPEN_ITEMS.md` carries it. This module is the half that is hers to
 * attach rather than hers to decide.
 */

/** Copyleft families, lower-cased, as they appear in an SPDX identifier. */
export const COPYLEFT_IDENTIFIERS: readonly string[] = [
  'gpl-2.0',
  'gpl-3.0',
  'agpl-3.0',
  'agpl',
  'lgpl-2.1',
  'lgpl-3.0',
  'sspl',
  'osl-3.0',
  'eupl',
];

/** Licence files, at the root or beside the thing they cover. */
export const LICENCE_FILENAMES: readonly string[] = [
  'LICENSE',
  'LICENCE',
  'LICENSE.md',
  'LICENCE.md',
  'LICENSE.txt',
  'LICENCE.txt',
  'LICENSE-MIT',
  'LICENSE-APACHE',
  'COPYING',
  'COPYING.txt',
  'UNLICENSE',
  'OFL.txt',
  'OFL-FAQ.txt',
];

const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.eot'];
/** Directories whose contents are somebody else's work, kept in the repository. */
export const VENDOR_DIRECTORY_NAMES: readonly string[] = [
  'vendor',
  'vendored',
  'third_party',
  'third-party',
  '3rdparty',
];

/** What a reader is shown, in the order a reader should meet it. */
export type ProvenanceId =
  | 'no_licence'
  | 'copyleft_declared'
  | 'copyleft_in_source'
  | 'foreign_copyright'
  | 'licence_holder_is_somebody_else'
  | 'dependency_licences_unknown'
  | 'bundled_font_without_a_licence'
  | 'vendored_code';

export interface ProvenanceObservation {
  readonly id: ProvenanceId;
  /** One line, in the owner's terms. */
  readonly title: string;
  /** What was seen, and what the licence asks. Never what it means for them. */
  readonly detail: string;
  /** Repository-relative, capped, so a report does not become a file listing. */
  readonly paths: readonly string[];
}

/**
 * The clone, as this module needs it.
 *
 * A view rather than a directory, so every case here is testable from a
 * literal and nothing has to be written to disk to ask a question about it.
 */
export interface RepositoryView {
  /** Repository-relative paths, with forward slashes. */
  readonly files: readonly string[];
  /** The file's text, or null where it is binary, too large or unreadable. */
  readonly read: (path: string) => string | null;
}

/** Enough to name, few enough to read. */
const SHOWN = 5;
const sample = (paths: readonly string[]): string[] => [...paths].sort().slice(0, SHOWN);

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const directory = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

const isLicenceFile = (path: string): boolean => {
  const name = basename(path).toUpperCase();
  return LICENCE_FILENAMES.some((candidate) => name === candidate.toUpperCase());
};

export function isCopyleft(licence: string): boolean {
  const lowered = licence.toLowerCase();
  return COPYLEFT_IDENTIFIERS.some((candidate) => lowered.includes(candidate));
}

/**
 * The names a licence file says it belongs to.
 *
 * Every licence this is likely to meet carries one: MIT and BSD open with
 * "Copyright (c) <year> <holder>", Apache-2.0 carries it in its appendix, and
 * a file with none is usually a bare licence text somebody pasted.
 */
export function copyrightHolders(text: string): string[] {
  const holders = new Set<string>();
  for (const match of text.matchAll(
    /copyright\s*(?:\(c\)|©|&copy;)?\s*(?:[0-9]{4}(?:\s*[-–,]\s*(?:[0-9]{4}|present))?)?\s*,?\s*([^\n<(]{2,80})/gi,
  )) {
    const holder = match[1]!
      .replace(/all rights reserved.*$/i, '')
      .replace(/[.,;]\s*$/, '')
      .trim();
    // "Copyright (C) 2007 Free Software Foundation" inside a GPL preamble is
    // the licence's own text and not a claim about this repository.
    if (holder.length < 2 || /free software foundation/i.test(holder)) continue;
    holders.add(holder);
  }
  return [...holders];
}

const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.php',
  '.css',
  '.scss',
  '.sql',
  '.sh',
];

const isSource = (path: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));

/** The first lines of a file, where a licence header lives if there is one. */
const header = (text: string): string => text.split('\n').slice(0, 40).join('\n');

export function observeProvenance(view: RepositoryView): ProvenanceObservation[] {
  const observations: ProvenanceObservation[] = [];
  const files = view.files;

  const rootLicence = files.find((path) => !path.includes('/') && isLicenceFile(path));
  const licenceText = rootLicence === undefined ? null : view.read(rootLicence);
  const ownHolders = licenceText === null ? [] : copyrightHolders(licenceText);

  if (rootLicence === undefined) {
    observations.push({
      id: 'no_licence',
      title: 'The repository carries no licence file',
      detail:
        'Nothing in the repository says what anybody else may do with this code. Where the repository is public, the default is that nobody may copy, change or redistribute it — which is a choice, and usually not the one that was meant.',
      paths: [],
    });
  } else if (ownHolders.length > 0) {
    observations.push({
      id: 'licence_holder_is_somebody_else',
      title: `${rootLicence} names ${ownHolders.length === 1 ? 'a copyright holder' : 'copyright holders'}`,
      detail: `The licence file names ${ownHolders.join(', ')}. Where that is not you, the file came with code somebody else wrote, and the terms in it are theirs rather than yours to set.`,
      paths: [rootLicence],
    });
  }

  const manifestPath = files.find((path) => path === 'package.json');
  const manifest = manifestPath === undefined ? null : view.read(manifestPath);
  let declared: string | null = null;
  let dependencies: string[] = [];
  if (manifest !== null) {
    try {
      const parsed = JSON.parse(manifest) as {
        license?: unknown;
        dependencies?: Record<string, unknown>;
      };
      declared = typeof parsed.license === 'string' ? parsed.license : null;
      dependencies = Object.keys(parsed.dependencies ?? {});
    } catch {
      declared = null;
    }
  }

  if (declared !== null && isCopyleft(declared)) {
    observations.push({
      id: 'copyleft_declared',
      title: `The project declares ${declared}`,
      detail: `package.json declares "${declared}". That licence asks anyone who distributes the software to offer the source of it under the same terms. It is a legitimate choice; it is worth being sure it is the one that was meant.`,
      paths: manifestPath === undefined ? [] : [manifestPath],
    });
  }

  /*
   * What a dependency is licensed under cannot be read from a manifest.
   *
   * The name and the range are all it carries, and the licence lives in the
   * installed package — which a clone does not have, because `node_modules` is
   * not committed and nothing here installs anything. GitHub answers this from
   * its own dependency graph; we would have to ask a registry, which is a
   * network call and a decision about cost and scope that has not been taken.
   *
   * Said rather than skipped, and not as a finding about the application: this
   * is the half of the question this assessment did not answer.
   */
  const installed = files.filter(
    (path) => path.startsWith('node_modules/') && basename(path) === 'package.json',
  );
  if (dependencies.length > 0 && installed.length === 0) {
    observations.push({
      id: 'dependency_licences_unknown',
      title: `The licences of ${dependencies.length} direct dependenc${dependencies.length === 1 ? 'y' : 'ies'} were not established`,
      detail:
        'A manifest names a dependency and a version range; the licence is in the installed package, which this assessment does not have. Nothing here says those licences are fine — only that they were not read.',
      paths: manifestPath === undefined ? [] : [manifestPath],
    });
  } else if (installed.length > 0) {
    const copyleft: string[] = [];
    for (const path of installed) {
      const text = view.read(path);
      if (text === null) continue;
      try {
        const parsed = JSON.parse(text) as { name?: unknown; license?: unknown };
        if (typeof parsed.license === 'string' && isCopyleft(parsed.license)) {
          copyleft.push(
            `${typeof parsed.name === 'string' ? parsed.name : path} (${parsed.license})`,
          );
        }
      } catch {
        continue;
      }
    }
    if (copyleft.length > 0) {
      observations.push({
        id: 'copyleft_declared',
        title: `${copyleft.length} installed dependenc${copyleft.length === 1 ? 'y declares' : 'ies declare'} a copyleft licence`,
        detail: `${sample(copyleft).join(', ')}${copyleft.length > SHOWN ? `, and ${copyleft.length - SHOWN} more` : ''}. Those licences ask something of anyone who distributes software built on them, and what they ask depends on how the software is distributed.`,
        paths: [],
      });
    }
  }

  const foreign = new Map<string, string[]>();
  const copyleftSource: string[] = [];
  const vendored: string[] = [];

  for (const path of files) {
    if (path.startsWith('node_modules/')) continue;
    if (
      VENDOR_DIRECTORY_NAMES.some(
        (name) => path.startsWith(`${name}/`) || path.includes(`/${name}/`),
      )
    ) {
      if (isSource(path)) vendored.push(path);
    }
    if (!isSource(path)) continue;
    const text = view.read(path);
    if (text === null) continue;
    const top = header(text);

    const spdx = /SPDX-License-Identifier:\s*([^\s*/]+)/i.exec(top)?.[1];
    if (
      (spdx !== undefined && isCopyleft(spdx)) ||
      /GNU (?:General|Lesser) Public License/i.test(top)
    ) {
      copyleftSource.push(path);
    }

    for (const holder of copyrightHolders(top)) {
      if (ownHolders.some((own) => own.toLowerCase() === holder.toLowerCase())) continue;
      const seen = foreign.get(holder) ?? [];
      seen.push(path);
      foreign.set(holder, seen);
    }
  }

  if (copyleftSource.length > 0) {
    observations.push({
      id: 'copyleft_in_source',
      title: `${copyleftSource.length} source file${copyleftSource.length === 1 ? '' : 's'} carr${copyleftSource.length === 1 ? 'ies' : 'y'} a copyleft licence header`,
      detail:
        'A file in this repository states a copyleft licence of its own. Those terms travel with the file, whatever the project around it declares.',
      paths: sample(copyleftSource),
    });
  }

  if (foreign.size > 0) {
    const names = [...foreign.keys()].sort();
    const paths = [...foreign.values()].flat();
    observations.push({
      id: 'foreign_copyright',
      title: `${names.length} copyright holder${names.length === 1 ? '' : 's'} other than this project ${names.length === 1 ? 'appears' : 'appear'} in the source`,
      detail: `${sample(names).join(', ')}${names.length > SHOWN ? `, and ${names.length - SHOWN} more` : ''}. A copyright line that is not yours means the file, or part of it, came from somewhere else — which is ordinary, and is worth knowing the terms of.`,
      paths: sample(paths),
    });
  }

  if (vendored.length > 0) {
    observations.push({
      id: 'vendored_code',
      title: `Third-party source is committed into this repository`,
      detail:
        'Code under a vendor directory is somebody else’s work kept inside your repository. Whatever licence it arrived under still applies to it there.',
      paths: sample(vendored),
    });
  }

  const fonts = files.filter((path) =>
    FONT_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension)),
  );
  const unlicensedFonts = fonts.filter((path) => {
    const beside = directory(path);
    return !files.some(
      (candidate) =>
        isLicenceFile(candidate) &&
        (directory(candidate) === beside ||
          (rootLicence !== undefined && candidate === rootLicence)),
    );
  });
  if (unlicensedFonts.length > 0) {
    observations.push({
      id: 'bundled_font_without_a_licence',
      title: `${unlicensedFonts.length} font file${unlicensedFonts.length === 1 ? '' : 's'} ${unlicensedFonts.length === 1 ? 'is' : 'are'} bundled with no licence beside ${unlicensedFonts.length === 1 ? 'it' : 'them'}`,
      detail:
        'Most freely available fonts are licensed, and the common ones ask for the licence file to travel with the font. Nothing here says this one may not be used; it says the terms it came under are not in the repository.',
      paths: sample(unlicensedFonts),
    });
  }

  return observations;
}
