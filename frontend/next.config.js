/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding", "accounts", "@metamask/connect-evm");
    return config;
  },
};

module.exports = nextConfig;
