import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    base: "/",
    server: {
        proxy: {
            "/subgraphs": {
                target: "https://api.thegraph.com/subgraphs/name/aavegotchi/aavegotchi-core-matic",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/subgraphs/, ""),
                secure: false,
            },
        },
        hmr: false,
    },
});
