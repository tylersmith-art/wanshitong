import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@wanshitong/api/src/routers/index.js";

export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();
