import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swivels Card Shop Inventory",
  description: "eBay-master inventory and SKU reconciliation for Swivels Card Shop",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/swivels-card-shop-logo.jpg",
    shortcut: "/swivels-card-shop-logo.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
