import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export async function POST(request: NextRequest) {
  try {
    const { userId, planId, transactionId } = await request.json();

    if (!userId || !planId || !transactionId) {
      return NextResponse.json(
        { error: "userId, planId, and transactionId are required" },
        { status: 400 }
      );
    }

    // Verify Firebase Auth token
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      );
    }

    const idToken = authHeader.split("Bearer ")[1];
    let decodedToken;
    try {
      decodedToken = await getAdminAuth().verifyIdToken(idToken);
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Verify the caller is the same user (or admin)
    const isAdmin = decodedToken.admin === true;
    if (decodedToken.uid !== userId && !isAdmin) {
      return NextResponse.json(
        { error: "Unauthorized: token does not match userId" },
        { status: 403 }
      );
    }

    // Deduplication: check if transactionId already exists
    const existingTxn = await getAdminDb()
      .collection("transactions")
      .where("transactionId", "==", transactionId)
      .limit(1)
      .get();

    if (!existingTxn.empty) {
      return NextResponse.json({
        success: true,
        message: "Transaction already processed",
      });
    }

    // Fetch the plan details
    const planDoc = await getAdminDb().collection("plans").doc(planId).get();
    if (!planDoc.exists) {
      return NextResponse.json(
        { error: "Plan not found" },
        { status: 404 }
      );
    }

    const plan = planDoc.data()!;
    const now = new Date();
    const endDate = new Date(now.getTime() + plan.duration * 24 * 60 * 60 * 1000);

    // Update user subscription
    await getAdminDb()
      .collection("users")
      .doc(userId)
      .update({
        subscription: {
          planId,
          planName: plan.name,
          status: "active",
          startDate: Timestamp.fromDate(now),
          endDate: Timestamp.fromDate(endDate),
          transactionId,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

    // Store transaction record
    await getAdminDb().collection("transactions").add({
      userId,
      planId,
      planName: plan.name,
      amount: plan.price,
      currency: plan.currency,
      transactionId,
      status: "success",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: "Subscription activated successfully",
    });
  } catch (error) {
    console.error("Payment confirmation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
