"use client";
import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, type User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@bistar/firebase-config";
import type { User } from "@bistar/shared";

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  userData: User | null;
  loading: boolean;
  hasActiveSubscription: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  userData: null,
  loading: true,
  hasActiveSubscription: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // At most one guest-payment claim attempt per signed-in uid per page load.
  const reconciledFor = useRef<string | null>(null);

  useEffect(() => {
    let unsubDoc: (() => void) | null = null;

    let currentUid: string | null = null;

    const unsubscribe = onAuthStateChanged(auth(), (user) => {
      unsubDoc?.();
      unsubDoc = null;

      // Drop the previous account's doc before adopting the new uid. Guest
      // checkout goes anonymous -> real account, and the anonymous user can
      // hold an active subscription (the webhook put it there); carrying it
      // across the switch would briefly show the new account as subscribed.
      if (user?.uid !== currentUid) {
        setUserData(null);
        if (user) setLoading(true);
      }
      currentUid = user?.uid ?? null;
      setFirebaseUser(user);

      if (!user) {
        reconciledFor.current = null;
        setLoading(false);
        return;
      }

      const userRef = doc(db(), "users", user.uid);
      // Guard so a failed self-heal write can't loop against its own snapshot.
      let healing = false;

      // Live listener rather than a one-shot read: users/{uid}.subscription is
      // written SERVER-side (the PayU webhook and /api/subscription/reconcile),
      // so a getDoc taken at sign-in never saw an activation that landed later.
      // That left paid users staring at the paywall until a hard reload — and
      // some of them paid a second time.
      unsubDoc = onSnapshot(
        userRef,
        async (userDoc) => {
          if (userDoc.exists()) {
            setUserData({ uid: user.uid, ...userDoc.data() } as User);
            setLoading(false);
            return;
          }
          // NEVER treat a cache-only miss as "this user has no document".
          // getDoc used to reject outright when offline with nothing cached, so
          // the branch below only ran on a SERVER-confirmed absence. onSnapshot
          // does not: with memory-only persistence (packages/firebase-config
          // uses plain getFirestore()) a flaky first load raises an initial
          // event from an empty cache with exists() === false. Healing on that
          // would write over a real server document — including a paid user's
          // subscription — and latency compensation would immediately show them
          // the paywall, which is the exact bug this file is meant to fix.
          if (userDoc.metadata.fromCache) {
            setLoading(false);
            return;
          }

          // Auth user exists but no Firestore doc — either the signup race
          // dropped it or the user signed in before /users rules allowed
          // client creates. Self-heal so the rest of the app (plans page,
          // subscription check, admin list) sees a consistent state.
          if (healing) return;
          healing = true;
          const fresh = {
            uid: user.uid,
            role: "user" as const,
            subscription: null,
            displayName: user.displayName || user.phoneNumber || "",
            email: user.email || "",
            photoURL: user.photoURL || "",
            phone: user.phoneNumber || "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          // Release the loading gate BEFORE the write: an offline setDoc never
          // settles, and awaiting it first would hang the UI on a spinner.
          setLoading(false);
          try {
            // merge, never a full overwrite — if this ever does race a document
            // that exists server-side, it must not be able to delete fields the
            // server wrote (subscription above all).
            await setDoc(userRef, fresh, { merge: true });
            // The snapshot fires again with the written doc; don't set state
            // from the local copy or serverTimestamp sentinels leak into it.
          } catch (writeErr) {
            console.error("Failed to self-heal user doc:", writeErr);
            setUserData(null);
          }
        },
        (error) => {
          console.error("Failed to fetch user data:", error);
          setUserData(null);
          setLoading(false);
        },
      );
    });

    return () => {
      unsubDoc?.();
      unsubscribe();
    };
  }, []);

  const hasActiveSubscription = useMemo(() => {
    // Anonymous (guest-checkout) sessions are never treated as subscribed. The
    // webhook may activate a sub on the throwaway anon user, but the purchase
    // only counts once it's claimed onto a real phone account at sign-in.
    if (firebaseUser?.isAnonymous) return false;
    if (!userData?.subscription) return false;
    if (userData.subscription.status !== "active") return false;
    // endDate is a Firestore Timestamp in practice, but tolerate serialized
    // string/number values from older writes.
    const end = userData.subscription.endDate;
    const endDate =
      typeof end?.toDate === "function"
        ? end.toDate()
        : new Date(end as unknown as string | number);
    return endDate > new Date();
  }, [userData, firebaseUser]);

  // Claim any guest payment made against this account's verified phone.
  //
  // Guest checkout pays as an ANONYMOUS user, so the webhook activates the
  // subscription on a throwaway uid; only /api/subscription/reconcile moves it
  // onto the real account. That endpoint used to be called from exactly one
  // place — the OTP submit handler — so a buyer who paid as a guest and then
  // signed in with Google, or who was already signed in on another tab, or who
  // came back days later, never received what they paid for.
  //
  // Running it here covers every route into a signed-in session. It is safe to
  // repeat: the server matches only on the Firebase Auth phoneNumber (proven by
  // OTP) and stamps pendingClaims.claimedByUid on first grant, so it cannot
  // double-grant or be pointed at someone else's payment. The onSnapshot
  // listener above picks up the granted subscription with no reload.
  useEffect(() => {
    if (loading) return;
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    if (hasActiveSubscription) return;
    if (reconciledFor.current === firebaseUser.uid) return;
    reconciledFor.current = firebaseUser.uid;

    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/subscription/reconcile", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          // Allow a later mount to retry rather than burning the one attempt.
          reconciledFor.current = null;
        }
      } catch (err) {
        reconciledFor.current = null;
        console.error("Subscription reconcile failed:", err);
      }
    })();
  }, [firebaseUser, loading, hasActiveSubscription]);

  const signOut = async () => {
    await firebaseSignOut(auth());
    setUserData(null);
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, userData, loading, hasActiveSubscription, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
