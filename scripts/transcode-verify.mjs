// Verify transcoded HLS end-to-end:
//  - manifest + child playlists have NO #EXT-X-BYTERANGE (DEFECT 1)
//  - segments are separate small files
//  - bucket .ts count == sum of playlist segment counts
//  - via the CDN: master, each child playlist, and the FIRST/MIDDLE/LAST
//    segment of every rendition return 200; segments are small (MBs);
//    a 2nd GET reports cf-cache-status: HIT (GET — the Cache API ignores HEAD)
//
// Run in Cloud Shell as owner (ADC):
//   cd ~/bs && npm i firebase-admin
//   node transcode-verify.mjs <contentId> <videoId>   # one (use for the canary)
//   node transcode-verify.mjs --all                   # every "ready" video
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const PROJECT = "bistar-app";
const BUCKET = "bistar-app.firebasestorage.app";
const CDN = "https://cdn.bistar.app";
const MAX_SEG_BYTES = 60 * 1024 * 1024; // a real segment is single-digit MBs

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);

const args = process.argv.slice(2);
const ALL = args.includes("--all");

async function targets() {
  if (ALL) {
    const snap = await db.collectionGroup("videos").where("status", "==", "ready").get();
    return snap.docs.map((d) => { const p = d.ref.path.split("/"); return { contentId: p[1], videoId: p[3] }; });
  }
  const [contentId, videoId] = args;
  if (!contentId || !videoId) {
    console.error("usage: node transcode-verify.mjs <contentId> <videoId> | --all");
    process.exit(1);
  }
  return [{ contentId, videoId }];
}

function parsePlaylist(text) {
  const lines = text.split("\n").map((l) => l.trim());
  return {
    byteRange: lines.some((l) => l.startsWith("#EXT-X-BYTERANGE")),
    segs: lines.filter((l) => l && !l.startsWith("#") && l.endsWith(".ts")),
    children: lines.filter((l) => l && !l.startsWith("#") && l.endsWith(".m3u8")),
  };
}

async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} on ${url}`);
  return r.text();
}

// GET (not HEAD) — Cloudflare's Cache API does not store HEAD responses.
async function get(url) {
  const r = await fetch(url);
  return { ok: r.ok, status: r.status, len: Number(r.headers.get("content-length") || 0), cache: r.headers.get("cf-cache-status") };
}

let pass = 0, fail = 0;
for (const t of await targets()) {
  const base = `${CDN}/videos/${t.contentId}/${t.videoId}/hls`;
  const errs = [];
  try {
    const master = await getText(`${base}/master.m3u8`);
    if (master.includes("#EXT-X-BYTERANGE")) errs.push("master.m3u8 has #EXT-X-BYTERANGE");
    const { children } = parsePlaylist(master);
    if (children.length === 0) errs.push("master lists no child playlists");

    let playlistSegTotal = 0;
    for (const child of children) {
      const pl = await getText(`${base}/${child}`);
      const { byteRange, segs } = parsePlaylist(pl);
      if (byteRange) errs.push(`${child} has #EXT-X-BYTERANGE`);
      if (segs.length === 0) errs.push(`${child} has 0 segments`);
      playlistSegTotal += segs.length;

      const picks = [segs[0], segs[Math.floor(segs.length / 2)], segs[segs.length - 1]].filter(Boolean);
      for (const seg of picks) {
        const u = `${base}/${seg}`;
        const a = await get(u);
        if (!a.ok) errs.push(`segment ${seg} → HTTP ${a.status}`);
        if (a.len > MAX_SEG_BYTES) errs.push(`segment ${seg} too big (${(a.len / 1048576).toFixed(1)}MB)`);
        const b = await get(u); // 2nd GET → expect edge cache HIT
        if (b.cache && b.cache.toUpperCase() !== "HIT") errs.push(`segment ${seg} cf-cache=${b.cache} (expected HIT)`);
      }
    }

    const [files] = await bucket.getFiles({ prefix: `videos/${t.contentId}/${t.videoId}/hls/` });
    const tsCount = files.filter((f) => f.name.endsWith(".ts")).length;
    if (tsCount !== playlistSegTotal) errs.push(`bucket .ts=${tsCount} != playlist segments=${playlistSegTotal}`);

    if (errs.length === 0) {
      console.log(`✓ ${t.contentId}/${t.videoId}  renditions=${children.length} segs=${playlistSegTotal} ts=${tsCount}`);
      pass++;
    } else {
      console.log(`✗ ${t.contentId}/${t.videoId}\n    - ${errs.join("\n    - ")}`);
      fail++;
    }
  } catch (e) {
    console.log(`✗ ${t.contentId}/${t.videoId} — ${e.message}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
