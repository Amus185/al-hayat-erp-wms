import Link from "next/link";
import type { ReactNode } from "react";

export interface Crumb {
  href?: string;
  label: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className="text-line">/</span>}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="hover:text-brand-dark">{c.label}</Link>
            ) : (
              <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className="text-ink">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Page title band used by the inner pages. */
export function PageHeader({ title, crumbs, children }: { title: string; crumbs: Crumb[]; children?: ReactNode }) {
  return (
    <div className="border-b border-line bg-cream">
      <div className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <Breadcrumbs crumbs={crumbs} />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-brand-darker md:text-4xl">{title}</h1>
        {children}
      </div>
    </div>
  );
}
