import { createHash } from "node:crypto";
import {
  aiOutputContractRefSchema,
  aiOutputModeSchema,
  aiOutputRenderKindSchema,
  aiOutputVisibilitySchema,
  type AiOutputContractRef,
  type AiOutputMode,
  type AiOutputRenderKind,
  type AiOutputVisibility,
} from "@starter/contracts";
import { z } from "zod";

export interface AiOutputContract<T extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  version: string;
  description: string;
  schema: z.ZodObject<T>;
  renderKind: AiOutputRenderKind;
  visibility: AiOutputVisibility;
  mode: AiOutputMode;
}

export interface ResolvedAiOutputContract<
  T extends z.ZodRawShape = z.ZodRawShape,
> extends AiOutputContract<T> {
  readonly ref: AiOutputContractRef;
  readonly schemaHash: string;
}

export interface AiOutputContractRegistry {
  define: <T extends z.ZodRawShape>(
    contract: AiOutputContract<T>,
  ) => ResolvedAiOutputContract<T>;
  resolve: (
    ref: Pick<AiOutputContractRef, "name" | "version">,
  ) => ResolvedAiOutputContract;
  find: (
    ref: Pick<AiOutputContractRef, "name" | "version">,
  ) => ResolvedAiOutputContract | undefined;
  list: () => readonly ResolvedAiOutputContract[];
}

const semverPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const namePattern = /^[a-z][a-z0-9._-]{0,119}$/u;

export function defineAiOutputContract<T extends z.ZodRawShape>(
  input: AiOutputContract<T>,
): ResolvedAiOutputContract<T> {
  if (!namePattern.test(input.name))
    throw new Error("AI Output Contract name 无效");
  if (!semverPattern.test(input.version))
    throw new Error("AI Output Contract version 无效");
  if (
    input.description.trim().length === 0 ||
    input.description.length > 1000
  ) {
    throw new Error("AI Output Contract description 无效");
  }
  if (!(input.schema instanceof z.ZodObject)) {
    throw new Error("AI Output Contract schema 必须是 Zod object");
  }
  aiOutputRenderKindSchema.parse(input.renderKind);
  aiOutputVisibilitySchema.parse(input.visibility);
  aiOutputModeSchema.parse(input.mode);

  const schemaJson = z.toJSONSchema(input.schema, { target: "draft-7" });
  const schemaHash = createHash("sha256")
    .update(JSON.stringify(schemaJson))
    .digest("hex");
  const ref = aiOutputContractRefSchema.parse({
    name: input.name,
    version: input.version,
    schemaHash,
    renderKind: input.renderKind,
    visibility: input.visibility,
    mode: input.mode,
  });
  return Object.freeze({ ...input, ref, schemaHash });
}

export function createAiOutputContractRegistry(
  contracts: readonly ResolvedAiOutputContract[] = [],
): AiOutputContractRegistry {
  const byRef = new Map<string, ResolvedAiOutputContract>();
  const add = (contract: ResolvedAiOutputContract) => {
    const key = contractKey(contract);
    if (byRef.has(key)) throw new Error(`重复的 AI Output Contract: ${key}`);
    byRef.set(key, contract);
  };
  contracts.forEach(add);

  return Object.freeze({
    define<T extends z.ZodRawShape>(input: AiOutputContract<T>) {
      const contract = defineAiOutputContract(input);
      add(contract);
      return contract;
    },
    resolve(ref: Pick<AiOutputContractRef, "name" | "version">) {
      const contract = byRef.get(contractKey(ref));
      if (!contract)
        throw new Error(`AI Output Contract 未注册: ${contractKey(ref)}`);
      return contract;
    },
    find: (ref: Pick<AiOutputContractRef, "name" | "version">) =>
      byRef.get(contractKey(ref)),
    list: () => [...byRef.values()],
  });
}

function contractKey(
  ref: Pick<AiOutputContractRef, "name" | "version">,
): string {
  return `${ref.name}@${ref.version}`;
}
