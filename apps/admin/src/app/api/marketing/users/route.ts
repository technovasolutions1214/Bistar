import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

/**
 * Admin-only management of marketing-staff accounts (email + password,
 * role="marketing"). Marketing users can sign into the dashboard but the
 * route-wall limits them to /marketing/*.
 *
 * Every handler verifies the CALLER is an admin — a marketing user cannot
 * manage accounts even though they can reach the marketing area.
 */
async function callerIsAdmin(request: NextRequest): Promise<boolean> {
  const m = (request.headers.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return false;
  try {
    const decoded = await getAdminAuth().verifyIdToken(m[1]);
    if (decoded.admin === true) return true;
    const snap = await getAdminDb().collection("users").doc(decoded.uid).get();
    return snap.exists && snap.data()?.role === "admin";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await callerIsAdmin(request)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const adminAuth = getAdminAuth();
  const snap = await getAdminDb().collection("users").where("role", "==", "marketing").get();
  const users = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      let disabled = false;
      try {
        disabled = (await adminAuth.getUser(d.id)).disabled;
      } catch {
        /* auth record gone — treat as enabled */
      }
      return {
        uid: d.id,
        email: data.email ?? "",
        displayName: data.displayName ?? "",
        disabled,
      };
    })
  );
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  if (!(await callerIsAdmin(request)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email, password, displayName } = await request.json();
  if (!email || !password || String(password).length < 8) {
    return NextResponse.json(
      { error: "Email and a password (8+ characters) are required" },
      { status: 400 }
    );
  }
  try {
    const rec = await getAdminAuth().createUser({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      displayName: displayName ? String(displayName) : undefined,
    });
    await getAdminDb().collection("users").doc(rec.uid).set({
      uid: rec.uid,
      email: rec.email ?? String(email).trim().toLowerCase(),
      displayName: displayName ? String(displayName) : "",
      role: "marketing",
      subscription: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return NextResponse.json({ uid: rec.uid });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "auth/email-already-exists")
      return NextResponse.json({ error: "That email already has an account." }, { status: 409 });
    if (code === "auth/operation-not-allowed")
      return NextResponse.json(
        { error: "Email/Password sign-in isn't enabled in Firebase yet." },
        { status: 400 }
      );
    if (code === "auth/invalid-password")
      return NextResponse.json({ error: "Password is too weak." }, { status: 400 });
    console.error("create marketing user:", err);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

// Reset password and/or enable/disable a marketing account.
export async function PATCH(request: NextRequest) {
  if (!(await callerIsAdmin(request)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { uid, password, disabled } = await request.json();
  if (!uid) return NextResponse.json({ error: "uid is required" }, { status: 400 });

  const snap = await getAdminDb().collection("users").doc(uid).get();
  if (!snap.exists || snap.data()?.role !== "marketing")
    return NextResponse.json({ error: "Not a marketing user" }, { status: 404 });

  const update: { password?: string; disabled?: boolean } = {};
  if (typeof password === "string" && password.length >= 8) update.password = password;
  if (typeof disabled === "boolean") update.disabled = disabled;
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  await getAdminAuth().updateUser(uid, update);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!(await callerIsAdmin(request)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const uid = request.nextUrl.searchParams.get("uid");
  if (!uid) return NextResponse.json({ error: "uid is required" }, { status: 400 });

  const snap = await getAdminDb().collection("users").doc(uid).get();
  if (!snap.exists || snap.data()?.role !== "marketing")
    return NextResponse.json({ error: "Not a marketing user" }, { status: 404 });

  await getAdminAuth().deleteUser(uid).catch(() => {});
  await getAdminDb().collection("users").doc(uid).delete();
  return NextResponse.json({ ok: true });
}
