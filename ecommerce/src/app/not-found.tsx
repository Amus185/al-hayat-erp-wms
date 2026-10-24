import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold">We could not find that page</h1>
      <p className="mt-2 text-neutral-600">The product may have been removed or sold out of the catalog.</p>
      <Link href="/search" className="mt-6 inline-block rounded-md bg-brand px-5 py-2.5 text-sm font-bold uppercase text-white hover:bg-brand-dark">Browse furniture</Link>
    </div>
  );
}
