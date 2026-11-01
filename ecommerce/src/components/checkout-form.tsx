"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CartLines, problemText, useCartBlocker } from "./cart/cart-lines";
import { useCart } from "./cart/cart-context";
import { AlertIcon, CartIcon, CheckIcon } from "./icons";
import type { StockProblem } from "@/lib/types";

type Field = "name" | "phone" | "email" | "address" | "city" | "notes";
type Errors = Partial<Record<Field, string>>;

const LIMITS: Record<Field, number> = { name: 100, phone: 30, email: 120, address: 300, city: 100, notes: 500 };

/** Same rules the shop applies, checked here first so customers see them next to the field. */
function validate(v: Record<Field, string>): Errors {
  const e: Errors = {};
  if (v.name.trim().length < 2) e.name = "Please enter your full name.";
  const digits = v.phone.replace(/\D/g, "");
  if (!v.phone.trim()) e.phone = "Please enter a phone number so we can call you.";
  else if (!/^[+\d\s()-]+$/.test(v.phone.trim()) || digits.length < 7 || digits.length > 15) e.phone = "Please enter a valid phone number (7 to 15 digits).";
  if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Please enter a valid email address, or leave it empty.";
  for (const f of Object.keys(LIMITS) as Field[]) {
    if (!e[f] && v[f].length > LIMITS[f]) e[f] = `Please keep this under ${LIMITS[f]} characters.`;
  }
  return e;
}

const fieldClass = (bad: boolean) =>
  `w-full rounded-md border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 ${bad ? "border-sale ring-1 ring-sale" : "border-line hover:border-muted/50"}`;

export function CheckoutForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { items, lines, loading, subtotalText, count, clear, setQuantity, remove, refresh } = useCart();
  const blocker = useCartBlocker();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Items the shop refused on the last attempt. One stays open while the cart
  // still has it in the quantity that was refused; changing or removing it fixes it.
  const [problems, setProblems] = useState<StockProblem[]>([]);
  const openProblems = problems.filter((p) => items.some((i) => i.slug === p.slug && i.quantity >= p.requested));
  const fixed = problems.length > 0 && openProblems.length === 0;
  const alertRef = useRef<HTMLDivElement>(null);
  const [alertTick, setAlertTick] = useState(0);

  // A refused request is shown at the top of the form, scrolled into view, so it cannot be missed.
  useEffect(() => {
    if (!alertTick) return;
    alertRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    alertRef.current?.focus({ preventScroll: true });
  }, [alertTick]);
  const [errors, setErrors] = useState<Errors>({});
  const [sent, setSent] = useState(false); // the cart is cleared before the confirmation page opens

  const values = (): Record<Field, string> => {
    const d = new FormData(form.current!);
    const get = (k: Field) => String(d.get(k) ?? "");
    return { name: get("name"), phone: get("phone"), email: get("email"), address: get("address"), city: get("city"), notes: get("notes") };
  };

  // After a failed submit, re-check a field as soon as the customer leaves it.
  const recheck = (f: Field) => {
    if (!(f in errors)) return;
    const next = validate(values());
    setErrors((prev) => {
      const copy = { ...prev };
      if (next[f]) copy[f] = next[f]; else delete copy[f];
      return copy;
    });
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || blocker || loading || !items.length || openProblems.length) return;
    setError(null);
    setProblems([]);
    const v = values();
    const found = validate(v);
    setErrors(found);
    const first = (Object.keys(LIMITS) as Field[]).find((f) => found[f]);
    if (first) {
      form.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: v.name.trim(),
          phone: v.phone.trim(),
          email: v.email.trim(),
          address: v.address.trim(),
          city: v.city.trim(),
          notes: v.notes.trim(),
          website: new FormData(form.current!).get("website"),
          lines: items,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { requestNumber?: string; message?: string; problems?: StockProblem[] };
      if (res.status === 201 && body.requestNumber) {
        setSent(true);
        clear();
        router.push(`/thank-you?ref=${encodeURIComponent(body.requestNumber)}`);
        return;
      }
      setError(body.message || "Something went wrong. Please try again or call us.");
      if (res.status === 409) {
        setProblems(Array.isArray(body.problems) ? body.problems : []);
        refresh(); // show what is available now on every line
      }
    } catch {
      setError("We could not reach the shop. Check your connection and try again.");
    }
    setAlertTick((n) => n + 1);
    setSubmitting(false);
  }

  if (sent) {
    return <p role="status" className="py-16 text-center text-lg font-medium text-brand-darker">Request sent. Opening your confirmation…</p>;
  }

  if (!items.length) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-light text-brand-darker"><CartIcon className="h-8 w-8" /></span>
        <h2 className="mt-4 text-2xl font-semibold">Your cart is empty</h2>
        <p className="mt-2 text-muted">Add the pieces you like first, then send us your request.</p>
        <Link href="/search" className="btn btn-gold mt-6">Browse furniture</Link>
      </div>
    );
  }

  const input = (f: Field, label: string, props: Record<string, unknown> = {}, optional = false) => (
    <div>
      <label htmlFor={f} className="mb-1.5 block text-sm font-medium">
        {label} {optional ? <span className="font-normal text-muted">(optional)</span> : <span className="text-sale" aria-hidden="true">*</span>}
      </label>
      <input
        id={f}
        name={f}
        maxLength={LIMITS[f]}
        aria-invalid={!!errors[f]}
        aria-describedby={errors[f] ? `${f}-error` : undefined}
        aria-required={!optional}
        onBlur={() => recheck(f)}
        className={fieldClass(!!errors[f])}
        {...props}
      />
      {errors[f] && <p id={`${f}-error`} className="mt-1.5 text-xs font-medium text-sale">{errors[f]}</p>}
    </div>
  );

  const errorCount = Object.keys(errors).length;

  return (
    <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
      <form ref={form} onSubmit={onSubmit} className="space-y-8 lg:col-span-3" noValidate aria-describedby="form-note">
        {fixed && (
          <div role="status" className="flex items-start gap-3 rounded-lg border-2 border-brand/40 bg-brand-light p-4 text-brand-darker">
            <CheckIcon className="h-6 w-6 flex-none" />
            <p className="text-sm"><span className="font-semibold">Cart updated.</span> You can send your request now.</p>
          </div>
        )}
        {!fixed && error && (
          <div ref={alertRef} tabIndex={-1} role="alert" className="rounded-lg border-2 border-sale bg-sale/5 p-4 shadow-sm focus:outline-none sm:p-5">
            <div className="flex gap-3">
              <AlertIcon className="mt-0.5 h-6 w-6 flex-none text-sale" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-sale">
                  {openProblems.length === 0
                    ? "Your request was not sent"
                    : openProblems.length === 1
                      ? "An item in your cart is not available"
                      : `${openProblems.length} items in your cart are not available`}
                </p>
                <p className="mt-1 text-sm text-ink">
                  {openProblems.length ? "Your request was not sent yet. Change or remove the item below, then send it again." : error}
                </p>
                {openProblems.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {openProblems.map((p) => (
                      <li key={p.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3 ring-1 ring-line">
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{p.name ?? "An item no longer sold"}</p>
                          <p className="text-sm font-medium text-sale">{problemText(p)}</p>
                          {p.available == null && <p className="text-xs text-muted">Try a smaller quantity, or call us to check.</p>}
                        </div>
                        <div className="flex flex-none gap-2">
                          {p.available != null && p.available > 0 && (
                            <button type="button" onClick={() => setQuantity(p.slug, p.available as number)} className="btn btn-gold px-4 py-2 text-sm">
                              Change to {p.available}
                            </button>
                          )}
                          <button type="button" onClick={() => remove(p.slug)} className="btn btn-outline px-4 py-2 text-sm">
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
        {errorCount > 0 && (
          <p role="alert" className="rounded-md border border-sale/30 bg-sale/5 p-3 text-sm text-sale">
            Please check {errorCount === 1 ? "the highlighted field" : `the ${errorCount} highlighted fields`}.
          </p>
        )}

        <fieldset className="space-y-4">
          <legend className="mb-1 font-display text-xl font-semibold text-brand-darker">1. Your details</legend>
          {input("name", "Full name", { autoComplete: "name" })}
          <div className="grid gap-4 sm:grid-cols-2">
            {input("phone", "Phone number", { type: "tel", autoComplete: "tel", inputMode: "tel", placeholder: "+251 9…" })}
            {input("email", "Email", { type: "email", autoComplete: "email" }, true)}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 font-display text-xl font-semibold text-brand-darker">2. Delivery</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">{input("address", "Delivery address", { autoComplete: "street-address" }, true)}</div>
            {input("city", "City", { autoComplete: "address-level2" }, true)}
          </div>
          <div>
            <label htmlFor="notes" className="mb-1.5 block text-sm font-medium">Notes <span className="font-normal text-muted">(optional)</span></label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={LIMITS.notes}
              placeholder="Best time to call, floor, access, colour questions…"
              aria-invalid={!!errors.notes}
              aria-describedby={errors.notes ? "notes-error" : undefined}
              onBlur={() => recheck("notes")}
              className={fieldClass(!!errors.notes)}
            />
            {errors.notes && <p id="notes-error" className="mt-1.5 text-xs font-medium text-sale">{errors.notes}</p>}
          </div>
        </fieldset>

        {/* Honeypot: invisible to people; bots fill it and the shop quietly drops the request. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        {blocker && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{blocker}</p>}
        {openProblems.length > 0 && (
          <p className="flex items-center gap-2 text-sm font-medium text-sale">
            <AlertIcon className="h-4 w-4 flex-none" /> Fix the {openProblems.length === 1 ? "item" : "items"} marked at the top of this form to send your request.
          </p>
        )}

        <div>
          <button type="submit" disabled={submitting || !!blocker || loading || openProblems.length > 0} className="btn btn-gold w-full py-4 text-base">
            {submitting ? "Sending your request…" : "Send order request"}
          </button>
          <p id="form-note" className="mt-3 text-center text-xs text-muted">No payment is taken. We call you to confirm availability, delivery and payment.</p>
        </div>
      </form>

      <aside className="lg:col-span-2" aria-labelledby="summary-title">
        <div className="rounded-lg border border-line bg-cream p-5 lg:sticky lg:top-40">
          <div className="flex items-center justify-between">
            <h2 id="summary-title" className="text-lg font-semibold">Your order</h2>
            <Link href="/cart" className="text-sm font-medium text-brand-dark hover:underline">Edit cart</Link>
          </div>
          <p className="text-sm text-muted">{count} item{count === 1 ? "" : "s"}</p>
          <div className="mt-2 max-h-[420px] overflow-y-auto"><CartLines compact problems={openProblems} /></div>
          <dl className="mt-2 space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="font-semibold">{subtotalText}</dd></div>
            <div className="flex justify-between text-muted"><dt>Delivery</dt><dd>Agreed by phone</dd></div>
            <div className="flex justify-between border-t border-line pt-3 text-base"><dt className="font-semibold">Estimated total</dt><dd className="font-semibold text-brand-darker">{subtotalText}</dd></div>
          </dl>
          {lines.length > 0 && <p className="mt-3 text-xs text-muted">Final prices are confirmed by the shop when we call.</p>}
        </div>
      </aside>
    </div>
  );
}
