import type { TSchema, Tool } from "@earendil-works/pi-ai";
import { z } from "zod";

import type { AiModelToolDefinition } from "./ai-gateway.types.js";

export function createSdkTool(definition: AiModelToolDefinition): Tool {
  return {
    name: definition.name,
    description: definition.description,
    parameters: z.toJSONSchema(definition.parameters, {
      target: "draft-7",
    }) as TSchema,
  };
}
