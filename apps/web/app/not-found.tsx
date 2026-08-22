import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="text-muted">That page does not exist, or it moved.</p>
      <Link href="/">Back to the home page</Link>
    </div>
  );
}
