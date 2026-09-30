/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import { API_PREFIX, resolveDevServerConfig, stripApiPrefix } from "./devServer.ts";

export default defineConfig(({ mode }) => {
  // server/.env holds APP_PORT; client/.env (optional) holds CLIENT_PORT. The process
  // environment wins over both.
  const env = { ...loadEnv(mode, "../server", ""), ...loadEnv(mode, ".", ""), ...process.env };
  const { clientPort, apiTarget } = resolveDevServerConfig(env);
  const proxy = { [API_PREFIX]: { target: apiTarget, changeOrigin: true, rewrite: stripApiPrefix } };
  return {
    server: { port: clientPort, strictPort: true, proxy },
    preview: { port: clientPort, strictPort: true, proxy },
    // MapLibre alone is about 1 MB minified; Three.js is split into the scene's own chunk.
    build: { chunkSizeWarningLimit: 1200 },
    test: { environment: "node" },
  };
});
