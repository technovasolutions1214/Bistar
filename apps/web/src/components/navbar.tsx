"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useState, useEffect, useRef } from "react";

export function Navbar() {
  const { firebaseUser, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close desktop dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/" className="text-2xl font-extrabold tracking-tight text-gold">
                Bistar
              </Link>
              <div className="hidden md:flex items-center gap-6">
                <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                  Home
                </Link>
                <Link href="/browse" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                  Browse
                </Link>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Link href="/browse" className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </Link>

              {!loading && (
                <>
                  {firebaseUser ? (
                    <div ref={dropdownRef} className="relative hidden md:block">
                      <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        className="flex items-center gap-2 text-sm"
                      >
                        <div className="h-8 w-8 rounded-full btn-gold flex items-center justify-center font-semibold">
                          {firebaseUser.displayName?.[0] || firebaseUser.email?.[0] || "U"}
                        </div>
                      </button>
                      {menuOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl py-1">
                          <Link
                            href="/account"
                            className="block px-4 py-2 text-sm hover:bg-[var(--card-hover)] transition-colors"
                            onClick={() => setMenuOpen(false)}
                          >
                            Account
                          </Link>
                          <Link
                            href="/plans"
                            className="block px-4 py-2 text-sm hover:bg-[var(--card-hover)] transition-colors"
                            onClick={() => setMenuOpen(false)}
                          >
                            Subscription
                          </Link>
                          <button
                            onClick={() => { signOut(); setMenuOpen(false); }}
                            className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-[var(--card-hover)] transition-colors"
                          >
                            Sign Out
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Link
                      href="/auth/login"
                      className="btn-gold hidden md:inline-flex px-5 py-2 text-sm font-semibold rounded-lg"
                    >
                      Sign In
                    </Link>
                  )}
                </>
              )}

              {/* Hamburger button - mobile only */}
              <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden flex items-center justify-center w-10 h-10 text-[var(--foreground)]"
                aria-label="Open menu"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Slide-in Drawer */}
      <div
        className={`fixed top-0 right-0 bottom-0 z-50 w-72 bg-[var(--background)] border-l border-[var(--border)] transform transition-transform duration-300 ease-in-out md:hidden ${
          mobileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <span className="text-lg font-extrabold tracking-tight text-gold">Bistar</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="w-10 h-10 flex items-center justify-center text-[var(--muted)] hover:text-white"
            aria-label="Close menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-col p-4 gap-1">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="px-4 py-3 text-sm font-medium rounded-lg hover:bg-[var(--card)] transition-colors"
          >
            Home
          </Link>
          <Link
            href="/browse"
            onClick={() => setMobileOpen(false)}
            className="px-4 py-3 text-sm font-medium rounded-lg hover:bg-[var(--card)] transition-colors"
          >
            Browse
          </Link>
          <Link
            href="/account"
            onClick={() => setMobileOpen(false)}
            className="px-4 py-3 text-sm font-medium rounded-lg hover:bg-[var(--card)] transition-colors"
          >
            Account
          </Link>
          <Link
            href="/plans"
            onClick={() => setMobileOpen(false)}
            className="px-4 py-3 text-sm font-medium rounded-lg hover:bg-[var(--card)] transition-colors"
          >
            Plans
          </Link>

          <div className="my-2 border-t border-[var(--border)]" />

          {!loading && (
            <>
              {firebaseUser ? (
                <button
                  onClick={() => { signOut(); setMobileOpen(false); }}
                  className="px-4 py-3 text-sm font-medium text-red-400 rounded-lg hover:bg-[var(--card)] transition-colors text-left"
                >
                  Sign Out
                </button>
              ) : (
                <Link
                  href="/auth/login"
                  onClick={() => setMobileOpen(false)}
                  className="px-4 py-3 text-sm font-medium text-[var(--primary)] rounded-lg hover:bg-[var(--card)] transition-colors"
                >
                  Sign In
                </Link>
              )}
            </>
          )}
        </nav>
      </div>
    </>
  );
}
