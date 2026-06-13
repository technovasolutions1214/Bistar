import { onObjectFinalized } from "firebase-functions/v2/storage";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { TranscoderServiceClient } from "@google-cloud/video-transcoder";
import {
  PROJECT,
  REGION,
  BUCKET,
  PUBSUB_TOPIC,
  buildJobConfig,
  outputUriFor,
  jobUuidFromName,
} from "./transcode-config";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const transcoder = new TranscoderServiceClient();

/**
 * Storage finalize on videos/{contentId}/{videoId}/original/* → submit a GCP
 * Transcoder job that outputs adaptive HLS to videos/{c}/{v}/hls/. Lightweight:
 * it only submits the job and returns; onTranscodeComplete (Pub/Sub) flips the
 * doc to "ready". Stays "processing" meanwhile, so the watch page keeps serving
 * the signed-URL fallback until the transcode is done.
 */
export const onVideoUploaded = onObjectFinalized(
  { memory: "256MiB", timeoutSeconds: 120, region: REGION, bucket: BUCKET },
  async (event) => {
    const filePath = event.data.name;
    if (!filePath) return;

    const match = filePath.match(/^videos\/([^/]+)\/([^/]+)\/original\/(.+)$/);
    if (!match) return;
    const contentId = match[1];
    const videoId = match[2];

    const videoRef = db.doc(`content/${contentId}/videos/${videoId}`);

    // Idempotency claim. Storage triggers are at-least-once and the v1 API has
    // no custom job id, so a duplicate delivery would create a SECOND billed
    // job. Claim the submit in a transaction BEFORE createJob.
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(videoRef);
      const data = snap.data() ?? {};
      if (
        data.jobState === "CLAIMING" ||
        data.jobState === "SUBMITTED" ||
        data.jobState === "DONE" ||
        data.status === "ready"
      ) {
        return false;
      }
      tx.set(videoRef, { status: "processing", jobState: "CLAIMING" }, { merge: true });
      return true;
    });

    if (!claimed) {
      logger.info(`onVideoUploaded: skipping duplicate for ${contentId}/${videoId}`);
      return;
    }

    const inputUri = `gs://${BUCKET}/${filePath}`;
    const outputUri = outputUriFor(contentId, videoId);

    try {
      const [job] = await transcoder.createJob({
        parent: transcoder.locationPath(PROJECT, REGION),
        job: {
          inputUri,
          outputUri,
          config: {
            ...buildJobConfig(),
            pubsubDestination: {
              topic: `projects/${PROJECT}/topics/${PUBSUB_TOPIC}`,
            },
          },
        },
      });

      const jobName = job.name ?? "";
      const uuid = jobUuidFromName(jobName);

      // Reverse index: the completion message is a JobResult with only
      // {job:{name,state,error}} — no output path — so map UUID → video doc.
      await db.doc(`transcodeJobs/${uuid}`).set({
        contentId,
        videoId,
        jobName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await videoRef.set(
        { status: "processing", jobState: "SUBMITTED", jobName },
        { merge: true },
      );

      logger.info(`onVideoUploaded: submitted ${jobName} for ${contentId}/${videoId}`);
    } catch (error) {
      logger.error(`onVideoUploaded: createJob failed for ${contentId}/${videoId}`, error);
      // Release the claim so a retry / the backfill can resubmit. Keep status
      // "processing" so the signed-URL fallback keeps serving in the meantime.
      await videoRef.set(
        {
          jobState: admin.firestore.FieldValue.delete(),
          transcodeError: error instanceof Error ? error.message : String(error),
        },
        { merge: true },
      );
    }
  },
);
