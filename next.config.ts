import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next 16 Cache Components: enables the stable `use cache` directive
  // together with cacheLife / cacheTag. See src/lib/cache.ts.
  cacheComponents: true,
};

export default nextConfig;
