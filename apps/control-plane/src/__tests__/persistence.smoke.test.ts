import assert from "node:assert/strict";
import test from "node:test";
import { RunStore } from "../stores/runStore.js";
import { SettingsStore } from "../stores/settingsStore.js";

test("run store writes to persistent sqlite backing", () => {
  const storeA = new RunStore();
  const created = storeA.create({ projectId: "persistence-project", objective: "persistence test objective" });

  const storeB = new RunStore();
  const fetched = storeB.get(created.runId);

  assert.ok(fetched);
  assert.equal(fetched?.projectId, "persistence-project");
  assert.equal(fetched?.summary, "persistence test objective");
});

test("settings persist across store instances", () => {
  const storeA = new SettingsStore();
  storeA.update({ requireApproval: false });

  const storeB = new SettingsStore();
  const loaded = storeB.get();
  assert.equal(loaded.requireApproval, false);

  // Reset to secure default for future runs.
  storeB.update({ requireApproval: true });
});
