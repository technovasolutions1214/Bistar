"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@novaflix/firebase-config";
import type { User } from "@novaflix/shared";

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  userData: User | null;
  loading: boolean;
  role: User["role"] | null;
  isAdmin: boolean;
  isMarketing: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  userData: null,
  loading: true,
  role: null,
  isAdmin: false,
  isMarketing: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth(), async (user) => {
      setFirebaseUser(user);
      try {
        if (user) {
          const userDoc = await getDoc(doc(db(), "users", user.uid));
          if (userDoc.exists()) {
            setUserData({ uid: user.uid, ...userDoc.data() } as User);
          } else {
            setUserData(null);
          }
        } else {
          setUserData(null);
        }
      } catch (err) {
        console.error("Failed to fetch user data:", err);
        setUserData(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth());
    setUserData(null);
  };

  const role = userData?.role ?? null;
  const isAdmin = role === "admin";
  const isMarketing = role === "marketing";

  return (
    <AuthContext.Provider
      value={{ firebaseUser, userData, loading, role, isAdmin, isMarketing, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
