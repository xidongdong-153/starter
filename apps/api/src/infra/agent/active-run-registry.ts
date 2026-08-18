export interface ActiveRunControls {
  abort: () => void;
  steer: (text: string) => void;
  followUp: (text: string) => void;
}

export interface AttachableActiveRunControls extends ActiveRunControls {
  attach: () => void;
  isAttached: () => boolean;
}

export interface ActiveRunHandle extends ActiveRunControls {
  readonly runId: string;
  readonly sessionId: string;
  readonly lane: string;
  readonly controls: ActiveRunControls;
}

export interface ActiveRunReserveInput {
  sessionId: string;
  lane: string;
}

const leaseToken = Symbol("active-run-registry");

export class ActiveRunLease {
  constructor(
    readonly sessionId: string,
    readonly lane: string,
    private readonly token: symbol,
  ) {}

  isOwned(): boolean {
    return this.token === leaseToken;
  }
}

function createLease(sessionId: string, lane: string): ActiveRunLease {
  return new ActiveRunLease(sessionId, lane, leaseToken);
}

export class ActiveRunRegistryError extends Error {
  constructor(readonly kind: "busy" | "invalid_lease" | "not_active") {
    super(`Active Run registry error: ${kind}`);
    this.name = "ActiveRunRegistryError";
  }
}

/** 进程内 active Run 索引；它不代表 Session 或 Run 的持久化状态。 */
export class ActiveRunRegistry {
  private readonly byRunId = new Map<string, ActiveRunHandle>();
  private readonly bySessionLane = new Map<string, ActiveRunLease>();
  private readonly handlesBySessionLane = new Map<string, ActiveRunHandle>();
  private readonly leases = new Set<ActiveRunLease>();

  reserve(input: ActiveRunReserveInput): ActiveRunLease;
  reserve(sessionId: string, lane: string): ActiveRunLease;
  reserve(
    inputOrSessionId: ActiveRunReserveInput | string,
    lane?: string,
  ): ActiveRunLease {
    const input =
      typeof inputOrSessionId === "string"
        ? { sessionId: inputOrSessionId, lane: lane ?? "main" }
        : inputOrSessionId;
    const key = laneKey(input.sessionId, input.lane);
    if (this.bySessionLane.has(key)) {
      throw new ActiveRunRegistryError("busy");
    }
    const lease = createLease(input.sessionId, input.lane);
    this.leases.add(lease);
    this.bySessionLane.set(key, lease);
    return lease;
  }

  attach(
    lease: ActiveRunLease,
    runId: string,
    controls: AttachableActiveRunControls,
  ): ActiveRunHandle {
    if (!this.leases.has(lease) || !lease.isOwned()) {
      throw new ActiveRunRegistryError("invalid_lease");
    }
    if (this.byRunId.has(runId)) {
      throw new ActiveRunRegistryError("busy");
    }
    const currentLease = this.bySessionLane.get(
      laneKey(lease.sessionId, lease.lane),
    );
    if (currentLease !== lease) {
      throw new ActiveRunRegistryError("invalid_lease");
    }

    controls.attach();
    const handle: ActiveRunHandle = {
      runId,
      sessionId: lease.sessionId,
      lane: lease.lane,
      controls,
      abort: controls.abort,
      steer: controls.steer,
      followUp: controls.followUp,
    };
    this.byRunId.set(runId, handle);
    this.handlesBySessionLane.set(laneKey(lease.sessionId, lease.lane), handle);
    return handle;
  }

  get(runId: string): ActiveRunHandle | undefined {
    return this.byRunId.get(runId);
  }

  getBySessionLane(
    sessionId: string,
    lane: string,
  ): ActiveRunHandle | undefined {
    return this.handlesBySessionLane.get(laneKey(sessionId, lane));
  }

  abort(runId: string): void {
    this.require(runId).abort();
  }

  steer(runId: string, text: string): void {
    this.require(runId).steer(text);
  }

  followUp(runId: string, text: string): void {
    this.require(runId).followUp(text);
  }

  release(runId: string): void;
  release(lease: ActiveRunLease): void;
  release(runIdOrLease: string | ActiveRunLease): void {
    if (typeof runIdOrLease === "string") {
      const handle = this.byRunId.get(runIdOrLease);
      if (!handle) return;
      this.byRunId.delete(runIdOrLease);
      const lease = this.bySessionLane.get(
        laneKey(handle.sessionId, handle.lane),
      );
      if (lease) {
        this.bySessionLane.delete(laneKey(handle.sessionId, handle.lane));
        this.handlesBySessionLane.delete(
          laneKey(handle.sessionId, handle.lane),
        );
        this.leases.delete(lease);
      }
      return;
    }

    if (!this.leases.has(runIdOrLease)) return;
    this.leases.delete(runIdOrLease);
    this.bySessionLane.delete(
      laneKey(runIdOrLease.sessionId, runIdOrLease.lane),
    );
    this.handlesBySessionLane.delete(
      laneKey(runIdOrLease.sessionId, runIdOrLease.lane),
    );
    for (const [runId, handle] of this.byRunId) {
      if (
        handle.sessionId === runIdOrLease.sessionId &&
        handle.lane === runIdOrLease.lane
      ) {
        this.byRunId.delete(runId);
      }
    }
  }

  clear(): void {
    this.byRunId.clear();
    this.bySessionLane.clear();
    this.handlesBySessionLane.clear();
    this.leases.clear();
  }

  private require(runId: string): ActiveRunHandle {
    const handle = this.byRunId.get(runId);
    if (!handle) throw new ActiveRunRegistryError("not_active");
    return handle;
  }
}

function laneKey(sessionId: string, lane: string): string {
  return `${sessionId}\u0000${lane}`;
}

export function createActiveRunRegistry(): ActiveRunRegistry {
  return new ActiveRunRegistry();
}
