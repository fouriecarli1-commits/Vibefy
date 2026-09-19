/**
 * One request an hour, for the whole list. Never one per site.
 *
 * This is the only place in the extension that touches the network, and it
 * asks the same question every time regardless of what anybody is browsing:
 * "which badges are live". The answer is a document about us, not a question
 * about them, so there is nothing in the request to leak.
 *
 * The alarm is an hour because the list is cached for an hour at the other end.
 * Asking more often would cost somebody bandwidth to receive the same bytes.
 */
import { LIST_URL, STORAGE_KEY } from './config.js';

const ONE_HOUR_IN_MINUTES = 60;

async function refresh() {
  try {
    const response = await fetch(LIST_URL, { cache: 'no-cache' });
    if (!response.ok) return;
    const list = await response.json();
    // Only the two fields the popup reads are kept. Storing the whole document
    // would mean holding fields nobody uses, which is how a store review turns
    // into a question about what else is in there.
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        generatedAt: list.generatedAt,
        badges: (list.badges ?? []).map(
          /** @param {Record<string, unknown>} badge */ (badge) => ({
            badgeId: badge.badgeId,
            certifiedOrigin: badge.certifiedOrigin,
            rubricVersion: badge.rubricVersion,
            assessedOn: badge.assessedOn,
            expiresOn: badge.expiresOn,
            verificationPage: badge.verificationPage,
          }),
        ),
      },
    });
  } catch {
    // A failed refresh leaves the previous list in place, which is the right
    // outcome: an older answer with its age shown beats no answer at all.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refresh', { periodInMinutes: ONE_HOUR_IN_MINUTES });
  void refresh();
});

chrome.runtime.onStartup.addListener(() => {
  void refresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh') void refresh();
});
