import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import https from "https";

if (!admin.apps.length) {
  admin.initializeApp();
}

interface MSG91Response {
  type: string;
  message: string;
  request_id?: string;
}

function msg91Request(
  method: string,
  reqPath: string,
  body?: Record<string, unknown>,
): Promise<MSG91Response> {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) {
    throw new HttpsError("failed-precondition", "MSG91_AUTH_KEY is not configured");
  }

  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;

    const options: https.RequestOptions = {
      hostname: "control.msg91.com",
      path: reqPath,
      method,
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw) as MSG91Response);
        } catch {
          reject(new Error(`Invalid MSG91 response: ${raw}`));
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

export const sendOTP = onCall({ region: "asia-south1" }, async (request) => {
  const phone = request.data?.phone as string | undefined;
  if (!phone || typeof phone !== "string") {
    throw new HttpsError("invalid-argument", "A valid phone number is required");
  }

  const templateId = process.env.MSG91_TEMPLATE_ID;
  if (!templateId) {
    throw new HttpsError("failed-precondition", "MSG91_TEMPLATE_ID is not configured");
  }

  try {
    const msg91Mobile = phone.replace(/^\+/, "");
    const response = await msg91Request("POST", "/api/v5/otp", {
      template_id: templateId,
      mobile: msg91Mobile,
    });

    if (response.type === "success") {
      return { success: true, message: "OTP sent successfully" };
    }

    throw new HttpsError("internal", response.message || "Failed to send OTP");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("sendOTP error", error);
    throw new HttpsError("internal", "Failed to send OTP");
  }
});

export const verifyOTP = onCall({ region: "asia-south1" }, async (request) => {
  const phone = request.data?.phone as string | undefined;
  const otp = request.data?.otp as string | undefined;

  if (!phone || !otp) {
    throw new HttpsError("invalid-argument", "Both phone and otp are required");
  }

  try {
    const msg91Mobile = phone.replace(/^\+/, "");
    const response = await msg91Request(
      "GET",
      `/api/v5/otp/verify?mobile=${encodeURIComponent(msg91Mobile)}&otp=${encodeURIComponent(otp)}`,
    );

    if (response.type !== "success") {
      throw new HttpsError("unauthenticated", "Invalid OTP");
    }

    const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;
    let userRecord: admin.auth.UserRecord;

    try {
      userRecord = await admin.auth().getUserByPhoneNumber(formattedPhone);
    } catch {
      userRecord = await admin.auth().createUser({
        phoneNumber: formattedPhone,
        displayName: formattedPhone,
      });

      await admin.firestore().doc(`users/${userRecord.uid}`).set({
        phone: formattedPhone,
        role: "user",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    const customToken = await admin.auth().createCustomToken(userRecord.uid, {
      phone: formattedPhone,
    });

    return { success: true, token: customToken };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("verifyOTP error", error);
    throw new HttpsError("internal", "OTP verification failed");
  }
});
