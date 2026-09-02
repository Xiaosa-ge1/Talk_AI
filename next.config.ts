import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* pdfjs-dist 是纯 ESM，worker 文件按相对路径动态加载；
     serverExternalPackages 让它在服务端从 node_modules 原生加载，
     避免被 webpack 重打包导致 pdf.worker.mjs 路径失效。 */
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
