"use client";
import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
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
        const userDoc = await getDoc(doc(db(), "users", user.uid));
        if (userDoc.exists()) {
          setUserData({ uid: user.uid, ...userDoc.data() } as User);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const hasActiveSubscription = useMemo(() => {
    if (!userData?.subscription) return false;
    if (userData.subscription.status !== "active") return false;
    const endDate =
      (userData.subscription.endDate as any)?.toDate?.() ??
      new Date(userData.subscription.endDate as any);
    return endDate > new Date();
  }, [userData]);

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
