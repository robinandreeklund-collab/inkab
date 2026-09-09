/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },

  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      /*
       * CAD-konverteringen körs i en web worker i webbläsaren.
       *
       * @gltf-transform/core har en dynamisk import av node:fs och node:path
       * inne i NodeIO. Vi använder WebIO och rör aldrig den koden, men
       * webpack försöker ändå lösa upp importen när workern bundlas. Att peka
       * dem till false gör dem till tomma moduler i klientbygget — grenen
       * körs bara i Node, där importen fungerar som vanligt.
       */
      // Webpack behandlar "node:"-prefixet som ett eget schema och vägrar
      // lösa upp det för webben. Prefixet skalas därför av först, och sedan
      // pekas modulerna till tomma.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};
export default nextConfig;
