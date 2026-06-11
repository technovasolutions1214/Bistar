import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bistar/shared", "@bistar/firebase-config", "@bistar/ui"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        // Firebase Auth's signInWithPopup polls popup.closed to know when the
        // OAuth window closes. The browser's default cross-origin isolation
        // blocks that read once the popup navigates to accounts.google.com,
        // triggering the "Cross-Origin-Opener-Policy policy would block the
        // window.closed call" warning and sometimes failing sign-in. Allowing
        // popups to retain the opener relationship fixes signInWithPopup
        // without giving up COOP's protection for the main document.
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
};

export default nextConfig;
