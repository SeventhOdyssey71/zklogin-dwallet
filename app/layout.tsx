import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

/**
 * Prose face.
 *
 * The whole app was set in JetBrains Mono, including every paragraph, because `--font-sans` was aliased
 * to the mono variable. Monospace is the right choice for the things it was chosen for — addresses,
 * balances, hashes, labels, the wordmark — because character alignment is what makes those legible and
 * comparable. It is the wrong choice for sentences: uniform advance widths remove the word shapes people
 * actually read by, which is why a paragraph of it feels like work.
 *
 * So the two faces now do their own jobs. Mono keeps everything technical and every heading (the brand
 * lives there); Inter carries explanation. Nothing about the look changes except that the prose becomes
 * readable at a glance.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Lowercase everywhere: "ycos" is the mark, not a capitalised word.
  title: {
    default: "ycos — your chain on sui",
    template: "%s · ycos",
  },
  description:
    "One Google login, 13 chains, no seed phrase. ycos splits every key across the Ika validator " +
    "network with 2PC-MPC, so no single party can sign for you. Coordinated on Sui.",
  applicationName: "ycos",
  keywords: ["ycos", "sui", "zklogin", "multi-chain wallet", "MPC wallet", "ika", "2PC-MPC"],
  // No `icons` field: app/icon.tsx generates the favicon, and declaring both would compete.
  openGraph: {
    title: "ycos — your chain on sui",
    description:
      "One Google login, 13 chains, no seed phrase. Keys split across a validator network so no single party can sign for you.",
    siteName: "ycos",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ycos — your chain on sui",
    description: "One Google login, 13 chains, no seed phrase.",
  },
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
      <body className={`${jetbrainsMono.variable} ${inter.variable} antialiased`}>
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
