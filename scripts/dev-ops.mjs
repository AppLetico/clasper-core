#!/usr/bin/env node
/**
 * Ops Console dev server with hot reload.
 *
 * - esbuild ctx.watch() rebuilds on file changes
 * - A tiny HTTP server on :8082 provides an /esbuild SSE endpoint
 * - A banner snippet in the dev bundle connects to it and reloads on rebuild
 */
import * as esbuild from "esbuild";
import http from "node:http";

const LIVE_RELOAD_PORT = 8082;

// --- SSE live-reload server ---
const clients = new Set();

const server = http.createServer((req, res) => {
  // CORS headers so the browser can connect from :8081
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.url === "/esbuild") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`  ⚠️  Port ${LIVE_RELOAD_PORT} in use — live reload disabled (kill old process or use a different port)`);
    // Continue without live reload — watcher still works, you just need manual refresh
  } else {
    throw err;
  }
});

server.listen(LIVE_RELOAD_PORT, () => {
  console.log(`  🔄 Live reload SSE on http://localhost:${LIVE_RELOAD_PORT}/esbuild`);
});

function notifyClients() {
  for (const res of clients) {
    res.write('event: change\ndata: reload\n\n');
  }
}

// --- esbuild watcher ---
const rebuildPlugin = {
  name: "live-reload",
  setup(build) {
    let count = 0;
    build.onEnd((result) => {
      count++;
      if (result.errors.length === 0) {
        const ts = new Date().toLocaleTimeString();
        console.log(`  [${ts}] ✅ Rebuilt (${count}) — notifying ${clients.size} client(s)`);
        notifyClients();
      } else {
        const ts = new Date().toLocaleTimeString();
        console.log(`  [${ts}] ❌ Build failed with ${result.errors.length} error(s)`);
      }
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/ops-ui/src/index.jsx"],
  bundle: true,
  outfile: "src/ops-ui/dist/app.js",
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "preact",
  sourcemap: true,
  plugins: [rebuildPlugin],
  banner: {
    js: `(() => {
  if (typeof EventSource !== "undefined") {
    const es = new EventSource("http://localhost:${LIVE_RELOAD_PORT}/esbuild");
    es.addEventListener("change", () => location.reload());
    es.onerror = () => es.close();
  }
})();`,
  },
});

await ctx.watch();

console.log(`  ⚡ Ops UI watcher active`);
console.log(`  👀 Watching src/ops-ui/src/ for changes...\n`);
