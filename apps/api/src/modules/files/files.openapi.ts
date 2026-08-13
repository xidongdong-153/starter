import {
  fileItemSchema as fileItemSchemaBase,
  fileListSchema as fileListSchemaBase,
} from "@starter/contracts";
import { nameSchema } from "@api/openapi/name-schema.js";

export const fileItemSchema = nameSchema(fileItemSchemaBase, "FileItem");
export const fileListSchema = fileListSchemaBase;
