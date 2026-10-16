import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Plus_Jakarta_Sans, DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import type { JSX } from "react";
import Providers from "../providers/providers";
import { LANGUAGE_COOKIE, languageFrom } from "../lib/language";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "IGCSE Subject Reservation",
    template: "%s | IGCSE Reservation",
  },
  description: "IGCSE Subject Registration & Reservation System — manage exam subjects, approvals, payments, and balances.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<JSX.Element> {
  // The reader's language, from the cookie the language button writes (lib/i18n.tsx): the page is
  // rendered in it on the server, so the browser's first render matches and no hydration warning fires.
  const language = languageFrom((await cookies()).get(LANGUAGE_COOKIE)?.value);
  return (
    <html lang={language} dir={language === "ar" ? "rtl" : "ltr"} data-language={language} suppressHydrationWarning className={`${jakarta.variable} ${dmSans.variable} ${geistMono.variable}`}>
      <body className="font-sans">
        <Providers initialLanguage={language}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
