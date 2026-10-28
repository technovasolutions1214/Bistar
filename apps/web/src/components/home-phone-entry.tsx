"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@bistar/ui";
import { useAuth } from "@/lib/auth-context";
import { normalizePhone, isCompletePhone, splitE164 } from "@/lib/phone";
import { guestCheckoutFor, rememberGuestPhone } from "@/lib/guest-checkout";

const COUNTRY_CODES = ["+91", "+1", "+44", "+61", "+971"];

/**
 * Homepage entry: the visitor's phone number, then the plans.
 *
 * The number is the one thing a guest is asked for. The plans page shows it
 * at the top, the payment window uses it as its header and pays against it,
 * and the purchase is recorded against it — so typing it here is the whole of
 * "signing up". Nothing is created yet: the anonymous session that pays is
 * only made when a plan is picked, so a visitor who just looks costs nothing.
 */
export function HomePhoneEntry() {
  const { firebaseUser } = useAuth();
  const router = useRouter();
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  // Prefill the number this visitor already gave us (in an effect, so the
  // server render and hydration agree on an empty box).
  useEffect(() => {
    const remembered = guestCheckoutFor(firebaseUser);
    if (!remembered) return;
    const { countryCode: cc, national } = splitE164(remembered.phone);
    setCountryCode(cc);
    setPhone(national);
  }, [firebaseUser]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Must match what /auth/login sends to verify-otp — reconcile compares
    // these two strings for exact equality to release the purchase.
    const fullPhone = normalizePhone(countryCode, phone);
    if (!isCompletePhone(countryCode, fullPhone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    setError("");
    rememberGuestPhone(fullPhone, firebaseUser?.isAnonymous ? firebaseUser.uid : undefined);
    router.push("/plans");
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md text-left">
      <div className="bg-[#0a0807]/30 rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <p className="text-sm font-semibold text-[var(--foreground)]">Enter your mobile number</p>
          <p className="text-xs text-[var(--muted)]">Your subscription goes on this number.</p>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              aria-label="Country code"
              className="w-24 bg-[var(--background)] border border-[var(--border)] text-white rounded-lg px-2 py-3 text-sm"
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="Phone number"
              value={phone}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
              className="flex-1 bg-[var(--background)] border-[var(--border)] text-white placeholder:text-[var(--muted)] px-4 py-3 rounded-lg"
            />
          </div>
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}
          <button type="submit" className="btn-gold w-full py-3.5 font-semibold rounded-xl text-base">
            Continue
          </button>
        </div>
      </div>
    </form>
  );
}
