import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ARTICLES_NOTE, TRAP_ARTICLES, findArticle } from '@vibefycode/trustcheck';

export function generateStaticParams() {
  return TRAP_ARTICLES.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = findArticle(slug);
  return article ? { title: article.title, description: article.summary } : { title: 'Not found' };
}

/**
 * One trap, explained.
 *
 * Three sections in a fixed order, because the order is the argument: how it
 * works, what it looks like from outside, and the thing to actually do. A piece
 * that stops after the first two leaves the reader worried and no better off.
 */
export default async function TrapArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) notFound();

  const sections = [
    { id: 'how', heading: 'How it works', items: article.howItWorks, ordered: true },
    { id: 'signs', heading: 'What to look for before you pay', items: article.signs },
    { id: 'do', heading: 'What to do', items: article.whatToDo },
  ];

  return (
    <article className="space-y-10">
      <header className="space-y-3">
        <p className="eyebrow">
          <Link href="/trust-check">Trust check</Link> · How people get caught
        </p>
        <h1 className="max-w-3xl text-3xl font-bold sm:text-4xl">{article.title}</h1>
        <p className="max-w-2xl text-lg text-muted">{article.summary}</p>
      </header>

      {sections.map((section) => (
        <section key={section.id} aria-labelledby={section.id} className="space-y-4">
          <h2 id={section.id} className="text-xl font-bold">
            {section.heading}
          </h2>
          {section.ordered ? (
            <ol className="space-y-3">
              {section.items.map((item, index) => (
                <li key={item} className="panel flex gap-4">
                  <span className="eyebrow shrink-0" data-numeric>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <p className="text-sm">{item}</p>
                </li>
              ))}
            </ol>
          ) : (
            <ul className="space-y-3">
              {section.items.map((item) => (
                <li key={item} className="panel">
                  <p className="text-sm">{item}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <div className="bar" data-tone="warn">
        <p className="max-w-3xl text-sm">{ARTICLES_NOTE}</p>
      </div>

      <nav aria-label="Other traps" className="space-y-3">
        <h2 className="text-lg font-semibold">Others worth reading</h2>
        <ul className="grid-cards">
          {TRAP_ARTICLES.filter((other) => other.slug !== article.slug).map((other) => (
            <li key={other.slug} className="panel space-y-2">
              <h3 className="font-semibold">
                <Link href={`/trust-check/traps/${other.slug}`}>{other.title}</Link>
              </h3>
              <p className="text-sm text-muted">{other.summary}</p>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  );
}
