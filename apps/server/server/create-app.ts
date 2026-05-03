import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";

import { apiRouter } from "./routes/api.js";
import { initializeSessions } from "./state/session.js";
import { initializeTokenUsage } from "./state/token-usage.js";
import { conditionalClerkMiddleware } from "./lib/dev-auth.js";

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many requests. Please try again shortly." }
});

export function createApp(): express.Express {
  initializeSessions();
  initializeTokenUsage();
  const app = express();

  app.use(cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id", "x-request-id"],
    maxAge: 86400
  }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  });

  app.use(conditionalClerkMiddleware());
  app.use("/api/", apiLimiter);
  app.use(express.json({ limit: "8mb" }));
  app.use("/", apiRouter);
  return app;
}