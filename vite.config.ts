import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @remarks serves the local private dataset at /api/graph during dev and preview ONLY. It reads from
 * scratch/, which no build copies, so a private document can never ship in the public deploy.
 */
function localPrivateData(): Plugin {
  const files: Record<string, string> = {
    "/api/graph": resolve(__dirname, "scratch/graph.private.json"),
    "/api/catalog": resolve(__dirname, "scratch/catalog.json"),
  };
  const serve = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((request, response, next) => {
      const path = request.url ? request.url.split("?")[0] : "";
      const file = files[path];
      if (file && existsSync(file)) {
        response.setHeader("Content-Type", "application/json");
        response.end(readFileSync(file));
        return;
      }
      next();
    });
  };
  return { name: "local-private-data", configureServer: serve, configurePreviewServer: serve };
}

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [react(), localPrivateData()],
  // sql.js ships a WASM binary that must not be pre-bundled by esbuild.
  optimizeDeps: { exclude: ["sql.js"] },
});
