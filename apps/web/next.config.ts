import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@novaflix/shared", "@novaflix/firebase-config", "@novaflix/ui"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
