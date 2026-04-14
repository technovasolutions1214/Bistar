import { initializeApp, getApps, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getApp() {
  if (getApps().length > 0) return getApps()[0];

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT env var is not set");
  }

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
  } catch (error) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT env var contains malformed JSON. Please verify the value is valid JSON."
    );
  }
  return initializeApp({ credential: cert(serviceAccount) });
}

export function getAdminAuth() {
  return getAuth(getApp());
}

export function getAdminDb() {
  return getFirestore(getApp());
}

export function getAdminStorage() {
  return getStorage(getApp());
}
