/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Match Vercel function region to Neon DB region (Singapore) to avoid
  // cross-region DB latency on every query. ~200-400ms saved per query.
  // Override per-route with `export const preferredRegion` if needed.
  regions: ["sin1"],
};

export default config;
