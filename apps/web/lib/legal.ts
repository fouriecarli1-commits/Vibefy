import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import registryJson from '../../../legal/registry.json' with { type: 'json' };

interface RegistryEntry {
  version: string | null;
  status: string | null;
  requiresConsent: boolean;
  consentDocumentType: string | null;
  isDraft: boolean;
  sha256: string;
}

const registry = registryJson as unknown as {
  jurisdictionBaseline: string;
  documents: Record<string, RegistryEntry>;
};

/**
 * Serves the drafted legal artefacts from the same files the registry hashes.
 * The page a customer reads and the bytes their consent record points at are
 * therefore the same bytes — which is the entire point of recording the hash.
 */
export interface LegalDocument {
  readonly slug: string;
  readonly file: string;
  readonly title: string;
  readonly version: string;
  readonly status: string;
  readonly sha256: string;
  readonly requiresConsent: boolean;
  readonly markdown: string;
}

const legalDir = join(process.cwd(), '..', '..', 'legal');

export function listLegalDocuments(): LegalDocument[] {
  return Object.entries(registry.documents)
    .map(([file, entry]) => load(file, entry))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getLegalDocument(slug: string): LegalDocument | null {
  const match = Object.entries(registry.documents).find(
    ([file]) => file.replace(/\.md$/, '') === slug,
  );
  return match ? load(match[0], match[1]) : null;
}

function load(file: string, entry: RegistryEntry): LegalDocument {
  const markdown = readFileSync(join(legalDir, file), 'utf8');
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? file;
  return {
    slug: file.replace(/\.md$/, ''),
    file,
    title,
    version: entry.version ?? 'unversioned',
    status: entry.status ?? 'unknown',
    sha256: entry.sha256,
    requiresConsent: entry.requiresConsent,
    markdown,
  };
}

/** The documents a new account accepts, and the versions they accept. */
export const CONSENT_AT_SIGN_UP = [
  { documentType: 'terms_of_service', file: 'terms-of-service.md' },
  { documentType: 'privacy_policy', file: 'privacy-policy.md' },
] as const;

export function consentPayload() {
  return CONSENT_AT_SIGN_UP.map(({ documentType, file }) => {
    const entry = registry.documents[file];
    if (!entry?.version) throw new Error(`legal/registry.json has no versioned entry for ${file}`);
    return { documentType, version: entry.version, sha256: entry.sha256 };
  });
}
