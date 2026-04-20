"use client";

import Script from "next/script";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@novaflix/firebase-config";
import { Button, Input } from "@novaflix/ui";
import { useAuth } from "@/lib/auth-context";
import { track } from "@/lib/pixel";

interface MSG91Config {
  widgetId: string;
  tokenAuth: string;
  exposeMethods?: boolean;
  captchaRenderId?: string;
  success?: (data: unknown) => void;
  failure?: (err: unknown) => void;
}

type OtpCallback = (data: { message?: string; type?: string; [k: string]: unknown }) => void;
type OtpErrorCallback = (err: { message?: string; type?: string; [k: string]: unknown }) => void;

declare global {
  interface Window {
    initSendOTP?: (cfg: MSG91Config) => void;
    sendOtp?: (identifier: string, success: OtpCallback, fail: OtpErrorCallback) => void;
    verifyOtp?: (otp: string, success: OtpCallback, fail: OtpErrorCallback) => void;
    retryOtp?: (channel: string, success: OtpCallback, fail: OtpErrorCallback, reqId?: string) => void;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  const [widgetCfg, setWidgetCfg] = useState<{ widgetId: string; tokenAuth: string } | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [widgetReady, setWidgetReady] = useState(false);
  const initDone = useRef(false);

  useEffect(() => {
    if (firebaseUser) {
      setRedirecting(true);
      router.replace("/");
    }
  }, [firebaseUser, router]);

  useEffect(() => {
    fetch("/api/auth/msg91-config")
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (ok && data?.widgetId && data?.tokenAuth) {
          setWidgetCfg(data);
        } else {
          setConfigError(data?.error || "Phone OTP is not configured");
        }
      })
      .catch(() => setConfigError("Could not reach OTP service"));
  }, []);

  useEffect(() => {
    if (initDone.current) return;
    if (!scriptLoaded || !widgetCfg || typeof window === "undefined" || !window.initSendOTP) return;
    initDone.current = true;
    try {
      window.initSendOTP({
        widgetId: widgetCfg.widgetId,
        tokenAuth: widgetCfg.tokenAuth,
        exposeMethods: true,
        captchaRenderId: "msg91-captcha",
        success: () => {},
        failure: () => {},
      });
      setWidgetReady(true);
    } catch (err) {
      console.error("MSG91 initSendOTP failed:", err);
      setError("Phone login could not be initialised. Please try Google sign-in.");
    }
  }, [scriptLoaded, widgetCfg]);

  if (redirecting || firebaseUser) return null;

  async function createUserDoc(
    uid: string,
    data: Record<string, unknown>,
    method: "google" | "phone",
  ): Promise<{ isNew: boolean }> {
    const userRef = doc(db(), "users", uid);
    const existing = await getDoc(userRef);
    if (!existing.exists()) {
      await setDoc(userRef, {
        uid,
        role: "user",
        subscription: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...data,
      });
      // First-time user — fire CompleteRegistration. Re-signins are no-ops.
      track("CompleteRegistration", { registration_method: method, status: true });
      return { isNew: true };
    }
    await setDoc(userRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    return { isNew: false };
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth(), provider);
      const user = result.user;
      await createUserDoc(
        user.uid,
        {
          displayName: user.displayName || "",
          email: user.email || "",
          photoURL: user.photoURL || "",
        },
        "google",
      );
      router.push("/");
    } catch (err) {
      console.error("Google sign-in error:", err);
      setError("Failed to sign in with Google. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSendOtp() {
    if (!widgetReady || !window.sendOtp) {
      setError("Phone OTP is initialising — please wait a moment and try again.");
      return;
    }
    if (!phone || phone.length < 10) {
      setError("Please enter a valid phone number");
      return;
    }
    setLoading(true);
    setError("");
    const msg91Mobile = `${countryCode}${phone}`.replace(/^\+/, "");
    window.sendOtp(
      msg91Mobile,
      () => {
        setOtpSent(true);
        setLoading(false);
      },
      (err) => {
        setError(err?.message || "Failed to send OTP");
        setLoading(false);
      }
    );
  }

  function handleVerifyOtp() {
    if (!window.verifyOtp) {
      setError("Phone OTP is not ready");
      return;
    }
    if (!otp || otp.length < 4) {
      setError("Please enter the OTP");
      return;
    }
    setLoading(true);
    setError("");
    window.verifyOtp(
      otp,
      async (data) => {
        const accessToken =
          (typeof data?.message === "string" && data.message) ||
          (data as { accessToken?: string }).accessToken ||
          (data as Record<string, unknown>)["access-token"];
        if (!accessToken || typeof accessToken !== "string") {
          setError("OTP verification failed");
          setLoading(false);
          return;
        }
        try {
          const fullPhone = `${countryCode}${phone}`;
          const res = await fetch("/api/auth/verify-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: fullPhone, accessToken }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || "Failed to verify OTP");

          const result = await signInWithCustomToken(auth(), body.token);
          await createUserDoc(
            result.user.uid,
            {
              phone: fullPhone,
              displayName: result.user.displayName || fullPhone,
            },
            "phone",
          );
          router.push("/");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to verify OTP");
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setError(err?.message || "Invalid OTP");
        setLoading(false);
      }
    );
  }

  const loginForm = (
    <div className="w-full max-w-md bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-[var(--primary)] mb-1 lg:hidden">
          NovaFlix
        </h1>
        <h2 className="text-xl font-semibold mb-1 hidden lg:block">Welcome Back</h2>
        <p className="text-sm text-[var(--muted)]">Sign in to start streaming</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 mb-6"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continue with Google
      </button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--border)]" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="px-3 bg-[var(--card)] text-[var(--muted)]">
            or sign in with phone
          </span>
        </div>
      </div>

      {!otpSent ? (
        <div className="space-y-4">
          {configError && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-300">
              Phone sign-in is temporarily unavailable. Please use Google sign-in.
            </div>
          )}
          <div className="flex gap-2">
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="w-24 bg-[var(--background)] border border-[var(--border)] text-white rounded-lg px-2 py-3 text-sm"
              disabled={!!configError}
            >
              <option value="+91">+91</option>
              <option value="+1">+1</option>
              <option value="+44">+44</option>
              <option value="+61">+61</option>
              <option value="+971">+971</option>
            </select>
            <Input
              type="tel"
              placeholder="Phone number"
              value={phone}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
              disabled={!!configError}
              className="flex-1 bg-[var(--background)] border-[var(--border)] text-white placeholder:text-[var(--muted)] px-4 py-3 rounded-lg"
            />
          </div>
          <div id="msg91-captcha" className="flex justify-center min-h-0" />
          <Button
            onClick={handleSendOtp}
            disabled={loading || !widgetReady || !!configError}
            className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium py-3 rounded-lg disabled:opacity-50 transition-colors"
          >
            {configError
              ? "Phone sign-in unavailable"
              : loading
                ? "Sending..."
                : widgetReady
                  ? "Send OTP"
                  : "Preparing..."}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--muted)] text-center">
            OTP sent to {countryCode}{phone}
          </p>
          <Input
            type="text"
            placeholder="Enter OTP"
            value={otp}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOtp(e.target.value)}
            maxLength={6}
            className="w-full bg-[var(--background)] border-[var(--border)] text-white placeholder:text-[var(--muted)] px-4 py-3 rounded-lg text-center text-lg tracking-[0.5em]"
          />
          <Button
            onClick={handleVerifyOtp}
            disabled={loading}
            className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium py-3 rounded-lg disabled:opacity-50 transition-colors"
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </Button>
          <button
            onClick={() => {
              setOtpSent(false);
              setOtp("");
              setError("");
            }}
            className="w-full text-sm text-[var(--muted)] hover:text-white transition-colors"
          >
            Change phone number
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <Script
        src="https://verify.msg91.com/otp-provider.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() => setError("Could not load OTP provider")}
      />

      <div className="min-h-screen flex pt-16">
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0a] via-[var(--primary)]/20 to-[#0a0a0a]" />
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-[var(--primary)]/20 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/3 right-1/4 w-48 h-48 bg-[var(--primary)]/10 rounded-full blur-[80px]" />
          <div className="relative z-10 text-center px-12">
            <h1 className="text-5xl font-bold text-[var(--primary)] mb-4">NovaFlix</h1>
            <p className="text-xl text-[var(--foreground)]/80 font-medium mb-2">
              Stream unlimited movies &amp; series
            </p>
            <p className="text-sm text-[var(--muted)] max-w-sm mx-auto">
              Watch thousands of movies, web series, and exclusive content anytime, anywhere.
            </p>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-4">
          {loginForm}
        </div>
      </div>
    </>
  );
}
