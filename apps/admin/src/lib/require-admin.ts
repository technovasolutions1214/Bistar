import { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

/**
 * Resolve the caller's uid ONLY if they are an admin, else null.
 *
 * Accepts either the `admin` custom claim or role:"admin" on the caller's
 * users doc — the same two things Firestore's isAdmin() rule checks, so an
 * API route can never be more permissive than the database.
 *
 * Marketing staff fail this check, which is what keeps the Ad Networks panel
 * and its postback pipeline out of their reach at every layer.
 */
export async function requireAdminUid(request: NextRequest): Promise<string | null> {
  const m = (request.headers.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(m[1]);
    if (decoded.admin === true) return decoded.uid;
    const snap = await getAdminDb().collection("users").doc(decoded.uid).get();
    return snap.exists && snap.data()?.role === "admin" ? decoded.uid : null;
  } catch {
    return null;
  }
}
