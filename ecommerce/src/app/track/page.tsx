import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { TrackForm } from "@/components/track-form";

export const metadata: Metadata = { title: "Track your order", robots: { index: false, follow: false } };

type SearchParams = Promise<{ ref?: string }>;

export default async function TrackPage({ searchParams }: { searchParams: SearchParams }) {
  const { ref } = await searchParams;
  const reference = ref && /^WR-[0-9A-Z-]{1,24}$/i.test(ref) ? ref.toUpperCase() : "";
  return (
    <>
      <PageHeader title="Track your order" crumbs={[{ href: "/", label: "Home" }, { label: "Track your order" }]}>
        <p className="mt-2 max-w-2xl text-muted">Enter the order number from your confirmation and the phone number you ordered with.</p>
      </PageHeader>
      <div className="mx-auto max-w-2xl px-4 py-12">
        <TrackForm initialReference={reference} />
      </div>
    </>
  );
}
