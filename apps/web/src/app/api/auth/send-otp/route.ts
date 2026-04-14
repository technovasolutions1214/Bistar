import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();

    if (!phone) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    // Rate limit: 5 requests per 10 minutes per phone
    const { success: allowed } = rateLimit(`send-otp:${phone}`, 5, 10 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please try again later." },
        { status: 429 }
      );
    }

    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;

    if (!authKey || !templateId) {
      return NextResponse.json(
        { error: "OTP service not configured" },
        { status: 500 }
      );
    }

    // Send OTP via MSG91
    const response = await fetch(
      `https://control.msg91.com/api/v5/otp?template_id=${templateId}&mobile=${phone}`,
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
