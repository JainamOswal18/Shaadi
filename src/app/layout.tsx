import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Tiro_Devanagari_Hindi } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { MswProvider } from "@/components/MswProvider";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const tiro = Tiro_Devanagari_Hindi({
  variable: "--font-tiro",
  subsets: ["devanagari", "latin"],
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Shaadi — Relive the wedding, one photo at a time",
  description:
    "Snap a selfie and find every photo you're in from the celebration. A warm, private way to keep the wedding memories.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FBF6EC",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${hanken.variable} ${tiro.variable} antialiased`}
      >
        <MswProvider>{children}</MswProvider>
        <Toaster />
      </body>
    </html>
  );
}
