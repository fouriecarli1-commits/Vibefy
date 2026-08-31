/**
 * The three model-driven stages, as configuration.
 *
 * They differ only in which prompt drives them, which tools they get, and what
 * the opening brief says. Everything structural — evidence enforcement, ceiling
 * handling, the browser's scope routing — is shared, so a change to how the
 * boundary works cannot apply to two of the three and be forgotten on the last.
 */
import { createModelStage } from './model-stage.ts';
import type { Stage, StageContext } from './types.ts';

function targetSummary(context: StageContext): string {
  const { target, guard, syntheticCredentials } = context;
  return [
    `Application: ${target.appName}`,
    target.description ? `The owner describes it as: ${target.description}` : null,
    `Entry point: ${target.primaryUrl}`,
    `Authorised hosts: ${guard.policy.allowedHosts.join(', ')}`,
    guard.policy.exclusions.length > 0
      ? `Explicitly out of scope: ${guard.policy.exclusions.join(', ')}`
      : 'No exclusions were declared.',
    `Rate ceiling: ${guard.policy.ceiling.maxRequestsPerMinute} requests per minute, ${guard.policy.ceiling.maxTotalRequests} in total.`,
    syntheticCredentials
      ? `Synthetic test account provided by the owner: ${syntheticCredentials.email} / ${syntheticCredentials.password}. It exists for this assessment; treat it as the only account you may sign in as.`
      : 'No test account was provided, so anything behind sign-in is out of reach for this run. Say so rather than guessing at it.',
    target.isGame ? 'The owner registered this as a game.' : null,
    `The owner told us this application ${target.hasAuthentication ? 'has' : 'does not have'} authentication, ${target.hasPayments ? 'does' : 'does not'} take payments, and ${target.processesPersonalData ? 'does' : 'does not'} process personal data. Those are claims to check, not facts.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export const functionalExplorationStage: Stage = createModelStage({
  id: 'functional_exploration',
  promptId: 'functional-exploration',
  includeHttpTool: false,
  appliesTo: (context) => Boolean(context.target.primaryUrl),
  brief: (context) =>
    `${targetSummary(context)}\n\nYour job in this stage is functional integrity: does the core flow complete, and what happens at the edges. You are not looking for security defects here; another stage does that.`,
});

export const adversarialPracticalityStage: Stage = createModelStage({
  id: 'adversarial_practicality',
  promptId: 'adversarial-practicality',
  includeHttpTool: true,
  // The adversarial pass is the one with real legal weight, so it only runs on a
  // full or continuous assessment, where the customer has completed the stronger
  // authorisation flow. A free, limited run never reaches it.
  appliesTo: (context) => Boolean(context.target.primaryUrl) && context.depth !== 'limited',
  brief: (context) =>
    `${targetSummary(context)}\n\nYour job in this stage is security posture and practicality. Work through the recurring failure modes, one small probe each. Remember that the smallest probe that demonstrates a defect is the correct probe, and that a finding you cannot evidence is not a finding.`,
});

export const storeReadinessStage: Stage = createModelStage({
  id: 'store_readiness',
  promptId: 'store-readiness',
  includeHttpTool: true,
  appliesTo: (context) => Boolean(context.target.primaryUrl) && context.target.intendedForAppStore,
  brief: (context) =>
    `${targetSummary(context)}\n\nThe owner intends to submit this to an app store. Check it against the published submission requirements. You are reporting alignment with those requirements as of today, not predicting a reviewer's decision.`,
});

/**
 * Games, assessed as games.
 *
 * The general stages ask whether the primary journey completes. For a game the
 * primary journey is *playing*, and the ways one fails are its own: a loading
 * bar that never finishes, forty megabytes before anything happens, controls
 * that no finger can use, a save that silently disappears. A check that asks
 * only whether the page returned 200 sees none of that.
 *
 * It runs on a full or continuous assessment, like the adversarial stage: a
 * free limited run is one cheap pass, and playing a game for long enough to
 * find its third-input console error is not that.
 */
export const gameExperienceStage: Stage = createModelStage({
  id: 'game_experience',
  promptId: 'game-experience',
  includeHttpTool: false,
  appliesTo: (context) =>
    Boolean(context.target.primaryUrl) && context.target.isGame && context.depth !== 'limited',
  skipReason: (context) =>
    !context.target.isGame
      ? 'this application was not registered as a game'
      : context.depth === 'limited'
        ? 'the game pass plays the game for a while, which a free limited run does not pay for'
        : 'there is no URL to open',
  brief: (context) =>
    `${targetSummary(context)}\n\nYour job in this stage is the game itself: whether it becomes playable, what it costs to get there, whether it works on a phone, and whether progress survives. You are not judging whether it is any good — not fun, not original, not pretty. That is taste, it cannot be evidenced, and it is not what was sold.`,
});
