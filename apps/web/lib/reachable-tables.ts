/**
 * Makes a rendered table reachable by keyboard when it has to scroll sideways.
 *
 * Our legal documents are markdown, and a markdown table on a phone is wider
 * than the screen. The stylesheet lets it scroll, which looks fine and is a
 * serious accessibility failure: a box that scrolls and cannot be focused has a
 * right-hand half that does not exist for somebody using a keyboard. They can
 * reach every link on the page and never see the third column.
 *
 * It is invisible at desktop width, where nothing scrolls, which is exactly why
 * it sat in the privacy policy until the accessibility scan started running at
 * phone width as well.
 *
 * Two attributes, and both are needed. `tabindex` makes it reachable, so the
 * arrow keys scroll it. The label says what has been reached — "region" alone
 * tells somebody they have arrived somewhere and not where — and it is taken
 * from the heading the table sits under, because that is what a reader would
 * call it if asked.
 */
export function makeTablesReachable(html: string): string {
  let heading = 'Table';
  return html.replace(
    /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<table(?![^>]*tabindex)/gi,
    (match, tag: string | undefined, text: string | undefined) => {
      if (tag) {
        const plain = (text ?? '').replace(/<[^>]*>/g, '').trim();
        if (plain) heading = plain;
        return match;
      }
      return `<table tabindex="0" role="region" aria-label="${escapeAttribute(heading)}"`;
    },
  );
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
