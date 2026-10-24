import type { Metadata } from "next";
import { CartPageView } from "@/components/cart/cart-page-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Your cart", robots: { index: false, follow: false } };

export default function CartPage() {
  return (
    <>
      <PageHeader title="Your cart" crumbs={[{ href: "/", label: "Home" }, { label: "Cart" }]} />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <CartPageView />
      </div>
    </>
  );
}
