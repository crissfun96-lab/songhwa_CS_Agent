import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Fix Apple Blocker B1 — make the app installable + share well on iMessage/WhatsApp
export const metadata: Metadata = {
  title: "Songhwa Korean Cuisine — AI Reservations",
  description:
    "Talk to Songhwa Korean Cuisine (松花韩식) — book a table, ask about the menu, in English · 中文 · Bahasa · 한국어. Open 365 days at Millerz Square, KL.",
  applicationName: "Songhwa",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Songhwa",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", sizes: "180x180" }],
  },
  formatDetection: {
    telephone: false, // we render phone numbers ourselves, no auto-link
  },
  openGraph: {
    title: "Songhwa Korean Cuisine — AI Reservations",
    description:
      "Tap to book a table at Songhwa Korean Cuisine. AI assistant speaks English, 中文, Bahasa, 한국어.",
    type: "website",
    locale: "en_MY",
    siteName: "Songhwa Korean Cuisine",
  },
  twitter: {
    card: "summary_large_image",
    title: "Songhwa Korean Cuisine",
    description: "Book a table by voice — AI assistant speaks 4 languages.",
  },
  robots: { index: true, follow: false }, // discoverable but no link juice to the agent
};

export const viewport: Viewport = {
  themeColor: "#0f3460",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
