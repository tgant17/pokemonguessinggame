import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser code only sees variables starting with NEXT_PUBLIC_, so the PREVIEW_ENVIRONMENT flag
  // (which turns on multiplayer in previews, see src/hooks/useRoomGame.ts) is passed through here.
  env: {
    PREVIEW_ENVIRONMENT: process.env.PREVIEW_ENVIRONMENT ?? "",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "assets.pokemon.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
