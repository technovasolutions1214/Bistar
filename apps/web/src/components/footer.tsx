"use client";

import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <h3 className="text-xl font-bold text-[var(--primary)] mb-3">NovaFlix</h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed max-w-xs">
              Stream the latest movies, web series, and exclusive content anytime, anywhere on any device.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--foreground)] mb-3">
              Quick Links
            </h4>
            <ul className="space-y-2">
              <li>
                <Link href="/" className="text-sm text-[var(--muted)] hover:text-white transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/browse" className="text-sm text-[var(--muted)] hover:text-white transition-colors">
                  Browse
                </Link>
              </li>
              <li>
                <Link href="/plans" className="text-sm text-[var(--muted)] hover:text-white transition-colors">
                  Plans
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--foreground)] mb-3">
              Legal
            </h4>
            <ul className="space-y-2">
              <li>
                <Link href="/terms" className="text-sm text-[var(--muted)] hover:text-white transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-sm text-[var(--muted)] hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-[var(--muted)] hover:text-white transition-colors">
                  Contact Us
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 pt-6 border-t border-[var(--border)] text-center">
          <p className="text-xs text-[var(--muted)]">
            &copy; 2024 NovaFlix. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
