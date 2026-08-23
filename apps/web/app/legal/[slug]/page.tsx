import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { marked } from 'marked';
import { getLegalDocument, listLegalDocuments } from '@/lib/legal';

export function generateStaticParams() {
  return listLegalDocuments().map((document) => ({ slug: document.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const document = getLegalDocument(slug);
  return { title: document ? `${document.title} (draft)` : 'Legal' };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const document = getLegalDocument(slug);
  if (!document) notFound();

  // The markdown is our own versioned content, not user input, and the hash
  // below lets any reader confirm they are looking at the same bytes their
  // consent record points at.
  const html = await marked.parse(document.markdown);

  return (
    <article className="space-y-6">
      <p className="text-sm text-muted">
        Version {document.version} · {document.status} · sha256{' '}
        <code>{document.sha256.slice(0, 16)}…</code>
      </p>
      <div
        className="prose-vibefycode space-y-4 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-line-strong [&_blockquote]:pl-4 [&_blockquote]:text-muted [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_table]:block [&_table]:overflow-x-auto [&_table]:text-sm [&_td]:border-b [&_td]:border-line [&_td]:p-2 [&_th]:border-b [&_th]:border-line-strong [&_th]:p-2 [&_th]:text-left"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
