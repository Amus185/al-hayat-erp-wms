import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SavedItemsView } from "@/components/saved/saved-items-view";

export const metadata: Metadata = { title: "Saved items", robots: { index: false, follow: false } };

export default function SavedPage() {
  return (
    <>
      <PageHeader title="Saved items" crumbs={[{ href: "/", label: "Home" }, { label: "Saved items" }]}>
        <p className="mt-2 text-sm text-muted">Saved on this device only. No account needed.</p>
      </PageHeader>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <SavedItemsView />
      </div>
    </>
  );
}
