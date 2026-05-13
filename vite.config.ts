import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function usdzMimeType(): Plugin {
  return {
    name: "usdz-mime-type",
    configureServer(server) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        if (req.url?.split("?")[0]?.endsWith(".usdz")) {
          res.setHeader("Content-Type", "model/vnd.usdz+zip");
        }

        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        if (req.url?.split("?")[0]?.endsWith(".usdz")) {
          res.setHeader("Content-Type", "model/vnd.usdz+zip");
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), usdzMimeType()],
  server: {
    allowedHosts: [
      "localhost",
      "8eed-2001-b07-2e7-180b-7c55-c4fd-1da1-72d1.ngrok-free.app",
      "6876-2001-b07-2e7-180b-f4be-c07e-9c43-7b27.ngrok-free.app",
      "848b-2001-b07-2e7-180b-b18a-10b0-4cc6-28c0.ngrok-free.app",
    ],
  },
});
