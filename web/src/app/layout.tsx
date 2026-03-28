import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { detectLocaleFromAcceptLanguage } from "@/lib/locale";

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
      <body className="antialiased min-h-screen bg-background text-foreground">
        <LocaleProvider initialLocale={initialLocale}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
