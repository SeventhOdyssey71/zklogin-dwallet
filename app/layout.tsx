import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Navigation } from "@/components/layout/Navigation";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { CustomCursor } from "@/components/layout/CustomCursor";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "dWallet - Multi-Chain Wallet Control",
  description: "Create and manage dWallets across multiple blockchains with zero-trust MPC technology",
  keywords: ['dWallet', 'blockchain', 'multi-chain', 'MPC', 'crypto wallet'],
  openGraph: {
    title: 'dWallet - Multi-Chain Wallet Control',
    description: 'Create and manage dWallets across multiple blockchains with zero-trust MPC technology',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <CustomCursor />
          <Navigation />
          <ThemeToggle />
          {children}
        </Providers>
      </body>
    </html>
  );
}
