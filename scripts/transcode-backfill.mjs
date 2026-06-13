// Backfill: submit GCP Transcoder jobs for videos stuck at "processing"/"failed".
//
// Dry-run by DEFAULT; pass --apply to actually submit. Idempotent (skips any
// doc already claimed / submitted / ready). Throttled to stay under the
// Transcoder concurrent-job quota. onTranscodeComplete (Pub/Sub) flips each
// doc to "ready" once its job succeeds — this script only submits.
//
// Run in Cloud Shell as project owner (ADC):
//   cd ~/bs && npm i @google-cloud/video-transcoder firebase-admin
//   node transcode-backfill.mjs                      # dry-run (lists candidates)
//   node transcode-backfill.mjs --apply --limit=1    # CANARY: submit one
//   node transcode-backfill.mjs --apply              # submit the rest
//
// KEEP buildJobConfig() / RENDITIONS IN SYNC with
// firebase/functions/src/transcode-config.ts
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { TranscoderServiceClient } from "@google-cloud/video-transcoder";

const PROJECT = "bistar-app";
const REGION = "asia-south1";
const BUCKET = "bistar-app.firebasestorage.app";
const TOPIC = `projects/${PROJECT}/topics/transcoder-job-notifications`;

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;
const THROTTLE_MS = 4000;

const RENDITIONS = [
  { key: "360p", width: 640, height: 360, bitrateBps: 800000 },
  { key: "720p", width: 1280, height: 720, bitrateBps: 2500000 },
  { key: "1080p", width: 1920, height: 1080, bitrateBps: 5000000 },
];

function buildJobConfig() {
  const elementaryStreams = [
    { key: "audio0", audioStream: { codec: "aac", bitrateBps: 128000, sampleRateHertz: 48000, channelCount: 2 } },
  ];
  const muxStreams = [];
  for (const r of RENDITIONS) {
    elementaryStreams.push({
      key: `video_${r.key}`,
      videoStream: { h264: { widthPixels: r.width, heightPixels: r.height, bitrateBps: r.bitrateBps, frameRate: 30, gopDuration: { seconds: 6 } } },
    });
    muxStreams.push({
      key: r.key,
      container: "ts",
      elementaryStreams: [`video_${r.key}`, "audio0"],
      segmentSettings: { segmentDuration: { seconds: 6 }, individualSegments: true },
    });
  }
  return {
    elementaryStreams,
    muxStreams,
    manifests: [{ fileName: "master.m3u8", type: "HLS", muxStreams: RENDITIONS.map((r) => r.key) }],
  };
}

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const transcoder = new TranscoderServiceClient();

const snap = await db.collectionGroup("videos").where("status", "in", ["processing", "failed"]).get();
const candidates = [];
snap.forEach((d) => {
  const v = d.data();
  if (v.jobName || v.jobState === "SUBMITTED" || v.jobState === "CLAIMING" || v.jobState === "DONE") return;
  if (v.source === "external") return;
  if (!v.storageRef) { console.warn(`!! ${d.ref.path} has no storageRef — skip`); return; }
  const parts = d.ref.path.split("/");
  candidates.push({ contentId: parts[1], videoId: parts[3], storageRef: v.storageRef, ref: d.ref });
});

const list = LIMIT ? candidates.slice(0, LIMIT) : candidates;
console.log(`${APPLY ? "APPLY" : "DRY-RUN"} — ${list.length}/${candidates.length} candidate videos\n`);

let submitted = 0, skipped = 0, failed = 0;
for (const c of list) {
  console.log(`• ${c.contentId}/${c.videoId}  <-  ${c.storageRef}`);
  if (!APPLY) continue;

  const claimed = await db.runTransaction(async (tx) => {
    const s = await tx.get(c.ref);
    const d = s.data() || {};
    if (d.jobName || d.jobState === "SUBMITTED" || d.jobState === "CLAIMING" || d.jobState === "DONE" || d.status === "ready") return false;
    tx.set(c.ref, { status: "processing", jobState: "CLAIMING" }, { merge: true });
    return true;
  });
  if (!claimed) { console.log("    skip (already claimed)"); skipped++; continue; }

  try {
    const [job] = await transcoder.createJob({
      parent: transcoder.locationPath(PROJECT, REGION),
      job: {
        inputUri: `gs://${BUCKET}/${c.storageRef}`,
        outputUri: `gs://${BUCKET}/videos/${c.contentId}/${c.videoId}/hls/`,
        config: { ...buildJobConfig(), pubsubDestination: { topic: TOPIC } },
      },
    });
    const uuid = job.name.split("/").pop();
    await db.doc(`transcodeJobs/${uuid}`).set({ contentId: c.contentId, videoId: c.videoId, jobName: job.name, createdAt: FieldValue.serverTimestamp() });
    await c.ref.set({ status: "processing", jobState: "SUBMITTED", jobName: job.name }, { merge: true });
    console.log(`    submitted ${job.name}`);
    submitted++;
  } catch (e) {
    await c.ref.set({ jobState: FieldValue.delete(), transcodeError: String(e?.message || e) }, { merge: true });
    console.log(`    FAILED: ${e?.message || e}`);
    failed++;
  }
  await new Promise((r) => setTimeout(r, THROTTLE_MS));
}

console.log(`\nDONE — submitted ${submitted}, skipped ${skipped}, failed ${failed}`);
process.exit(0);
