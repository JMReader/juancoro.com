import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.wgsl": {
        loaders: ["@vgpu/wgsl/loader-webpack"],
        as: "*.js",
      },
    },
  },
  webpack(config) {
    config.module ??= {};
    config.module.rules ??= [];
    config.module.rules.push({
      test: /\.wgsl$/,
      loader: "@vgpu/wgsl/loader-webpack",
      options: { minify: true },
    });
    return config;
  },
  async redirects() {
    return [
      { source: "/", destination: "/blog/como-ganar-un-hackathon", permanent: false },
      { source: "/blog", destination: "/blog/como-ganar-un-hackathon", permanent: false },
    ];
  },
};

export default nextConfig;
