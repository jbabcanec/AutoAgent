import assert from "node:assert/strict";
import test from "node:test";
import { RunLifecycleMachine } from "./runLifecycle.js";

test("run lifecycle accepts valid sequence", () => {
  const machine = new RunLifecycleMachine();
  assert.equal(machine.current, "idle");
  assert.equal(machine.transition("creating_run"), "creating_run");
  assert.equal(machine.transition("approval_required"), "approval_required");
  assert.equal(machine.transition("approved"), "approved");
  assert.equal(machine.transition("executing"), "executing");
  assert.equal(machine.transition("completed"), "completed");
  assert.equal(machine.transition("idle"), "idle");
});

test("run lifecycle rejects invalid transition", () => {
  const machine = new RunLifecycleMachine();
  assert.throws(() => machine.transition("executing"), /Invalid lifecycle transition/);
});
