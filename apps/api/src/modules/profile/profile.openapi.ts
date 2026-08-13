import {
  accountProfileSchema as accountProfileSchemaBase,
  fileIdSchema as fileIdSchemaBase,
  publicProfileSchema as publicProfileSchemaBase,
} from "@starter/contracts";
import { nameSchema } from "@api/openapi/name-schema.js";

export const publicProfileSchema = nameSchema(
  publicProfileSchemaBase,
  "PublicProfile",
);
export const accountProfileSchema = nameSchema(
  accountProfileSchemaBase,
  "AccountProfile",
);
export const fileIdSchema = fileIdSchemaBase;
