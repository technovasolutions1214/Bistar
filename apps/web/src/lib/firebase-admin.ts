import { initializeApp, getApps, cert, applicationDefault, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getApp() {
  if (getApps().length > 0) return getApps()[0];

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  // Local dev: use the JSON service account from .env.local.
  // Firebase App Hosting / Cloud Run: fall back to Application Default Credentials,
  // which the compute service account provides automatically.
  if (serviceAccountJson) {
    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
    } catch {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT env var contains malformed JSON. Please verify the value is valid JSON."
      );
    }
    return initializeApp({ credential: cert(serviceAccount) });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
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
