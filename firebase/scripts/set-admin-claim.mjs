// Usage:
//   node firebase/scripts/set-admin-claim.mjs <email>         (grant admin)
//   node firebase/scripts/set-admin-claim.mjs <email> --revoke (revoke admin)
//
// Reads FIREBASE_SERVICE_ACCOUNT from apps/admin/.env.local.
// Must be run from the repo root (or any cwd — paths are absolute-resolved).

import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../apps/admin/.env.local");

const envFile = fs.readFileSync(envPath, "utf8");
const match = envFile.match(/^FIREBASE_SERVICE_ACCOUNT=(.+)$/m);
if (!match) {
  console.error(`FIREBASE_SERVICE_ACCOUNT not found in ${envPath}`);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(match[1])) });

const email = process.argv[2];
const revoke = process.argv.includes("--revoke");
if (!email) {
  console.error("Usage: node set-admin-claim.mjs <email> [--revoke]");
  process.exit(1);
}

const user = await admin.auth().getUserByEmail(email);
const current = user.customClaims ?? {};
const next = { ...current };
if (revoke) delete next.admin;
else next.admin = true;

await admin.auth().setCustomUserClaims(user.uid, next);
const after = await admin.auth().getUser(user.uid);
console.log(`${revoke ? "Revoked" : "Granted"} admin for ${email} (uid: ${user.uid})`);
console.log("Claims:", after.customClaims ?? {});
console.log("User must sign out and back in for the claim to take effect.");
process.exit(0);
