"use client";

import { useEffect, useState } from "react";
import { onPixelDebug, type PixelDebugEntry } from "@/lib/pixel";

/**
 * On-page list of every Meta Pixel event this page has fired, shown when the
 * URL carries `?pixelDebug=1`.
 *
 * This is the zero-setup answer to "is the new pixel actually firing?" — no
 * browser extension, no network tab, and it works on a phone, which is where
 * most ad traffic lands and where the Meta Pixel Helper does not exist.
 *
 * It renders nothing unless explicitly asked for, writes nothing anywhere, and
 * reads only the in-memory feed from lib/pixel.
 */
export function PixelDebugOverlay({ pixelId, slug }: { pixelId: string | null; slug: string | null }) {
  const [entries, setEntries] = useState<PixelDebugEntry[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => onPixelDebug(setEntries), []);

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 99999,
        maxWidth: 360,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.5,
        color: "#e7e7e7",
        background: "rgba(10,10,12,0.94)",
        border: "1px solid #3a3a42",
        borderRadius: 10,
        boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          borderBottom: open ? "1px solid #3a3a42" : "none",
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        Meta Pixel · {pixelId ? `${pixelId}` : "not loaded"}
        {slug ? ` (${slug})` : ""} · {entries.length} event{entries.length === 1 ? "" : "s"}
        <span style={{ float: "right", opacity: 0.6 }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div style={{ maxHeight: 260, overflowY: "auto", padding: "6px 10px 8px" }}>
          {entries.length === 0 ? (
            <p style={{ margin: "4px 0", opacity: 0.6 }}>No events fired yet on this page.</p>
          ) : (
            [...entries].reverse().map((e, i) => (
              <div key={`${e.at}-${i}`} style={{ padding: "4px 0", borderBottom: "1px solid #24242a" }}>
                <span style={{ color: e.sent ? "#7ee787" : "#ff7b72", fontWeight: 600 }}>
                  {e.sent ? "✓" : "✗"} {e.event}
                </span>
                <span style={{ opacity: 0.55, marginLeft: 6 }}>
                  {new Date(e.at).toLocaleTimeString()}
                </span>
                {!e.sent && (
                  <div style={{ color: "#ff7b72", opacity: 0.9 }}>
                    fbq was not loaded — event dropped
                  </div>
                )}
                {e.eventID && <div style={{ opacity: 0.6 }}>eventID: {e.eventID}</div>}
                {e.params && Object.keys(e.params).length > 0 && (
                  <div style={{ opacity: 0.75, wordBreak: "break-all" }}>
                    {JSON.stringify(e.params)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
