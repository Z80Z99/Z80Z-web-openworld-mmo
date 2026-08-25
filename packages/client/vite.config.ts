import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "shore-debug": resolve(__dirname, "shore-debug.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
  },
});
