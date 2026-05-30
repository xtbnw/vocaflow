import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppFrame } from "@/frontend/components/AppFrame";
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
  title: "VocaFlow - Voice Calendar Agent",
  description: "AI-powered voice calendar management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
