import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.SCRUBARR_DEV_API_TARGET || "http://127.0.0.1:8098";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": apiTarget,
    },
  },
});
