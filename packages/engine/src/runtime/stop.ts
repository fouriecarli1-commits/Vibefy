/**
 * Turning the errors that stop a run into the reason it stopped.
 *
 * The words are in `@vibefycode/shared`, beside the scope statement, because the
 * console and the report have to say the same thing as the worker. What lives
 * here is the part that needs the error classes: which of the three deliberate
 * stops an exception represents, and whether it is a stop at all.
 *
 * One classifier, used by the pipeline and by the model stages, because two
 * would disagree within a release and the one on the customer's screen would be
 * the one nobody was reading.
 */
import type { StopReason } from '@vibefycode/shared';
import { CostCeilingExceededError } from './cost.ts';
import { CeilingExceededError, ScopeViolationError } from './scope.ts';

export type { StopReason };
export {
  STOP_EXPLANATION,
  STOP_HEADLINE,
  STOP_LABEL,
  STOP_REASONS,
  stopNote,
} from '@vibefycode/shared';

/** The stop reason this error represents, or null where it is a genuine fault. */
export function classifyStop(error: unknown): StopReason | null {
  if (error instanceof CostCeilingExceededError) return 'cost_ceiling';
  if (error instanceof CeilingExceededError) return 'intensity_ceiling';
  if (error instanceof ScopeViolationError) return 'scope_violation';
  return null;
}
