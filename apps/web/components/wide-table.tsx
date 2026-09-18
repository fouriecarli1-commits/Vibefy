/**
 * A table too wide for the screen, which a keyboard can still reach.
 *
 * A box that scrolls sideways and cannot be focused is a box whose right-hand
 * half does not exist for somebody using a keyboard — they can tab to every
 * link on the page and never reach the third column of a rate card. It is a
 * serious WCAG failure and it is invisible at desktop width, which is why it
 * sat in three of our own pages until the accessibility scan started running at
 * phone width as well.
 *
 * Two attributes fix it and both are needed. `tabIndex` makes the region
 * reachable, so the arrow keys scroll it. The label says what has been reached,
 * because "region" on its own tells somebody they have arrived somewhere and
 * not where.
 *
 * It is a component rather than a class so that the next wide table cannot be
 * built without them.
 */
export function WideTable({
  label,
  children,
}: {
  /** What this table is, for somebody who has just landed in it. */
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}
