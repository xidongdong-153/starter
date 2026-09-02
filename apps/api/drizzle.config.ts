import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infra/db/schema/index.ts',
  out: './src/infra/db/migrations',
  dbCredentials: { url: process.env.DATABASE_PATH ?? './data/app.db' },
})
