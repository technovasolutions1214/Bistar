import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

interface MSG91Settings {
  widgetId?: string;
  tokenAuth?: string;
  templateId?: string; // legacy field that may actually hold the widgetId
}

export async function GET() {
  try {
    const snap = await getAdminDb().collection("settings").doc("msg91").get();
    const data = (snap.exists ? (snap.data() as MSG91Settings) : {}) ?? {};

    const widgetId = data.widgetId || data.templateId || process.env.MSG91_WIDGET_ID || process.env.MSG91_TEMPLATE_ID;
    const tokenAuth = data.tokenAuth || process.env.MSG91_TOKEN_AUTH;

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
