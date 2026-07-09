import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Al Hayat Furniture Store",
  description: "Premium Furniture Showroom",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="header-container">
            <Link href="/" className="logo">
              <div className="logo-icon"></div>
              <span>AL HAYAT</span>
            </Link>
            <nav className="main-nav">
              <Link href="/">Showroom</Link>
              <Link href="#">Collections</Link>
              <Link href="#">About</Link>
            </nav>
            <div className="header-actions">
              <button className="cart-btn">
                🛒 Cart (0)
              </button>
            </div>
          </div>
        </header>
        <main className="site-main">
          {children}
        </main>
        <footer className="site-footer">
          <p>© 2026 Al Hayat ERP. All rights reserved.</p>
        </footer>
      </body>
    </html>
  );
}
