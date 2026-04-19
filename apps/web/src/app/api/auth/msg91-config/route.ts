import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

interface MSG91Settings {
  widgetId?: string;
  tokenAuth?: string;
}

export async function GET() {
  try {
    const snap = await getAdminDb().collection("settings").doc("msg91").get();
    const data = (snap.exists ? (snap.data() as MSG91Settings) : {}) ?? {};

    const widgetId = data.widgetId;
    const tokenAuth = data.tokenAuth;

    if (!widgetId || !tokenAuth) {
      return NextResponse.json(
        { error: "Phone OTP is not configured" },
        { status: 503 }
      );
    }

    return NextResponse.json({ widgetId, tokenAuth });
  } catch (err) {
    console.error("msg91-config error:", err);
    return NextResponse.json(
      { error: "Failed to load phone OTP configuration" },
      { status: 500 }
    );
  }
}
