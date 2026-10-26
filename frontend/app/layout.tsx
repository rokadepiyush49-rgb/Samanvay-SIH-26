import type { Metadata } from "next";
import { Noto_Sans_Devanagari, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "600"], variable: "--font-deva", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Samanvay", template: "%s · Samanvay" },
  description: "Integrated institution complaint monitoring and coordination dashboard for AICTE bureaus and cells.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${deva.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
