const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  outputFileTracing: false,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        https: false,
        http: false,
        net: false,
        tls: false,
        path: false,
        stream: false,
        crypto: false,
      };
    }
    config.externals = [...(config.externals || []), { canvas: "canvas" }];
    return config;
  },
};

module.exports = (phase) => {
  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    return baseConfig;
  }

  const apiProxyTarget = process.env.NEXT_DEV_API_PROXY_TARGET || 'http://localhost:9091';

  return {
    ...baseConfig,
    // Dev-only: avoid Next redirecting /api/foo -> /api/foo/ before proxying to the Go backend.
    // Production/static export keeps baseConfig.trailingSlash=true and relies on the deployment gateway for /api.
    trailingSlash: false,
    async rewrites() {
      return {
        beforeFiles: [
          {
            source: '/api/:path*',
            destination: `${apiProxyTarget}/api/:path*`,
          },
        ],
      };
    },
  };
};
