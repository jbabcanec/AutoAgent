import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/renderer"),
    },
  },
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true
  }
});
