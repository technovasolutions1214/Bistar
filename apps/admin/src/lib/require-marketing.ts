import { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

/**
 * Resolve the caller's uid ONLY if they are marketing staff or an admin, else
 * null.
 *
 * Mirrors Firestore's isMarketingStaff() rule exactly — the `admin` custom
 * claim, or role "admin"/"marketing" on the caller's users doc — so an API
 * route can never be more permissive than the database.
 *
 * This is the Pixels-panel counterpart to requireAdminUid(). It exists because
 * marketing staff own the pixels (they can already create, edit and delete
 * `pixels` docs) and must be able to verify one without an admin present. The
 * Ad Networks pipeline stays on requireAdminUid() and is unaffected.
 */
export async function requireMarketingUid(request: NextRequest): Promise<string | null> {
  const m = (request.headers.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(m[1]);
    if (decoded.admin === true) return decoded.uid;
    const snap = await getAdminDb().collection("users").doc(decoded.uid).get();
    const role = snap.exists ? snap.data()?.role : undefined;
    return role === "admin" || role === "marketing" ? decoded.uid : null;
  } catch {
    return null;
  }
}
