/**
 * NovaFlix Cloud Functions
 *
 * Entry point that re-exports every function module.
 * Firebase discovers and deploys each named export as a Cloud Function.
 */

export { sendOTP, verifyOTP } from "./auth-msg91";
export { onVideoUploaded } from "./video-transcode";
export { confirmPayment, checkExpiredSubscriptions } from "./subscription";
export { aggregateDailyAnalytics } from "./analytics";
