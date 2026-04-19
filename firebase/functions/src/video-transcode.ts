import { onObjectFinalized } from "firebase-functions/v2/storage";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

interface QualityPreset {
  name: string;
  width: number;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
}

const QUALITY_PRESETS: QualityPreset[] = [
  { name: "360p", width: 640, height: 360, videoBitrate: "800k", audioBitrate: "96k" },
  { name: "720p", width: 1280, height: 720, videoBitrate: "2500k", audioBitrate: "128k" },
  { name: "1080p", width: 1920, height: 1080, videoBitrate: "5000k", audioBitrate: "192k" },
];

function transcodeToHLS(
  inputPath: string,
  outputDir: string,
  preset: QualityPreset,
): Promise<string> {
  const qualityDir = path.join(outputDir, preset.name);
  fs.mkdirSync(qualityDir, { recursive: true });
  const playlistPath = path.join(qualityDir, "playlist.m3u8");

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`,
        `-b:v ${preset.videoBitrate}`,
        `-b:a ${preset.audioBitrate}`,
        "-c:v libx264",
        "-preset fast",
        "-c:a aac",
        "-hls_time 6",
        "-hls_list_size 0",
        "-hls_segment_filename",
        path.join(qualityDir, "segment_%03d.ts"),
        "-f hls",
      ])
      .output(playlistPath)
      .on("end", () => resolve(qualityDir))
      .on("error", (err) => reject(err))
      .run();
  });
}

async function uploadDirectory(localDir: string, destPrefix: string): Promise<void> {
  const files = fs.readdirSync(localDir);
  const uploads = files.map((file) => {
    const localPath = path.join(localDir, file);
    const destPath = `${destPrefix}/${file}`;
    return bucket.upload(localPath, {
      destination: destPath,
      metadata: {
        contentType: file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
      },
    });
  });
  await Promise.all(uploads);
}

function buildMasterPlaylist(presets: QualityPreset[]): string {
  let playlist = "#EXTM3U\n";
  for (const p of presets) {
    const bandwidth = parseInt(p.videoBitrate) * 1000;
    playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${p.width}x${p.height}\n`;
    playlist += `${p.name}/playlist.m3u8\n`;
  }
  return playlist;
}

export const onVideoUploaded = onObjectFinalized(
  { timeoutSeconds: 540, memory: "2GiB", region: "asia-south1" },
  async (event) => {
    const filePath = event.data.name;
    if (!filePath) return;

    const match = filePath.match(/^videos\/([^/]+)\/([^/]+)\/original\/(.+)$/);
    if (!match) return;

    const contentId = match[1];
    const videoId = match[2];
    const fileName = match[3];

    const tempDir = path.join(os.tmpdir(), `novaflix-${contentId}-${videoId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const localInput = path.join(tempDir, fileName);
    const hlsOutputDir = path.join(tempDir, "hls");
    fs.mkdirSync(hlsOutputDir, { recursive: true });

    const videoDocRef = db.doc(`content/${contentId}/videos/${videoId}`);

    try {
      await videoDocRef.set({ status: "processing" }, { merge: true });
      await bucket.file(filePath).download({ destination: localInput });

      for (const preset of QUALITY_PRESETS) {
        await transcodeToHLS(localInput, hlsOutputDir, preset);
      }

      const masterContent = buildMasterPlaylist(QUALITY_PRESETS);
      const masterPath = path.join(hlsOutputDir, "master.m3u8");
      fs.writeFileSync(masterPath, masterContent);

      const destPrefix = `videos/${contentId}/${videoId}/transcoded`;

      await bucket.upload(masterPath, {
        destination: `${destPrefix}/master.m3u8`,
        metadata: { contentType: "application/vnd.apple.mpegurl" },
      });

      for (const preset of QUALITY_PRESETS) {
        const qualityDir = path.join(hlsOutputDir, preset.name);
        await uploadDirectory(qualityDir, `${destPrefix}/${preset.name}`);
      }

      const cdnDomain = process.env.CDN_DOMAIN || "";
      const videoUrl = cdnDomain
        ? `https://${cdnDomain}/${destPrefix}/master.m3u8`
        : `https://storage.googleapis.com/${bucket.name}/${destPrefix}/master.m3u8`;

      await videoDocRef.set(
        {
          status: "ready",
          videoUrl,
          qualities: QUALITY_PRESETS.map((p) => p.name),
          transcodedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      logger.info(`Transcoding complete for ${contentId}/${videoId}`);
    } catch (error) {
      logger.error(`Transcoding failed for ${contentId}/${videoId}`, error);
      await videoDocRef.set(
        {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
);
