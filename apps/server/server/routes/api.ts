import { Router } from "express";
import { initializeSessions } from "../state/session.js";
import { sessionRouter } from "./session-routes.js";
import { generationRouter } from "./generation-routes.js";
import { infraRouter } from "./infra-routes.js";

export const apiRouter = Router();

export { initializeSessions };

apiRouter.use(sessionRouter);
apiRouter.use(generationRouter);
apiRouter.use(infraRouter);