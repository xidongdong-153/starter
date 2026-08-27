import { and, asc, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import { aiRunSteps, aiRunTurns } from "../ai.schema.js";

export type RunTurnOutcome = "running" | "succeeded" | "failed" | "aborted";
export type RunStepOutcome =
  | "running"
  | "succeeded"
  | "retry"
  | "failed"
  | "aborted"
  | "deferred"
  | "overflow";

export interface AiRunLifecycleRepository {
  beginTurn: (input: {
    id: string;
    runId: string;
    turnIndex: number;
    startedAt: Date;
  }) => void;
  completeTurn: (
    id: string,
    outcome: Exclude<RunTurnOutcome, "running">,
    finishedAt: Date,
  ) => void;
  beginStep: (input: {
    id: string;
    runId: string;
    turnId: string;
    kind: string;
    attempt: number;
    startedAt: Date;
  }) => void;
  completeStep: (
    id: string,
    outcome: Exclude<RunStepOutcome, "running">,
    errorCode: string | null,
    finishedAt: Date,
  ) => void;
  listRunning: (runId: string) => { turns: string[]; steps: string[] };
  listTurns: (runId: string) => (typeof aiRunTurns.$inferSelect)[];
  listSteps: (runId: string) => (typeof aiRunSteps.$inferSelect)[];
}

export function createAiRunLifecycleRepository(
  db: AppDatabase,
): AiRunLifecycleRepository {
  function beginTurn(input: {
    id: string;
    runId: string;
    turnIndex: number;
    startedAt: Date;
  }): void {
    db.insert(aiRunTurns)
      .values({ ...input, outcome: "running" })
      .run();
  }
  function completeTurn(
    id: string,
    outcome: Exclude<RunTurnOutcome, "running">,
    finishedAt: Date,
  ): void {
    db.update(aiRunTurns)
      .set({ outcome, finishedAt })
      .where(and(eq(aiRunTurns.id, id), eq(aiRunTurns.outcome, "running")))
      .run();
  }
  function beginStep(input: {
    id: string;
    runId: string;
    turnId: string;
    kind: string;
    attempt: number;
    startedAt: Date;
  }): void {
    db.insert(aiRunSteps)
      .values({ ...input, outcome: "running", errorCode: null })
      .run();
  }
  function completeStep(
    id: string,
    outcome: Exclude<RunStepOutcome, "running">,
    errorCode: string | null,
    finishedAt: Date,
  ): void {
    db.update(aiRunSteps)
      .set({ outcome, errorCode, finishedAt })
      .where(and(eq(aiRunSteps.id, id), eq(aiRunSteps.outcome, "running")))
      .run();
  }
  function listRunning(runId: string) {
    return {
      turns: db
        .select({ id: aiRunTurns.id })
        .from(aiRunTurns)
        .where(
          and(eq(aiRunTurns.runId, runId), eq(aiRunTurns.outcome, "running")),
        )
        .all()
        .map((row) => row.id),
      steps: db
        .select({ id: aiRunSteps.id })
        .from(aiRunSteps)
        .where(
          and(eq(aiRunSteps.runId, runId), eq(aiRunSteps.outcome, "running")),
        )
        .all()
        .map((row) => row.id),
    };
  }
  return {
    beginTurn,
    completeTurn,
    beginStep,
    completeStep,
    listRunning,
    listTurns: (runId) =>
      db
        .select()
        .from(aiRunTurns)
        .where(eq(aiRunTurns.runId, runId))
        .orderBy(asc(aiRunTurns.turnIndex))
        .all(),
    listSteps: (runId) =>
      db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .orderBy(sql`${aiRunSteps.startedAt}`, sql`${aiRunSteps.id}`)
        .all(),
  };
}
