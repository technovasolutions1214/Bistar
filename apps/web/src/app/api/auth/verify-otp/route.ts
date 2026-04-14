import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const { phone, otp } = await request.json();

    if (!phone || !otp) {
      return NextResponse.json(
        { error: "Phone and OTP are required" },
        { status: 400 }
      );
    }

    // Rate limit: 10 requests per 10 minutes per phone
    const { success: allowed } = rateLimit(`verify-otp:${phone}`, 10, 10 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please try again later." },
        { status: 429 }
      );
    }

    const authKey = process.env.MSG91_AUTH_KEY;

    if (!authKey) {
      return NextResponse.json(
        { error: "OTP service not configured" },
        { status: 500 }
      );
    }

    // Verify OTP via MSG91
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

    // Create or get Firebase user by phone number
    let uid: string;
    try {
      const userRecord = await getAdminAuth().getUserByPhoneNumber(phone);
      uid = userRecord.uid;
    } catch {
      // User doesn't exist, create new one
      const newUser = await getAdminAuth().createUser({
        phoneNumber: phone,
        displayName: phone,
      });
      uid = newUser.uid;
    }

    // Generate custom token for client sign-in
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
