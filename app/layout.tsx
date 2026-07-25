import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "dWallet — zkLogin multi-chain wallets on Sui",
  description:
    "Sign in with Google (zkLogin) and hold Bitcoin, Ethereum, Solana and 11 more chains from one " +
    "account. Keys are split across the Ika network with 2PC-MPC — no single party ever holds one.",
  applicationName: "dWallet",
  icons: {
    // Inline SVG favicon: no extra request, and it scales cleanly in a tab at any density.
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
              '<rect width="32" height="32" rx="7" fill="#000"/>' +
              '<text x="16" y="22" font-family="ui-monospace,monospace" font-size="17" ' +
              'font-weight="800" fill="#fff" text-anchor="middle">d</text>' +
              "</svg>"
          ),
      },
    ],
  },
  openGraph: {
    title: "dWallet — zkLogin multi-chain wallets on Sui",
    description:
      "One account, 14 chains. Keys split across the Ika network with 2PC-MPC v4.",
    siteName: "dWallet",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "dWallet" },
  robots: { index: true, follow: true },
};

/**
 * The dotted-grid dark theme is the only theme.
 *
 * Declaring it avoids a white flash before CSS loads and gives mobile Safari the right status-bar
 * colour. Next.js requires these in `viewport` rather than `metadata`, and warns at build time if they
 * are misplaced.
 */
export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jetbrainsMono.variable} antialiased`}>
        <Providers>
          {children}
          <Toaster
            position="bottom-right"
            theme="dark"
            toastOptions={{
              style: {
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontFamily: "var(--font-jetbrains-mono)",
                fontSize: "13px",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
