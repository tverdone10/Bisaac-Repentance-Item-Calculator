import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works at a domain root AND at a
  // subpath (e.g. GitHub Pages' /<repo>/). Safe here because the app is
  // single-page and state-driven, with no router expecting absolute URLs.
  base: "./",
  server: { port: 5173, open: true },
});
