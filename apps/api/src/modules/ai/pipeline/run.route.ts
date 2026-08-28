import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";

import type { HonoEnv } from "@api/shared/hono-env.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { toRuntimeAccessContext } from "@api/modules/ai/principal.js";

import {
  abortPipelineRunRoute,
  getPipelineRunRoute,
  startPipelineRunRoute,
} from "./run.openapi.js";
import type { AiPipelineRunService } from "./run.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;

export function createAiPipelineRunRoute(deps: {
  service: AiPipelineRunService;
  requireRuntimePrincipal: AiRouteMiddleware;
}) {
  const { service, requireRuntimePrincipal } = deps;
  const access = (c: { var: HonoEnv["Variables"] }) =>
    toRuntimeAccessContext(c.var.principal, c.var.resourceScope);

  return new OpenAPIHono<HonoEnv>()
    .openapi(
      { ...startPipelineRunRoute, middleware: requireRuntimePrincipal },
      async (c) => {
        const params = c.req.valid("param");
        const body = c.req.valid("json");
        const result = await service.start({
          access: access(c),
          pipelineId: params.pipelineId,
          input: body.input,
          requestId: c.var.requestId,
        });
        return c.json(createSuccessResponse(result, c.var.requestId), 200);
      },
    )
    .openapi(
      { ...getPipelineRunRoute, middleware: requireRuntimePrincipal },
      (c) =>
        c.json(
          createSuccessResponse(
            service.get(access(c), c.req.valid("param").runId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...abortPipelineRunRoute, middleware: requireRuntimePrincipal },
      (c) =>
        c.json(
          createSuccessResponse(
            service.abort(access(c), c.req.valid("param").runId),
            c.var.requestId,
          ),
          200,
        ),
    );
}
