import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second dev server (e.g. the one the UI tests use) can set NEXT_DIST_DIR to build into its
  // own folder. Two `next dev` servers sharing .next overwrite each other's files and break pages.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
