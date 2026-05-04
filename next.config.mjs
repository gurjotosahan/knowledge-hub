/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@lancedb/lancedb"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "ngrok-skip-browser-warning", value: "true" }],
      },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "via.placeholder.com" },
      { protocol: "https", hostname: "placehold.co" },
    ],
  },

  webpack: (config) => {
    // pdfjs-dist references `canvas` as an optional dep — alias it away
    // so webpack doesn't warn about a missing native module
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
