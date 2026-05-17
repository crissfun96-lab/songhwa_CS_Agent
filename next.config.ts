import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Silence multi-lockfile warning when developing in ~/songhwa_CS_Agent
  // (parent ~/package-lock.json exists from other home-dir Node experiments).
  // Pins Turbopack's workspace root to this repo, not ~/.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
