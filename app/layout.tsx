import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { SiteFooter } from "@/app/_components/site-footer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Progsu",
  description: "Progsu member platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
