import type { HonoEnv } from "@api/shared/hono-env.js";
import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";

import { createSuccessResponse } from "@api/shared/response.js";

import {
  createAiSkillRoute as createSkillOperation,
  deleteAiSkillRoute,
  getAiSkillRoute,
  listAiSkillsRoute,
  updateAiSkillRoute,
} from "./skill.openapi.js";
import type { createAiSkillService } from "./skill.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;

export function createAiSkillRoute(deps: {
  service: ReturnType<typeof createAiSkillService>;
  requireAuth: AiRouteMiddleware;
  requireManage: AiRouteMiddleware;
}) {
  const { service, requireAuth, requireManage } = deps;

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...listAiSkillsRoute, middleware: requireAuth }, (c) =>
      c.json(createSuccessResponse(service.listSkills(), c.var.requestId), 200),
    )
    .openapi(
      { ...getAiSkillRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            service.getSkill(c.req.valid("param").id),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...createSkillOperation, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            service.createSkill(c.req.valid("json"), c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...updateAiSkillRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            service.updateSkill(
              c.req.valid("param").id,
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...deleteAiSkillRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            { deleted: service.deleteSkill(c.req.valid("param").id) },
            c.var.requestId,
          ),
          200,
        ),
    );
}
