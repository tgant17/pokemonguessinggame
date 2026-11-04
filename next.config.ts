import type { NextConfig } from "next";
import { previewWorkerName } from "./src/lib/previewRooms.ts";

// Vercel preview builds talk to their branch's own room server (see src/lib/previewRooms.ts) once
// PREVIEW_PARTY_DOMAIN is set in Vercel. Other builds use NEXT_PUBLIC_PARTY_HOST as before.
const { VERCEL_ENV, VERCEL_GIT_COMMIT_REF, PREVIEW_PARTY_DOMAIN } = process.env;
const previewPartyHost =
  VERCEL_ENV === "preview" && VERCEL_GIT_COMMIT_REF && PREVIEW_PARTY_DOMAIN
    ? `${previewWorkerName(VERCEL_GIT_COMMIT_REF)}.${PREVIEW_PARTY_DOMAIN}`
    : undefined;

const nextConfig: NextConfig = {
  ...(previewPartyHost && { env: { NEXT_PUBLIC_PARTY_HOST: previewPartyHost } }),
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
