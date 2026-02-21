import type { TraceEvent } from "./types.js";

export class TraceStore {
  private readonly events: TraceEvent[] = [];

  public append(event: TraceEvent): void {
    this.events.push(event);
  }

  public listByRun(runId: string): TraceEvent[] {
    return this.events.filter((event) => event.runId === runId);
  }

  public exportAll(): TraceEvent[] {
    return [...this.events];
  }
}
