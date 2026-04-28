import cors from "cors";
import express from "express";

import { apiRouter } from "./routes/api.js";
import { initializeSessions } from "./state/session.js";
import { initializeTokenUsage } from "./state/token-usage.js";

export function createApp(): express.Express {
  initializeSessions();
  initializeTokenUsage();
  const app = express();
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        "https://app.dosco.live",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173"
      ];
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // For development, allow all origins
      if (process.env.NODE_ENV === "development") {
        return callback(null, true);
      }
      
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id", "x-request-id"],
    credentials: true
  }));
  app.use(express.json({ limit: "8mb" }));
  app.use("/", apiRouter);
  return app;
}
