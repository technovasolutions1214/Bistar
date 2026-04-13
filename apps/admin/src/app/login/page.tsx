"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@novaflix/firebase-config";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@novaflix/ui";

export default function LoginPage() {
  const router = useRouter();
  const { firebaseUser, isAdmin, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!loading && firebaseUser && isAdmin) {
      router.replace("/");
    }
  }, [loading, firebaseUser, isAdmin, router]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth(), provider);
      const userDoc = await getDoc(doc(db(), "users", result.user.uid));

      if (!userDoc.exists() || userDoc.data()?.role !== "admin") {
        await signOut(auth());
        setError("Access denied. This account does not have admin privileges.");
        setSigningIn(false);
        return;
      }

      router.replace("/");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      setError(message);
      setSigningIn(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-[var(--primary)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-xl">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-xl bg-[var(--primary)] flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">NovaFlix Admin</h1>
            <p className="text-[var(--muted)] text-sm mt-1">Sign in to access the dashboard</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20">
              <p className="text-sm text-[var(--danger)]">{error}</p>
            </div>
          )}

          {/* Google Sign In */}
          <Button
            onClick={handleGoogleSignIn}
            loading={signingIn}
            variant="secondary"
            size="lg"
            className="w-full"
          >
            <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </Button>

          <p className="text-center text-xs text-[var(--muted)] mt-6">
            Only authorized admin accounts can access this dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
