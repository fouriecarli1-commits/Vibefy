import type { Metadata } from 'next';
import Link from 'next/link';
import { listLegalDocuments } from '@/lib/legal';

export const metadata: Metadata = { title: 'Legal' };

export default function LegalIndexPage() {
  const documents = listLegalDocuments();

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Legal</h1>
        <p
          role="note"
          className="max-w-3xl rounded-xl border border-line bg-surface-muted p-4 text-sm"
        >
          <strong>Every document here is a draft.</strong> Drafts are not legal advice and are not a
          substitute for a qualified lawyer. They are published now so that what we intend to be
          bound by is visible while it is still being reviewed.
        </p>
      </header>

      <ul className="divide-y divide-line">
        {documents.map((document) => (
          <li key={document.slug} className="py-4">
            <Link href={`/legal/${document.slug}`} className="font-medium">
              {document.title}
            </Link>
            <p className="mt-1 text-sm text-muted">
              v{document.version} · {document.status}
              {document.requiresConsent ? ' · acceptance recorded' : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
