"use client";
import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@novaflix/firebase-config";
import type { User } from "@novaflix/shared";

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth(), async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const userRef = doc(db(), "users", user.uid);
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            setUserData({ uid: user.uid, ...userDoc.data() } as User);
          } else {
            // Auth user exists but no Firestore doc — either the signup race
            // dropped it or the user signed in before /users rules allowed
            // client creates. Self-heal so the rest of the app (plans page,
            // subscription check, admin list) sees a consistent state.
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
            try {
              await setDoc(userRef, fresh);
              setUserData(fresh as unknown as User);
            } catch (writeErr) {
              console.error("Failed to self-heal user doc:", writeErr);
              setUserData(null);
            }
          }
        } catch (error) {
          console.error("Failed to fetch user data:", error);
          setUserData(null);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const hasActiveSubscription = useMemo(() => {
    // Anonymous (guest-checkout) sessions are never treated as subscribed. The
    // webhook may activate a sub on the throwaway anon user, but the purchase
    // only counts once it's claimed onto a real phone account at sign-in.
    if (firebaseUser?.isAnonymous) return false;
    if (!userData?.subscription) return false;
    if (userData.subscription.status !== "active") return false;
    const endDate =
      (userData.subscription.endDate as any)?.toDate?.() ??
      new Date(userData.subscription.endDate as any);
    return endDate > new Date();
  }, [userData, firebaseUser]);

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
