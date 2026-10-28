import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return (
    <>
      <PageHeader title="Send your order request" crumbs={[{ href: "/", label: "Home" }, { href: "/cart", label: "Cart" }, { label: "Checkout" }]}>
        <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Steps">
          <li className="text-muted">1. Cart</li>
          <li className="font-semibold text-brand-darker" aria-current="step">2. Your details</li>
          <li className="text-muted">3. We call you</li>
        </ol>
      </PageHeader>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <CheckoutForm />
      </div>
    </>
  );
}
