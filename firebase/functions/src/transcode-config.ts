/**
 * Shared GCP Transcoder configuration + helpers.
 *
 * Imported by the Cloud Functions (onVideoUploaded / onTranscodeComplete /
 * transcodeWatchdog). The standalone backfill script
 * (scripts/transcode-backfill.mjs) keeps an IN-SYNC copy of the rendition
 * ladder + buildJobConfig — if you change the ladder here, change it there too.
 */
import type { protos } from "@google-cloud/video-transcoder";

type IJobConfig = protos.google.cloud.video.transcoder.v1.IJobConfig;

// bistar-app, ASIA-SOUTH1. Transcoder job location, the Pub/Sub function region
// and the bucket are ALL asia-south1 to avoid cross-region egress.
export const PROJECT = "bistar-app";
export const REGION = "asia-south1";
export const BUCKET = "bistar-app.firebasestorage.app";
export const PUBSUB_TOPIC = "transcoder-job-notifications";
export const CDN_DOMAIN = process.env.CDN_DOMAIN || "cdn.bistar.app";

export interface Rendition {
  key: string; // "360p" → child playlist 360p.m3u8
  width: number;
  height: number;
  bitrateBps: number;
}

// Mirrors the old ffmpeg ladder/bitrates (360p 800k, 720p 2.5M, 1080p 5M).
export const RENDITIONS: Rendition[] = [
  { key: "360p", width: 640, height: 360, bitrateBps: 800_000 },
  { key: "720p", width: 1280, height: 720, bitrateBps: 2_500_000 },
  { key: "1080p", width: 1920, height: 1080, bitrateBps: 5_000_000 },
];

export const QUALITIES = RENDITIONS.map((r) => r.key);

/**
 * Builds an adaptive HLS JobConfig.
 *
 * DEFECT 1: each muxStream sets segmentSettings.individualSegments = true so
 * Transcoder emits SEPARATE small .ts files (not one big file addressed by
 * #EXT-X-BYTERANGE). The Cloudflare worker ignores client Range headers, so a
 * byte-range manifest is unplayable through it; individual segments are cached
 * and served correctly.
 */
export function buildJobConfig(): IJobConfig {
  const elementaryStreams: protos.google.cloud.video.transcoder.v1.IElementaryStream[] = [
    {
      key: "audio0",
      audioStream: { codec: "aac", bitrateBps: 128_000, sampleRateHertz: 48_000, channelCount: 2 },
    },
  ];
  const muxStreams: protos.google.cloud.video.transcoder.v1.IMuxStream[] = [];

  for (const r of RENDITIONS) {
    elementaryStreams.push({
      key: `video_${r.key}`,
      videoStream: {
        h264: {
          widthPixels: r.width,
          heightPixels: r.height,
          bitrateBps: r.bitrateBps,
          frameRate: 30,
          // GOP aligned to the 6s segment so segments split cleanly.
          gopDuration: { seconds: 6 },
        },
      },
    });
    muxStreams.push({
      key: r.key, // → child playlist <key>.m3u8 (360p.m3u8 / 720p.m3u8 / 1080p.m3u8)
      container: "ts",
      elementaryStreams: [`video_${r.key}`, "audio0"],
      segmentSettings: {
        segmentDuration: { seconds: 6 },
        individualSegments: true, // MANDATORY — see DEFECT 1 above
      },
    });
  }

  return {
    elementaryStreams,
    muxStreams,
    manifests: [
      { fileName: "master.m3u8", type: "HLS", muxStreams: RENDITIONS.map((r) => r.key) },
    ],
  };
}

// gs:// output prefix — Transcoder requires a trailing slash.
export function outputUriFor(contentId: string, videoId: string): string {
  return `gs://${BUCKET}/videos/${contentId}/${videoId}/hls/`;
}

export function videoUrlFor(contentId: string, videoId: string): string {
  return `https://${CDN_DOMAIN}/videos/${contentId}/${videoId}/hls/master.m3u8`;
}

// The v1 API assigns its own UUID; the completion message carries only job.name
// (projects/.../locations/.../jobs/<uuid>). Parse the UUID for the reverse index.
export function jobUuidFromName(name: string): string {
  return name.split("/").pop() || name;
}
