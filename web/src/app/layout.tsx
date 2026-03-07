import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { HUDProvider } from "@/components/providers/HUDProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { detectLocaleFromAcceptLanguage } from "@/lib/locale";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JARVIS - AI Assistant",
  description: "Mission Control for Personal AI",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const initialLocale = detectLocaleFromAcceptLanguage(headerList.get("accept-language"));

  return (
    <html lang={initialLocale} className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground`}
      >
        <LocaleProvider initialLocale={initialLocale}>
          <ToastProvider>
            <HUDProvider>
              <AppShell>{children}</AppShell>
            </HUDProvider>
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
