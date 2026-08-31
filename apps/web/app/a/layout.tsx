/**
 * A boundary, not a design.
 *
 * `/a/<slug>` is the verification page and nothing else, and it needs its own
 * `not-found` and `error` screens: a visitor who clicked a trust mark and lands
 * on "Page not found" learns the wrong thing. Next only treats a segment's
 * `not-found.tsx` as a boundary when the segment has a layout, so this file
 * exists to make that segment one. It renders its children unchanged.
 */
export default function VerificationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
