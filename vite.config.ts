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

/**
 * The private build is served under /private on the host the public build shares, and the Cloudflare
 * Access application protects exactly that path prefix. An asset served from the origin root would
 * sit OUTSIDE the gate and be world-readable, so this is the disclosure boundary, not a cosmetic path.
 *
 * Both halves are needed. `base` rewrites the URLs inside index.html; `outDir` puts the FILES under a
 * matching directory, because Workers Static Assets resolves a request path against the asset
 * directory without stripping the route prefix, so a request for /private/x looks for private/x on
 * disk. Setting only `base` yields a build whose every asset 404s into the SPA fallback.
 *
 * The two modes also write to separate trees, so a private artifact cannot be left behind in the
 * directory the public Worker deploys.
 *
 * Proven by scripts/assert-private-scoped.mjs against the built output, not by reading this comment.
 */
export default defineConfig(({ mode }) => ({
  base: mode === "private" ? "/private/" : "/",
  build: { outDir: mode === "private" ? "dist-private/private" : "dist", emptyOutDir: true },
  plugins: [react(), localPrivateData()],
  // sql.js ships a WASM binary that must not be pre-bundled by esbuild.
  optimizeDeps: { exclude: ["sql.js"] },
}));
