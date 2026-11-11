import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Gamepad2 } from "lucide-react";
import { AuthProvider, HeaderAuth } from "@/components/auth-modal";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const navLinks = [
  { href: "/", label: "Feed" },
  { href: "/studio", label: "AI Studio" },
  { href: "/earnings", label: "Earnings" },
] as const;

export const metadata: Metadata = {
  metadataBase: new URL("https://forgevyn.com"),
  applicationName: "ForgeVyn",
  title: {
    default: "ForgeVyn — Play. Build. Earn.",
    template: "%s · ForgeVyn",
  },
  description:
    "Discover community-made browser games, build your own with AI Studio, and earn from every play on ForgeVyn.",
  openGraph: {
    type: "website",
    siteName: "ForgeVyn",
    title: "ForgeVyn — Play. Build. Earn.",
    description:
      "Discover community-made browser games, build your own with AI Studio, and earn from every play on ForgeVyn.",
  },
};

export const viewport: Viewport = {
  themeColor: "#060913",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-slate-100 selection:bg-accent/30 selection:text-white">
        <AuthProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#04120a]"
          >
            Skip to content
          </a>

          <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
            <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
              <Link
                href="/"
                aria-label="ForgeVyn home"
                className="group flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent shadow-[0_0_24px_-6px_rgba(34,197,94,0.7)] transition-colors group-hover:border-accent/60 group-hover:bg-accent/15">
                  <Gamepad2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="hidden text-lg font-semibold tracking-tight text-white sm:inline">
                  Forge<span className="text-accent">Vyn</span>
                </span>
              </Link>

              <div className="flex items-center gap-1 sm:gap-3">
                <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="rounded-lg px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:px-3 sm:text-sm"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>

                <HeaderAuth />
              </div>
            </div>
          </header>

          <main id="main-content" className="flex flex-1 flex-col">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
