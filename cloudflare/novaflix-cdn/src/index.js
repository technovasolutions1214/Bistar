// CDN proxy for NovaFlix video assets.
//
// Fronts gs://novaflix-584d4.firebasestorage.app so the browser sees
// https://cdn.novaflix.app/<path> and the HLS segments cache at the edge.
// Master.m3u8 references relative child playlists and .ts segments, so all of
// them resolve under this same hostname — no manifest rewriting needed.

const BUCKET = "novaflix-584d4.firebasestorage.app";
const ORIGIN = `https://storage.googleapis.com/${BUCKET}`;

const SEGMENT_CACHE_TTL = 31536000; // 1 year for immutable .ts segments
const PLAYLIST_CACHE_TTL = 60;      // 1 minute for .m3u8 playlists
const DEFAULT_CACHE_TTL = 300;      // 5 minutes for anything else (thumbnails, etc.)

function chooseTtl(pathname) {
  if (pathname.endsWith(".ts")) return SEGMENT_CACHE_TTL;
  if (pathname.endsWith(".m3u8")) return PLAYLIST_CACHE_TTL;
  return DEFAULT_CACHE_TTL;
}

export default {
  async fetch(request, _env, ctx) {
    const url = new URL(request.url);

    // Only serve GET/HEAD — we never accept uploads through the CDN.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "Allow": "GET, HEAD" },
      });
    }

    // Normalize cache key: drop query string so signed-URL-style params
    // (none expected here, but guard anyway) don't fragment the cache.
    const cacheKey = new Request(`${url.origin}${url.pathname}`, request);
    const cache = caches.default;

    let response = await cache.match(cacheKey);
    if (response) return response;

    const originUrl = `${ORIGIN}${url.pathname}`;
    const originRes = await fetch(originUrl, {
      method: request.method,
      cf: {
        // Tell CF's network layer how long to keep the object at the edge.
        cacheEverything: true,
        cacheTtl: chooseTtl(url.pathname),
      },
    });

    // Clone so we can mutate headers and still return.
    const headers = new Headers(originRes.headers);
    const ttl = chooseTtl(url.pathname);
    if (url.pathname.endsWith(".ts")) {
      headers.set("Cache-Control", `public, max-age=${ttl}, immutable`);
    } else {
      headers.set("Cache-Control", `public, max-age=${ttl}`);
    }
    // Permit HLS.js in any origin to read manifest/segments.
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, HEAD");
    headers.set("Timing-Allow-Origin", "*");

    response = new Response(originRes.body, {
      status: originRes.status,
      statusText: originRes.statusText,
      headers,
    });

    if (originRes.ok) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  },
};
