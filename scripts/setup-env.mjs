#!/usr/bin/env node
/**
 * NovaFlix Firebase Setup Script
 *
 * Usage:
 *   node scripts/setup-env.mjs <path-to-service-account.json>
 *
 * This reads your Firebase service account JSON and writes .env.local
 * files for both apps. You'll be prompted for the remaining values.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.log("\n🎬 \x1b[1m\x1b[31mNovaFlix\x1b[0m Firebase Setup\n");

  // Step 1: Service Account
  let saJSON = "";
  let projectId = "";

  const saPath = process.argv[2];
  if (saPath) {
    try {
      const raw = readFileSync(resolve(saPath), "utf-8");
      const sa = JSON.parse(raw);
      if (!sa.project_id || !sa.private_key) {
        console.error("❌ File doesn't look like a Firebase service account JSON");
        process.exit(1);
      }
      saJSON = JSON.stringify(sa);
      projectId = sa.project_id;
      console.log(`✅ Service account loaded: ${sa.project_id} (${sa.client_email})`);
    } catch (e) {
      console.error(`❌ Failed to read ${saPath}: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log("⚠️  No service account file provided.");
    console.log("   Usage: node scripts/setup-env.mjs <path-to-service-account.json>\n");
    projectId = await ask("Enter Firebase Project ID: ");
  }

  // Step 2: Web Config
  console.log("\n📱 Firebase Web App Config:");
  console.log("   (Find in Firebase Console → Project Settings → Your Apps → Web)\n");

  const apiKey = await ask("  API Key: ");
  const authDomain = await ask(`  Auth Domain [${projectId}.firebaseapp.com]: `) || `${projectId}.firebaseapp.com`;
  const confirmedProjectId = await ask(`  Project ID [${projectId}]: `) || projectId;
  const storageBucket = await ask(`  Storage Bucket [${projectId}.firebasestorage.app]: `) || `${projectId}.firebasestorage.app`;
  const messagingSenderId = await ask("  Messaging Sender ID: ");
  const appId = await ask("  App ID: ");

  // Step 3: MSG91 (optional)
  console.log("\n📲 MSG91 OTP Config (press Enter to skip):");
  const msg91AuthKey = await ask("  MSG91 Auth Key: ");
  const msg91TemplateId = await ask("  MSG91 Template ID: ");

  // Generate env files
  const webEnv = `# Firebase Web SDK
NEXT_PUBLIC_FIREBASE_API_KEY=${apiKey}
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${authDomain}
NEXT_PUBLIC_FIREBASE_PROJECT_ID=${confirmedProjectId}
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${storageBucket}
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}
NEXT_PUBLIC_FIREBASE_APP_ID=${appId}

# Firebase Admin SDK
FIREBASE_SERVICE_ACCOUNT=${saJSON}

# MSG91 OTP
NEXT_PUBLIC_MSG91_AUTH_KEY=${msg91AuthKey}
MSG91_TEMPLATE_ID=${msg91TemplateId}
`;

  const adminEnv = `# Firebase Web SDK
NEXT_PUBLIC_FIREBASE_API_KEY=${apiKey}
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${authDomain}
NEXT_PUBLIC_FIREBASE_PROJECT_ID=${confirmedProjectId}
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${storageBucket}
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}
NEXT_PUBLIC_FIREBASE_APP_ID=${appId}

# Firebase Admin SDK
FIREBASE_SERVICE_ACCOUNT=${saJSON}
`;

  const webEnvPath = resolve(ROOT, "apps/web/.env.local");
  const adminEnvPath = resolve(ROOT, "apps/admin/.env.local");

  writeFileSync(webEnvPath, webEnv);
  writeFileSync(adminEnvPath, adminEnv);

  console.log("\n✅ Files written:");
  console.log(`   📁 ${webEnvPath}`);
  console.log(`   📁 ${adminEnvPath}`);
  console.log("\n🚀 Run \x1b[1mpnpm dev\x1b[0m to start developing!\n");

  rl.close();
}

main().catch(console.error);
