import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

interface PayUSettings {
  key?: string;
  salt?: string;
  paymentUrl?: string;
  statusUrl?: string;
  productInfo?: string;
}

/**
 * PayU Payment creation endpoint.
 *
 * Flow:
 *   1. Client (authenticated) calls POST /api/payment/payu/create with { planId }
 *   2. Server verifies the caller's Firebase ID token
 *   3. Server fetches PayU credentials from settings/payu (Firestore)
 *   4. Server fetches the plan, builds the PayU data payload, and generates the
 *      SHA-512 hash using the salt (server-side only - never exposed to client)
 *   5. Server returns the final redirect URL with the hash attached
 *
 * The client then redirects the browser to that URL. The external PayU page
 * (hosted at flix.cinestry.com) handles the rest and redirects users back to
 * the configured callback URL on completion.
 */
export async function POST(request: NextRequest) {
  try {
    // --- 1. Auth ---------------------------------------------------------
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    const token = match[1];

    let decodedToken;
    try {
      decodedToken = await getAdminAuth().verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired auth token" },
        { status: 401 }
      );
    }

    const userId = decodedToken.uid;

    // --- 2. Parse body ---------------------------------------------------
    const { planId } = await request.json();
    if (!planId) {
      return NextResponse.json(
        { error: "planId is required" },
        { status: 400 }
      );
    }

    // --- 3. Fetch plan ---------------------------------------------------
    const planSnap = await getAdminDb().collection("plans").doc(planId).get();
    if (!planSnap.exists) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    const plan = planSnap.data()!;
    if (plan.isActive === false) {
      return NextResponse.json(
        { error: "Plan is no longer available" },
        { status: 400 }
      );
    }

    // --- 4. Fetch user profile (for email/phone) ------------------------
    const userSnap = await getAdminDb().collection("users").doc(userId).get();
    const userData = userSnap.exists ? userSnap.data()! : {};

    // --- 5. Fetch PayU settings -----------------------------------------
    const payuSnap = await getAdminDb().collection("settings").doc("payu").get();
    if (!payuSnap.exists) {
      return NextResponse.json(
        { error: "Payment gateway is not configured. Please contact support." },
        { status: 500 }
      );
    }
    const payu = payuSnap.data() as PayUSettings;

    if (!payu.key || !payu.salt || !payu.paymentUrl || !payu.productInfo) {
      return NextResponse.json(
        { error: "Payment gateway is misconfigured. Please contact support." },
        { status: 500 }
      );
    }

    // --- 6. Build PayU payload ------------------------------------------
    const txnid = `NF-${Date.now()}-${userId.slice(0, 8)}`;
    const amount = String(plan.price);
    const firstname = userId; // PayU's firstname field is used as our userId (matches cinestry template)
    const email = decodedToken.email || userData.email || "contact@cinestry.com";
    const rawPhone: string = userData.phone || decodedToken.phone_number || "";
    const phone = rawPhone ? rawPhone.replace(/\D/g, "").slice(-10) : "0000000000";
    const statusUrl = payu.statusUrl || "https://flix.cinestry.com/payu-payment-status.html";

    const data = {
      key: payu.key,
      txnid,
      amount,
      productinfo: payu.productInfo,
      firstname,
      email,
      phone,
      surl: statusUrl,
      furl: statusUrl,
    };

    // --- 7. Generate hash ------------------------------------------------
    // PayU hash formula:
    //   sha512(key|txnid|amount|productinfo|firstname|email|||||||||||salt)
    // (10 empty fields between email and salt: udf1-5 + 5 reserved)
    const hashInput = `${data.key}|${data.txnid}|${data.amount}|${data.productinfo}|${data.firstname}|${data.email}|||||||||||${payu.salt}`;
    const hash = crypto.createHash("sha512").update(hashInput).digest("hex");

    // --- 8. Build redirect URL ------------------------------------------
    const params = new URLSearchParams({
      key: data.key,
      txnid: data.txnid,
      amount: data.amount,
      productinfo: data.productinfo,
      firstname: data.firstname,
      email: data.email,
      phone: data.phone,
      surl: data.surl,
      furl: data.furl,
      hash,
    });

    const paymentUrl = `${payu.paymentUrl}?${params.toString()}`;

    // --- 9. Record pending transaction ---------------------------------
    await getAdminDb().collection("transactions").doc(txnid).set({
      userId,
      planId,
      planName: plan.name ?? planId,
      amount: plan.price,
      currency: plan.currency ?? "INR",
      transactionId: txnid,
      productInfo: payu.productInfo,
      status: "pending",
      gateway: "payu",
      createdAt: new Date(),
    });

    return NextResponse.json({
      paymentUrl,
      txnid,
    });
  } catch (error) {
    console.error("PayU create error:", error);
    return NextResponse.json(
      { error: "Failed to create payment. Please try again." },
      { status: 500 }
    );
  }
}
