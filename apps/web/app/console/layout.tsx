import { AlertBanner } from '@/components/alert-banner';

/**
 * The console shell.
 *
 * Its whole job is the banner: an alert that needs action appears on whatever
 * console page the customer opens, rather than waiting in a tab they have no
 * reason to visit. Email carries the same notice and is the record; this is the
 * one that gets read.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Server component: it reads the caller's own alerts under row-level
          security, so this cannot show one workspace's notice to another. */}
      <AlertBanner />
      {children}
    </>
  );
}
