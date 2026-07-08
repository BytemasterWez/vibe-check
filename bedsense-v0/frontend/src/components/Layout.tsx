import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/events", label: "Events" },
  { href: "/experiments", label: "Experiments" },
  { href: "/risk-register", label: "Risk register" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export default function Layout({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Head>
        <title>{`${title} — BedSense V0`}</title>
      </Head>
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight text-sky-300">
            CableLight BedSense V0
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-1.5 transition ${
                  router.pathname === item.href
                    ? "bg-sky-600/30 text-sky-200"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
            Non-clinical research mode
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500">
        Non-clinical research demonstrator for camera-less bed occupancy, movement and
        breathing-like motion detection. Not a medical device. No camera, microphone or cloud.
      </footer>
    </div>
  );
}
