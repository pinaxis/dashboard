import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Serves the synthetic private dataset at /graph.private.json during dev and preview ONLY. It reads
// from scratch/, which is never copied into a build, so a private document can never ship to the public
// deploy. In production the app fetches the private data from its Access-gated origin (VITE_PRIVATE_URL).
function localPrivateData(): Plugin {
  const file = resolve(__dirname, "scratch/graph.private.json");
  const serve = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((request, response, next) => {
      if (request.url && request.url.split("?")[0] === "/graph.private.json" && existsSync(file)) {
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
  plugins: [react(), localPrivateData()],
  // sql.js ships a WASM binary that must not be pre-bundled by esbuild.
  optimizeDeps: { exclude: ["sql.js"] },
});
