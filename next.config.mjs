/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/', destination: '/index.html', permanent: false },
      { source: '/INDEX.html', destination: '/index.html', permanent: false },
    ];
  },
};
export default nextConfig;
