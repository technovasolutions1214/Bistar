import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";

async function getMsg91AuthKey(): Promise<string | undefined> {
  try {
    const snap = await getAdminDb().collection("settings").doc("msg91").get();
    if (snap.exists) {
      const data = snap.data() as { authKey?: string };
      if (data.authKey) return data.authKey;
    }
  } catch (err) {
    console.warn("Failed to read MSG91 settings from Firestore:", err);
  }
  return process.env.MSG91_AUTH_KEY;
}

export async function POST(request: NextRequest) {
  try {
    const { phone, otp } = await request.json();

    if (!phone || !otp) {
      return NextResponse.json(
        { error: "Phone and OTP are required" },
        { status: 400 }
      );
    }

    if (!/^\+?[1-9]\d{6,14}$/.test(phone)) {
      return NextResponse.json(
        { error: "Invalid phone number format" },
        { status: 400 }
      );
    }

    const { success: allowed } = rateLimit(`verify-otp:${phone}`, 10, 10 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please try again later." },
        { status: 429 }
      );
    }

    const authKey = await getMsg91AuthKey();

    if (!authKey) {
      return NextResponse.json(
        { error: "OTP service is not configured. Please contact support." },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://control.msg91.com/api/v5/otp/verify?mobile=${encodeURIComponent(phone)}&otp=${encodeURIComponent(otp)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: authKey,
        },
      }
    );

    const data = await response.json();

    if (data.type !== "success") {
      return NextResponse.json(
        { error: data.message || "Invalid OTP" },
        { status: 400 }
      );
    }

    // Create or fetch Firebase user by phone number
    let uid: string;
    try {
      const userRecord = await getAdminAuth().getUserByPhoneNumber(phone);
      uid = userRecord.uid;
    } catch {
      const newUser = await getAdminAuth().createUser({
        phoneNumber: phone,
        displayName: phone,
      });
      uid = newUser.uid;
    }

    const token = await getAdminAuth().createCustomToken(uid);

    return NextResponse.json({ token, uid });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
