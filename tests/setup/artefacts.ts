/**
 * Somewhere for evidence bytes to go, in a test.
 *
 * `persistOutcome` takes the bodies and a place to put them, and it takes them
 * as required fields on purpose: the `evidence` row has carried a
 * `storage_path` since the first migration and nothing ever wrote a byte to
 * one, so every finding cited proof we did not hold. The compiler asking each
 * caller is the point.
 */
import type { AssessmentOutcome } from '../../packages/engine/src/index.ts';

export interface MemoryStorage {
  readonly files: Map<string, Buffer>;
  put(
    path: string,
    body: Buffer,
  ): Promise<{ storagePath: string; sha256: string; byteSize: number }>;
  get(path: string): Promise<Buffer | null>;
  remove(path: string): Promise<void>;
}

export function memoryStorage(): MemoryStorage {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(path, body) {
      files.set(path, body);
      return { storagePath: path, sha256: 'x'.repeat(64), byteSize: body.byteLength };
    },
    async get(path) {
      return files.get(path) ?? null;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

/**
 * Bytes for an outcome assembled by hand.
 *
 * A test whose subject is what lands in which table does not have a real
 * capture behind it. The one guarantee that matters — that what is stored is
 * what the run captured — is held by the test that uses a real store.
 */
export function bodiesFor(outcome: AssessmentOutcome): Map<string, Buffer> {
  return new Map(
    outcome.evidence.map((artefact) => [artefact.id, Buffer.from(`body:${artefact.id}`)] as const),
  );
}
