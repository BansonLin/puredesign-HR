import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // lib/auth/guard.ts uses forbidden() → 403 + app/forbidden.tsx (DECISIONS D-13).
    authInterrupts: true,
  },
};

export default nextConfig;
