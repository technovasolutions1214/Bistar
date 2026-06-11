import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bistar/shared", "@bistar/firebase-config", "@bistar/ui"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
