"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { captureAttribution, getAttribution } from "@/lib/attribution";

// Loads the right Meta Pixel and fires PageView on every route change.
//
// Multi-pixel: reads the public `pixels` config and picks the pixel for the
// visitor's campaign slug (?c=… or the stored cookie), falling back to the
// default pixel. If no pixels are configured it falls back to the legacy single
// settings/general.metaPixelId, so existing setups keep working.
interface PixelDoc {
  slug: string;
  pixelId?: string;
  isDefault?: boolean;
}

export function PixelLoader() {
  const [pixelId, setPixelId] = useState<string | null>(null);
  const pathname = usePathname();

  // Resolve the active pixel + capture attribution, once per load.
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      try {
        const snap = await getDocs(collection(db(), "pixels"));
        const pixels: PixelDoc[] = snap.docs.map((d) => {
          const data = d.data();
          return { slug: d.id, pixelId: data.pixelId as string | undefined, isDefault: !!data.isDefault };
        });

        let chosen: PixelDoc | null = null;
        if (pixels.length > 0) {
          const slug = new URLSearchParams(window.location.search).get("c") || getAttribution().pixelSlug;
          chosen =
            (slug ? pixels.find((p) => p.slug === slug) : undefined) ||
            pixels.find((p) => p.isDefault) ||
            pixels[0];
        } else {
          // Legacy single-pixel fallback.
          const gen = await getDoc(doc(db(), "settings", "general"));
          const id = String(gen.data()?.metaPixelId ?? "").trim();
          if (id) chosen = { slug: "default", pixelId: id };
        }

        if (cancelled) return;
        captureAttribution({ pixelSlug: chosen?.slug, pixelId: chosen?.pixelId });
        setPixelId(chosen?.pixelId || null);
      } catch (err) {
        console.warn("PixelLoader: failed to resolve pixel", err);
      }
    }
    resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  // Inject the Meta Pixel base snippet once we have an id.
  useEffect(() => {
    if (!pixelId) return;
    if (document.getElementById("meta-pixel-base")) return;

    const s = document.createElement("script");
    s.id = "meta-pixel-base";
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

    const ns = document.createElement("noscript");
    ns.innerHTML = `<img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/>`;
    ns.id = "meta-pixel-noscript";
    document.head.appendChild(ns);
  }, [pixelId]);

  // PageView on every route change (including the first).
  useEffect(() => {
    if (!pixelId) return;
    if (typeof window.fbq !== "function") return;
    window.fbq("track", "PageView");
  }, [pixelId, pathname]);

  return null;
}
