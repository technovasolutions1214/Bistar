import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { TranscoderServiceClient } from "@google-cloud/video-transcoder";
import {
  REGION,
  BUCKET,
  PUBSUB_TOPIC,
  QUALITIES,
  videoUrlFor,
  jobUuidFromName,
} from "./transcode-config";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const bucket = admin.storage().bucket(BUCKET);
const transcoder = new TranscoderServiceClient();

const MAKE_PUBLIC_CONCURRENCY = 16;

/**
 * Transcoder writes PRIVATE object ACLs, but the CDN worker fetches the bucket
 * anonymously over storage.googleapis.com — so every output object under
 * videos/{c}/{v}/hls/ must be made public. Originals stay private. There can be
 * hundreds/thousands of segments → paginate + bounded concurrency. Requires
 * fine-grained ACLs on the bucket (verified: UBLA disabled).
 */
async function makeHlsPublic(contentId: string, videoId: string): Promise<number> {
  const prefix = `videos/${contentId}/${videoId}/hls/`;
  let made = 0;
  let pageToken: string | undefined;

  do {
    const [files, nextQuery] = await bucket.getFiles({
      prefix,
      autoPaginate: false,
      maxResults: 1000,
      pageToken,
    });

    for (let i = 0; i < files.length; i += MAKE_PUBLIC_CONCURRENCY) {
      const batch = files.slice(i, i + MAKE_PUBLIC_CONCURRENCY);
      await Promise.all(batch.map((f) => f.makePublic()));
      made += batch.length;
    }

    pageToken = (nextQuery as { pageToken?: string } | null)?.pageToken;
  } while (pageToken);

  return made;
}

async function finalizeReady(contentId: string, videoId: string): Promise<void> {
  const made = await makeHlsPublic(contentId, videoId);
  await db.doc(`content/${contentId}/videos/${videoId}`).set(
    {
      status: "ready",
      videoUrl: videoUrlFor(contentId, videoId),
      qualities: QUALITIES,
      jobState: "DONE",
      transcodedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  logger.info(`finalizeReady: ${contentId}/${videoId} ready (${made} objects public)`);
}

async function finalizeFailed(
  contentId: string,
  videoId: string,
  error: string,
): Promise<void> {
  await db.doc(`content/${contentId}/videos/${videoId}`).set(
    {
      status: "failed",
      jobState: "FAILED",
      error,
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  logger.error(`finalizeFailed: ${contentId}/${videoId} — ${error}`);
}

/**
 * Pub/Sub completion trigger. The message is a JobResult: {job:{name,state,error}}.
 * Map the job UUID → video doc via the reverse-index doc, then flip status.
 * retry:false — a poison message must not loop; the watchdog reconciles misses.
 */
export const onTranscodeComplete = onMessagePublished(
  { topic: PUBSUB_TOPIC, region: REGION, memory: "512MiB", timeoutSeconds: 300, retry: false },
  async (event) => {
    const payload = event.data.message.json as
      | { job?: { name?: string; state?: string; error?: unknown } }
      | undefined;
    const job = payload?.job;
    if (!job?.name) {
      logger.warn("onTranscodeComplete: message without job.name", payload);
      return;
    }

    const uuid = jobUuidFromName(job.name);
    const idxRef = db.doc(`transcodeJobs/${uuid}`);
    const idx = await idxRef.get();
    if (!idx.exists) {
      logger.warn(`onTranscodeComplete: no reverse-index for job ${uuid}`);
      return;
    }
    const { contentId, videoId } = idx.data() as { contentId: string; videoId: string };

    const cur = (await db.doc(`content/${contentId}/videos/${videoId}`).get()).data() ?? {};
    if (cur.status === "ready") {
      await idxRef.delete().catch(() => undefined);
      return; // idempotent — already finalized
    }

    if (job.state === "SUCCEEDED") {
      await finalizeReady(contentId, videoId);
      await idxRef.delete().catch(() => undefined);
    } else if (job.state === "FAILED") {
      await finalizeFailed(contentId, videoId, JSON.stringify(job.error ?? "unknown"));
      await idxRef.delete().catch(() => undefined);
    } else {
      logger.info(`onTranscodeComplete: job ${uuid} state ${job.state} — ignoring`);
    }
  },
);

/**
 * Reconcile missed Pub/Sub messages + hung jobs every 30 min. Scans the videos
 * collection group, finds still-in-flight SUBMITTED jobs, polls getJob, and
 * finalizes any that already SUCCEEDED/FAILED.
 *
 * Fetch-all + in-memory filter (no `.where()`) on purpose: a collection-group
 * query filtered by a field requires a COLLECTION_GROUP single-field index
 * (the automatic single-field indexes are collection-scoped only). At this
 * library's scale a full scan every 30 min is negligible; add a collection-
 * group index on jobState and re-introduce the filter if it ever grows large.
 */
export const transcodeWatchdog = onSchedule(
  { schedule: "every 30 minutes", region: REGION, memory: "512MiB", timeoutSeconds: 300 },
  async () => {
    const snap = await db.collectionGroup("videos").get();

    let fixed = 0;
    let inFlight = 0;
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (data.jobState !== "SUBMITTED" || data.status === "ready") continue;
      const jobName: string | undefined = data.jobName;
      if (!jobName) continue;
      inFlight++;

      // path: content/{contentId}/videos/{videoId}
      const parts = docSnap.ref.path.split("/");
      const contentId = parts[1];
      const videoId = parts[3];

      try {
        const [job] = await transcoder.getJob({ name: jobName });
        if (job.state === "SUCCEEDED") {
          await finalizeReady(contentId, videoId);
          fixed++;
        } else if (job.state === "FAILED") {
          await finalizeFailed(contentId, videoId, JSON.stringify(job.error ?? "unknown"));
          fixed++;
        }
      } catch (err) {
        logger.warn(`transcodeWatchdog: getJob failed for ${jobName}`, err);
      }
    }

    logger.info(`transcodeWatchdog: reconciled ${fixed} of ${inFlight} in-flight`);
  },
);
