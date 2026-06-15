import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

/**
 * Admin-only management of ADMIN accounts.
 *
 * Admins sign in with Google (no password), so we can't "create" them with a
 * password the way marketing users are made. Instead we grant the admin role to
 * an EXISTING account, resolving the real Firebase Auth uid server-side via
 * getUserByEmail/PhoneNumber and writing role on `users/{uid}` — the exact doc
 * the dashboard's auth gate reads. (The old client-side flow created a doc with
 * a RANDOM id when the person had no users doc yet, so the role never matched
 * their sign-in uid → "Access denied" despite "having permissions".)
 *
 * Every handler verifies the CALLER is an admin.
 */
async function callerUid(request: NextRequest): Promise<string | null> {
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

// Grant admin to an existing account, by email or phone.
export async function POST(request: NextRequest) {
  if (!(await callerUid(request)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email, phone } = await request.json();
  const auth = getAdminAuth();
  const db = getAdminDb();

  const emailNorm = email ? String(email).trim().toLowerCase() : "";
  const phoneNorm = phone ? String(phone).trim() : "";
  if (!emailNorm && !phoneNorm)
    return NextResponse.json({ error: "Provide an email or phone number." }, { status: 400 });

  let rec;
  try {
    rec = emailNorm
      ? await auth.getUserByEmail(emailNorm)
      : await auth.getUserByPhoneNumber(phoneNorm);
  } catch {
    return NextResponse.json(
      {
        error:
          "No account exists for that yet. Ask them to sign in once on the dashboard (Google) " +
          "or the main site, then add them.",
      },
      { status: 404 },
    );
  }

  const ref = db.collection("users").doc(rec.uid);
  const before = await ref.get();
  if (before.exists && before.data()?.role === "admin")
    return NextResponse.json({ error: "That user is already an admin." }, { status: 409 });

  await ref.set(
    {
      uid: rec.uid,
      email: rec.email ?? emailNorm,
      ...(rec.phoneNumber || phoneNorm ? { phone: rec.phoneNumber ?? phoneNorm } : {}),
      displayName: rec.displayName ?? before.data()?.displayName ?? "",
      role: "admin",
      updatedAt: new Date(),
      ...(before.exists ? {} : { subscription: null, createdAt: new Date() }),
    },
    { merge: true },
  );

  // Clean up orphan role:"admin" docs the old client flow created (same
  // email/phone, random id != the real uid) so the admin list isn't polluted.
  let cleaned = 0;
  const field = emailNorm ? "email" : "phone";
  const val = emailNorm || phoneNorm;
  const dupes = await db.collection("users").where(field, "==", val).get();
  for (const d of dupes.docs) {
    if (d.id !== rec.uid && d.data()?.role === "admin") {
      await d.ref.delete();
      cleaned++;
    }
  }

  return NextResponse.json({ uid: rec.uid, cleaned });
}

// Revoke admin (role -> "user"). You can't remove your own access — that keeps
// at least one admin (you) and makes total lock-out impossible.
export async function DELETE(request: NextRequest) {
  const caller = await callerUid(request);
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const uid = request.nextUrl.searchParams.get("uid");
  if (!uid) return NextResponse.json({ error: "uid is required" }, { status: 400 });
  if (uid === caller)
    return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });

  const db = getAdminDb();
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.role !== "admin")
    return NextResponse.json({ error: "Not an admin user." }, { status: 404 });

  await ref.set({ role: "user", updatedAt: new Date() }, { merge: true });
  return NextResponse.json({ ok: true });
}
