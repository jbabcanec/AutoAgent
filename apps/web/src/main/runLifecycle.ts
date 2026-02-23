import type { RunLifecycleState } from "../shared/ipc.js";

const ALLOWED_TRANSITIONS: Record<RunLifecycleState, RunLifecycleState[]> = {
  idle: ["creating_run"],
  creating_run: ["approval_required", "approved", "executing", "failed"],
  approval_required: ["approved", "rejected", "failed"],
  approved: ["executing", "failed"],
  rejected: ["idle"],
  executing: ["completed", "failed"],
  completed: ["idle"],
  failed: ["idle"]
};

export class RunLifecycleMachine {
  private state: RunLifecycleState = "idle";

  public get current(): RunLifecycleState {
    return this.state;
  }

  public transition(next: RunLifecycleState): RunLifecycleState {
    if (!ALLOWED_TRANSITIONS[this.state].includes(next)) {
      throw new Error(`Invalid lifecycle transition: ${this.state} -> ${next}`);
    }
    this.state = next;
    return this.state;
  }

  public reset(): void {
    this.state = "idle";
  }
}
