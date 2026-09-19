/**
 * The answer, when somebody asks for it.
 *
 * It does not light up by itself, and that is the point rather than a
 * limitation we did not get round to: an icon that lights up on its own has to
 * watch every page you open. This looks only when you click it, and even then
 * it only consults a list already on your computer.
 *
 * The last line of the popup says so, every time, because a privacy claim made
 * once in a store listing is a privacy claim nobody has read.
 */
import { answerFor } from './lookup.js';
import { STORAGE_KEY } from './config.js';

/** @type {Record<import('./lookup.js').AnswerKind, string>} */
const HEADLINE = {
  badged: 'This site has a live badge',
  none: 'No badge for this site',
  not_a_page: 'Nothing to check here',
  no_list: 'Not ready yet',
};

/**
 * An element the popup's own HTML is known to contain.
 *
 * Thrown rather than skipped: a popup that silently renders nothing because an
 * id was renamed is a popup that looks like it decided the site has no badge.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The popup is missing #${id}.`);
  return found;
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  // `chrome.storage` returns whatever was put in it, which the type system can
  // only describe as an object. The shape is written by `background.js` two
  // files away, and the cast says so rather than pretending to have checked.
  const list = /** @type {import('./lookup.js').StoredList | null} */ (stored[STORAGE_KEY] ?? null);
  const answer = answerFor(list, tab?.url ?? '');

  element('headline').textContent = HEADLINE[answer.kind];
  element('detail').textContent = answer.detail;

  if (answer.kind === 'badged' && answer.entry) {
    const link = document.createElement('a');
    link.href = answer.entry.verificationPage;
    link.textContent = 'What was checked, and what was not';
    link.target = '_blank';
    link.rel = 'noopener';
    element('link').append(link);
  }

  element('how').textContent =
    'This was answered from a list already on your computer. Nothing about the page you are on was sent anywhere.';
}

void main();
