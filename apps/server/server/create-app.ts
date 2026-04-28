import express from "express";

import { apiRouter } from "./routes/api.js";
import { initializeSessions } from "./state/session.js";
import { initializeTokenUsage } from "./state/token-usage.js";

export function createApp(): express.Express {
  initializeSessions();
  initializeTokenUsage();
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use("/", apiRouter);
  return app;
}
