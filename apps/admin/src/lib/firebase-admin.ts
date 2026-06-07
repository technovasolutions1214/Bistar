import { initializeApp, getApps, cert, type ServiceAccount, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Lazy initialization. We must NOT touch the Admin SDK at module load: route
// modules are evaluated during `next build` (where there are no credentials),
// and on App Hosting an eager getAuth()/getFirestore() at import can hang or
// fail against the build sandbox. Initializing inside these getters defers it
// to request time. Mirrors the web app's pattern.
function getApp(): App {
  const existing = getApps();
  if (existing.length) return existing[0];

  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    return initializeApp({ credential: cert(JSON.parse(json) as ServiceAccount) });
  }
  // App Hosting / Cloud Run: Application Default Credentials from the runtime SA.
  return initializeApp();
}

export function getAdminAuth() {
  return getAuth(getApp());
}

export function getAdminDb() {
  return getFirestore(getApp());
}
