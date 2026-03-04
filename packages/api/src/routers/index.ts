import { router } from "../trpc.js";
import { userRouter } from "./user.js";
import { adminRouter } from "./admin.js";
import { jobsRouter } from "./jobs.js";
import { notificationRouter } from "./notification.js";
import { orgRouter } from "./org.js";
import { apiKeyRouter } from "./apiKey.js";
import { specRouter } from "./spec.js";
import { projectRouter } from "./project.js";
import { searchRouter } from "./search.js";
import { queryLogRouter } from "./queryLog.js";

export const appRouter = router({
  user: userRouter,
  admin: adminRouter,
  jobs: jobsRouter,
  notification: notificationRouter,
  org: orgRouter,
  apiKey: apiKeyRouter,
  spec: specRouter,
  project: projectRouter,
  search: searchRouter,
  queryLog: queryLogRouter,
});

export type AppRouter = typeof appRouter;
