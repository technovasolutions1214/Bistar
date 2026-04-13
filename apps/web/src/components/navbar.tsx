"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useState } from "react";

export function Navbar() {
  const { firebaseUser, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--background)]/90 backdrop-blur-md border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-2xl font-bold text-[var(--primary)]">
              NovaFlix
            </Link>
            <div className="hidden md:flex items-center gap-6">
              <Link href="/" className="text-sm text-[var(--muted)] hover:text-white transition-colors">
                Home
              </Link>
              <Link href="/browse" className="text-sm text-[var(--muted)] hover:text-white transition-colors">
                Browse
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/browse" className="text-[var(--muted)] hover:text-white transition-colors">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </Link>

            {!loading && (
              <>
                {firebaseUser ? (
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(!menuOpen)}
                      className="flex items-center gap-2 text-sm"
                    >
                      <div className="h-8 w-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-white font-medium">
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
                    className="px-4 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
                  >
                    Sign In
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
