import type { Metadata, Viewport } from "next";
import { Inter, Jost } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";
import { CartProvider } from "@/components/cart/cart-context";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Self-hosted by next/font at build time: the browser never contacts Google.
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const heading = Jost({ subsets: ["latin"], variable: "--font-heading", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: `${SITE_NAME}: furniture showroom. Browse our collection and send an order request.`,
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#054405" };

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Render every page per request: the Content-Security-Policy nonce (src/proxy.ts) only exists at request time.
  await connection();
  return (
    <html lang="en" className={`${body.variable} ${heading.variable}`}>
      <body className="flex min-h-screen flex-col bg-white font-sans text-ink selection:bg-gold-light">
        <CartProvider>
          <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
            Skip to content
          </a>
          <Navbar />
          <main id="content" className="flex-1 pb-16 has-[[data-flush-footer]]:pb-0">{children}</main>
          <Footer />
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
