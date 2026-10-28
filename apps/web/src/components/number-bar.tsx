"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@bistar/ui";
import { useAuth } from "@/lib/auth-context";
import { normalizePhone, isCompletePhone, splitE164, formatPhone } from "@/lib/phone";

const COUNTRY_CODES = ["+91", "+1", "+44", "+61", "+971"];

interface NumberBarProps {
  /** The guest's number (E.164), or null while we don't have one. */
  guestPhone: string | null;
  /** A guest saved a new number here. */
  onGuestPhone: (phone: string) => void;
  /** Whether the guest's number is open for editing. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /**
   * What is in the form right now, as a complete E.164 number (null if it
   * isn't one), so picking a plan without pressing Save doesn't ask again.
   */
  onDraft: (phone: string | null) => void;
}

/**
 * The top of the plans page: which number (or account) the plan will go on.
 *
 * Always in view — it sticks under the navbar while the plans scroll — so the
 * buyer can see, and fix, the number before they pay against it. A guest can
 * change it until they've paid; a guest who has paid is signed in with it on
 * this device. A signed-in account shows itself, with a way out for a shared
 * device.
 */
export function NumberBar({
  guestPhone,
  onGuestPhone,
  editing,
  onEditingChange,
  onDraft,
}: NumberBarProps) {
  const { firebaseUser, userData, hasActiveSubscription, signOut } = useAuth();
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const guest = !firebaseUser || firebaseUser.isAnonymous;
  const paidGuest = guest && hasActiveSubscription;
  const showForm = guest && !paidGuest && (editing || !guestPhone);

  // Open the form on the current number.
  useEffect(() => {
    if (!showForm) return;
    setError("");
    if (guestPhone) {
      const { countryCode: cc, national } = splitE164(guestPhone);
      setCountryCode(cc);
      setPhone(national);
    }
  }, [showForm, guestPhone]);

  useEffect(() => {
    const fullPhone = normalizePhone(countryCode, phone);
    onDraft(showForm && isCompletePhone(countryCode, fullPhone) ? fullPhone : null);
  }, [showForm, countryCode, phone, onDraft]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    // Must match what /auth/login sends to verify-otp — reconcile compares
    // these two strings for exact equality to release the purchase.
    const fullPhone = normalizePhone(countryCode, phone);
    if (!isCompletePhone(countryCode, fullPhone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    setError("");
    onGuestPhone(fullPhone);
    onEditingChange(false);
  }

  const signIn = (
    <Link
      href="/auth/login"
      className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
    >
      Already subscribed?{" "}
      <span className="text-[var(--foreground)] font-medium underline underline-offset-2">Sign in</span>
    </Link>
  );

  let body: React.ReactNode;
  if (!guest) {
    const accountPhone = firebaseUser?.phoneNumber || userData?.phone || "";
    const who = accountPhone ? formatPhone(accountPhone) : firebaseUser?.email || userData?.email || "";
    body = (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)] min-w-0 truncate">
          Signed in as <span className="font-semibold text-[var(--foreground)]">{who || "your account"}</span>
        </p>
        <button
          onClick={() => signOut()}
          className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] underline underline-offset-2 shrink-0"
        >
          Not you? Sign out
        </button>
      </div>
    );
  } else if (paidGuest) {
    body = (
      <div>
        <p className="text-sm text-[var(--muted)]">
          {guestPhone ? (
            <>
              Signed in as{" "}
              <span className="font-semibold text-[var(--foreground)]">{formatPhone(guestPhone)}</span>
            </>
          ) : (
            "Signed in on this device"
          )}
        </p>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          On another phone or browser, sign in there with this number.{" "}
          <Link
            href="/auth/login"
            className="text-[var(--foreground)] font-medium underline underline-offset-2"
          >
            Sign in here too
          </Link>{" "}
          to keep it if this browser is cleared.
        </p>
      </div>
    );
  } else if (showForm) {
    body = (
      <form onSubmit={save} className="space-y-2">
        <p className="text-sm font-medium text-[var(--foreground)]">Your mobile number</p>
        <div className="flex gap-2">
          <select
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            aria-label="Country code"
            className="w-24 bg-[var(--background)] border border-[var(--border)] text-white rounded-lg px-2 py-2.5 text-sm"
          >
            {COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="flex-1">
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="Phone number"
              value={phone}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
              className="bg-[var(--background)] border-[var(--border)] text-white placeholder:text-[var(--muted)] px-3 py-2.5 rounded-lg"
            />
          </div>
          <button type="submit" className="btn-gold px-4 rounded-lg text-sm font-semibold shrink-0">
            Save
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          {signIn}
          {guestPhone && (
            <button
              type="button"
              onClick={() => onEditingChange(false)}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] underline underline-offset-2"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    );
  } else {
    body = (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Subscription for</p>
          <div className="flex items-baseline gap-3">
            <p className="text-lg font-semibold text-[var(--foreground)] truncate">
              {formatPhone(guestPhone!)}
            </p>
            <button
              onClick={() => onEditingChange(true)}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] underline underline-offset-2 shrink-0"
            >
              Change
            </button>
          </div>
        </div>
        <div className="shrink-0">{signIn}</div>
      </div>
    );
  }

  return (
    <div className="sticky top-16 z-30 -mx-4 sm:mx-auto mb-8 max-w-xl px-4 py-3 bg-[var(--background)]/95 backdrop-blur border-b sm:border sm:rounded-xl border-[var(--border)]">
      {body}
    </div>
  );
}
