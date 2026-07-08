/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // API access goes through src/pages/api/bedsense/[...path].ts, which reads
  // API_BASE_URL at request time (a rewrite here would bake it in at build time).
};
