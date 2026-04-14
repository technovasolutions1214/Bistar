import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, getAdminStorage } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contentId = searchParams.get("contentId");
    const videoId = searchParams.get("videoId");

    if (!contentId || !videoId) {
      return NextResponse.json(
        { error: "contentId and videoId are required" },
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

    // Check user has active subscription with valid endDate
    const userDoc = await getAdminDb()
      .collection("users")
      .doc(decodedToken.uid)
      .get();

    if (!userDoc.exists) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const userData = userDoc.data()!;
    const subscription = userData.subscription;

    if (
      !subscription ||
      subscription.status !== "active" ||
      !subscription.endDate
    ) {
      return NextResponse.json(
        { error: "Active subscription required" },
        { status: 403 }
      );
    }

    // Check endDate is in the future
    const endDate =
      subscription.endDate.toDate?.() ??
      new Date(subscription.endDate);
    if (endDate <= new Date()) {
      return NextResponse.json(
        { error: "Subscription has expired" },
        { status: 403 }
      );
    }

    // Fetch video doc to get storageRef
    const videoDoc = await getAdminDb()
      .collection("content")
      .doc(contentId)
      .collection("videos")
      .doc(videoId)
      .get();

    if (!videoDoc.exists) {
      return NextResponse.json(
        { error: "Video not found" },
        { status: 404 }
      );
    }

    const videoData = videoDoc.data()!;
    const storageRef = videoData.storageRef;

    if (!storageRef) {
      return NextResponse.json(
        { error: "Video storage reference not found" },
        { status: 404 }
      );
    }

    // Generate signed URL with 4-hour expiry
    const bucket = getAdminStorage().bucket(
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    );
    const file = bucket.file(storageRef);

    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 1 * 60 * 60 * 1000, // 1 hour
    });

    return NextResponse.json({ url: signedUrl });
  } catch (error) {
    console.error("Video stream error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
