import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({ variable: "--font-display", subsets: ["latin"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", weight: ["400","500","600"], subsets: ["latin","cyrillic"] });

export const metadata: Metadata = {
  title: "Formula Beat — Code into rhythm",
  description: "A reactive browser rhythm game powered by bytebeat formulas.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Formula Beat",
    description: "Turn code into rhythm.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Formula Beat — Turn code into rhythm" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className={`${display.variable} ${mono.variable}`}>{children}</body></html>;
}
