import { defineConfig } from "vite";
export default defineConfig({
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:8000",
                changeOrigin: true
            },
            "/ws": {
                target: "ws://localhost:8000",
                ws: true,
                changeOrigin: true
            }
        }
    },
    build: {
        chunkSizeWarningLimit: 700,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) {
                        return undefined;
                    }
                    if (id.includes("react") || id.includes("scheduler")) {
                        return "vendor-react";
                    }
                    if (id.includes("@tanstack")) {
                        return "vendor-router";
                    }
                    if (id.includes("@clerk")) {
                        return "vendor-clerk";
                    }
                    if (id.includes("three") || id.includes("@types/three")) {
                        return "vendor-three";
                    }
                    if (id.includes("react-markdown") || id.includes("remark") || id.includes("rehype") || id.includes("prism")) {
                        return "vendor-markdown";
                    }
                    if (id.includes("zustand") || id.includes("zod")) {
                        return "vendor-state";
                    }
                    return "vendor-misc";
                }
            }
        }
    }
});
