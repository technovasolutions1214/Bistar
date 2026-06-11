// CDN proxy for Bistar video assets.
//
// Fronts gs://bistar-app.firebasestorage.app so the browser sees
// https://cdn.bistar.app/<path> and the HLS segments cache at the edge.
// Master.m3u8 references relative child playlists and .ts segments, so all of
// them resolve under this same hostname — no manifest rewriting needed.

const BUCKET = "bistar-app.firebasestorage.app";
const ORIGIN = `https://storage.googleapis.com/${BUCKET}`;

const SEGMENT_CACHE_TTL = 31536000; // 1 year for immutable .ts segments
const PLAYLIST_CACHE_TTL = 60;      // 1 minute for .m3u8 playlists
const DEFAULT_CACHE_TTL = 300;      // 5 minutes for anything else (thumbnails, etc.)

function chooseTtl(pathname) {
  if (pathname.endsWith(".ts")) return SEGMENT_CACHE_TTL;
  if (pathname.endsWith(".m3u8")) return PLAYLIST_CACHE_TTL;
  return DEFAULT_CACHE_TTL;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-None-Match, If-Modified-Since",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, _env, ctx) {
    const url = new URL(request.url);

    // CORS preflight — HLS.js and some players send OPTIONS when the XHR adds
    // a Range or If-* header. Without a 2xx response here the browser cancels
    // the actual GET and manifest parsing never starts.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "Allow": "GET, HEAD, OPTIONS" },
      });
    }

    // Normalize cache key: drop query string so signed-URL-style params
    // (none expected here, but guard anyway) don't fragment the cache.
    const cacheKey = new Request(`${url.origin}${url.pathname}`, request);
    const cache = caches.default;

    let response = await cache.match(cacheKey);
    if (response) return response;

    const originUrl = `${ORIGIN}${url.pathname}`;
    // Do not use cf: { cacheEverything } — that caches the raw origin response
    // and then serves subsequent requests WITHOUT invoking the Worker, so our
    // CORS header additions never make it onto cache hits. Cache the modified
    // Response manually via caches.default.put() instead.
    const originRes = await fetch(originUrl, { method: request.method });

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
