import cors from "cors";
import express from "express";

import { apiRouter } from "./routes/api.js";
import { initializeSessions } from "./session-state.js";

export function createApp(): express.Express {
  initializeSessions();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));
  app.use("/", apiRouter);
  return app;
}
