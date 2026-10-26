import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari, Poppins } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Display face for the wordmark and page titles: geometric like the SAMANVAY lettering in the logo.
const poppins = Poppins({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-poppins", display: "swap" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "600", "700"], variable: "--font-deva", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Samanvay · AICTE", template: "%s · Samanvay" },
  description: "AICTE complaint monitoring and coordination. One ledger, explainable overlap detection, coordinated action.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b2449" },
    { media: "(prefers-color-scheme: dark)", color: "#061631" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable} ${deva.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
