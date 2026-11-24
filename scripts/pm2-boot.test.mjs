import assert from "node:assert/strict";
import test from "node:test";
import { decideBootAction } from "./pm2-boot-state.mjs";

const cwd = "/repos/Zappy-Assistant";
const saved = ["admin-api", "admin-ui", "wa-gateway", "worker", "media-resolver"]
  .map((name) => ({ name, pm_cwd: cwd }));
const running = saved.map(({ name }) => ({ name, pm2_env: { pm_cwd: cwd, status: "online" } }));

test("boot only restores the expected deploy into an empty PM2 daemon", () => {
  assert.equal(decideBootAction(saved, [], cwd), "restore");
  assert.equal(decideBootAction(saved, running, cwd), "keep");
  assert.equal(decideBootAction(saved, running.slice(1), cwd), "partial");
  assert.equal(decideBootAction(saved, running, "/other"), "invalid");
  assert.equal(decideBootAction([...saved, { name: "other" }], [], cwd), "invalid");
  assert.equal(decideBootAction([], [], cwd), "invalid");
});
