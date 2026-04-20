"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@novaflix/firebase-config";

// Loads the Meta Pixel base code once, gated on settings/general.metaPixelId.
// When the field is missing or blank, no script is injected and window.fbq is
// never defined, so every call to lib/pixel.track is a no-op.
//
// PageView fires on every route change — including the first paint — so the
// admin doesn't need to wire that anywhere else. Other events live at their
// own call sites.
export function PixelLoader() {
  const [pixelId, setPixelId] = useState<string | null>(null);
  const pathname = usePathname();

  // Fetch the configured pixel ID once.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDoc(doc(db(), "settings", "general"));
        if (cancelled) return;
        const id = String(snap.data()?.metaPixelId ?? "").trim();
        setPixelId(id || null);
      } catch (err) {
        console.warn("PixelLoader: failed to load settings/general", err);
        if (!cancelled) setPixelId(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Inject the Meta Pixel base snippet exactly once when we have a pixel ID.
  useEffect(() => {
    if (!pixelId) return;
    if (document.getElementById("meta-pixel-base")) return;

    const s = document.createElement("script");
    s.id = "meta-pixel-base";
    // Standard Meta Pixel base code (https://developers.facebook.com/docs/meta-pixel/get-started).
    s.text = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');`;
    document.head.appendChild(s);

    // Plain-img fallback for users with JS disabled. They never load React, so
    // this branch effectively only matters if a crawler renders the HTML.
    const ns = document.createElement("noscript");
    ns.innerHTML = `<img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/>`;
    ns.id = "meta-pixel-noscript";
    document.head.appendChild(ns);
  }, [pixelId]);

  // Fire PageView on every route change (including the initial one). The base
  // snippet does not auto-track on init; we control PageView entirely here.
  useEffect(() => {
    if (!pixelId) return;
    if (typeof window.fbq !== "function") return;
    window.fbq("track", "PageView");
  }, [pixelId, pathname]);

  return null;
}
