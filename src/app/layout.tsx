import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Tooltip } from "radix-ui";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "1688 Scraper",
  description: "Focused dropshipping pipeline for 1688 → Shopify",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Tooltip.Provider delayDuration={200}>{children}</Tooltip.Provider>
        {/* duration=3500: toasts linger long enough to read but don't pile up.
            offset=16: more breathing room from the viewport edge so the toast
            doesn't fight with the page-entry fade. */}
        <Toaster
          richColors
          closeButton
          position="top-right"
          duration={3500}
          offset={16}
        />
      </body>
    </html>
  );
}
