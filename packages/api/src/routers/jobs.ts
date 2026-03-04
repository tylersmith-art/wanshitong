import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { enqueueJob } from "../jobs/index.js";
import { EXAMPLE_JOB } from "../jobs/handlers/example.js";

export const jobsRouter = router({
  enqueue: protectedProcedure
    .input(z.object({ message: z.string().optional() }))
    .mutation(async ({ input }) => {
      const jobId = await enqueueJob(EXAMPLE_JOB, {
        message: input.message ?? "hello from trpc",
        enqueuedAt: Date.now(),
      });
      return { jobId };
    }),
});
