import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";

export const metadata: Metadata = { title: "Send order request", robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-4">
      <h1 className="mb-6 text-3xl font-bold">Send your order request</h1>
      <CheckoutForm />
    </div>
  );
}
