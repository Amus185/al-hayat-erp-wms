"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CloseIcon, MenuIcon } from "./icons";
import { useIsCurrent } from "./nav-links";
import { CONTACT_PHONE, PHONE_HREF } from "@/lib/site";

export interface MenuLink {
  href: string;
  label: string;
  tone?: "sale";
}

// Menu for small screens: a button that opens a side panel with the shop and
// help links. Escape or the backdrop closes it; focus returns to the button.
export function MobileMenu({ shop, help }: { shop: MenuLink[]; help: MenuLink[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const isCurrent = useIsCurrent();

  useEffect(() => {
    if (!open) return;
    const trigger = button.current;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      trigger?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);
  const item = (l: MenuLink) => (
    <li key={l.href}>
      <Link
        href={l.href}
        onClick={close}
        aria-current={isCurrent(l.href) ? "page" : undefined}
        className={`block rounded-md px-3 py-3 ${l.tone === "sale" ? "text-sale" : ""} ${isCurrent(l.href) ? "bg-brand-light font-semibold text-brand-darker" : "hover:bg-canvas"}`}
      >
        {l.label}
      </Link>
    </li>
  );

  return (
    <div className="lg:hidden">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label="Open menu"
        className="flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10"
      >
        <MenuIcon className="h-6 w-6" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
          <div
            id="mobile-menu"
            ref={panel}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col overflow-y-auto bg-white shadow-xl outline-none"
          >
            <div className="flex items-center justify-between bg-brand-darker px-4 py-3 text-white">
              <span className="font-display text-lg font-semibold">Menu</span>
              <button type="button" onClick={close} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10">
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>
            <nav aria-label="Shop" className="px-3 py-4">
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-widest text-muted">Shop</p>
              <ul className="text-[15px]">{shop.map(item)}</ul>
              <p className="mt-4 border-t border-line px-3 pb-2 pt-5 text-xs font-semibold uppercase tracking-widest text-muted">Help</p>
              <ul className="text-[15px]">
                {item({ href: "/saved", label: "Saved items" })}
                {help.map(item)}
              </ul>
            </nav>
            {PHONE_HREF && (
              <a href={PHONE_HREF} className="btn btn-gold mx-6 mb-6 mt-auto">Call {CONTACT_PHONE}</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
