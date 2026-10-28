import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="font-display text-6xl font-semibold text-gold">404</p>
      <h1 className="mt-3 text-3xl font-semibold text-brand-darker">We could not find that page</h1>
      <p className="mt-2 text-muted">The piece may have sold out or been taken off the website.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/search" className="btn btn-gold">Browse furniture</Link>
        <Link href="/" className="btn btn-outline">Home page</Link>
      </div>
    </div>
  );
}
