import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(request: NextRequest) {
  try {
    const { userId, planId, transactionId } = await request.json();

    if (!userId || !planId || !transactionId) {
      return NextResponse.json(
        { error: "userId, planId, and transactionId are required" },
        { status: 400 }
      );
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
          startDate: now,
          endDate,
          transactionId,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

    // Optionally store transaction record
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
