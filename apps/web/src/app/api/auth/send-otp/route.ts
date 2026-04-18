import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getAdminDb } from "@/lib/firebase-admin";

interface MSG91Settings {
  authKey?: string;
  templateId?: string;
  senderId?: string;
}

async function getMsg91Settings(): Promise<MSG91Settings> {
  // Prefer Firestore settings; fall back to env vars for legacy/dev
  try {
    const snap = await getAdminDb().collection("settings").doc("msg91").get();
    if (snap.exists) {
      return snap.data() as MSG91Settings;
    }
  } catch (err) {
    console.warn("Failed to read MSG91 settings from Firestore:", err);
  }
  return {
    authKey: process.env.MSG91_AUTH_KEY,
    templateId: process.env.MSG91_TEMPLATE_ID,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();

    if (!phone) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    if (!/^\+?[1-9]\d{6,14}$/.test(phone)) {
      return NextResponse.json(
        { error: "Invalid phone number format" },
        { status: 400 }
      );
    }

    const { success: allowed } = rateLimit(`send-otp:${phone}`, 5, 10 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please try again later." },
        { status: 429 }
      );
    }

    const { authKey, templateId } = await getMsg91Settings();

    if (!authKey || !templateId) {
      return NextResponse.json(
        { error: "OTP service is not configured. Please contact support." },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(phone)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: authKey,
        },
      }
    );

    const data = await response.json();

    if (data.type === "success") {
      return NextResponse.json({ success: true, message: "OTP sent successfully" });
    }

    return NextResponse.json(
      { error: data.message || "Failed to send OTP" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Send OTP error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
