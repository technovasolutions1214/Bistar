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
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const { phone, accessToken } = await request.json();

    if (!phone || !accessToken) {
      return NextResponse.json(
        { error: "Phone and accessToken are required" },
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
      "https://control.msg91.com/api/v5/widget/verifyAccessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authkey: authKey, "access-token": accessToken }),
      }
    );
    const data = await response.json();

    if (data.type !== "success") {
      console.error("MSG91 verifyAccessToken failed", {
        status: response.status,
        response: data,
      });
      return NextResponse.json(
        { error: data.message || "Invalid OTP" },
        { status: 400 }
      );
    }

    const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;

    let uid: string;
    try {
      const userRecord = await getAdminAuth().getUserByPhoneNumber(formattedPhone);
      uid = userRecord.uid;
    } catch {
      const newUser = await getAdminAuth().createUser({
        phoneNumber: formattedPhone,
        displayName: formattedPhone,
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
