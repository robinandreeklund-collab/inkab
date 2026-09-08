/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /*
   * occt-import-js laddar sin WASM-fil relativt sin egen plats i node_modules.
   * Bundlas den in hittar den inte filen, så den lämnas utanför.
   */
  serverExternalPackages: ["occt-import-js"],
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
