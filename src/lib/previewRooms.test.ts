import assert from "node:assert/strict";
import { test } from "node:test";
import { previewWorkerName } from "./previewRooms.ts";

// Every Worker name must work as a workers.dev hostname label.
const isValidLabel = (name: string) => name.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name);

test("branch names become readable Worker names", () => {
  assert.equal(previewWorkerName("feature/winner-takes-all"), "pokemonguessinggame-rooms-feature-winner-takes-all");
  assert.equal(previewWorkerName("Fix/Refresh_Grace"), "pokemonguessinggame-rooms-fix-refresh-grace");
  assert.equal(previewWorkerName("claude/github-pr-creation-xvlbct"), "pokemonguessinggame-rooms-claude-github-pr-creation-xvlbct");
});

test("long branch names are cut short with a fingerprint so they stay valid and distinct", () => {
  const a = previewWorkerName("codex/add-multiplayer-session-creation-features");
  const b = previewWorkerName("codex/add-multiplayer-session-creation-fixes");
  assert.ok(isValidLabel(a), a);
  assert.ok(isValidLabel(b), b);
  assert.notEqual(a, b);
  assert.ok(a.startsWith("pokemonguessinggame-rooms-codex-add-multiplayer-"), a);
  // Same branch, same name: the workflow and the Vercel build work it out separately.
  assert.equal(previewWorkerName("codex/add-multiplayer-session-creation-features"), a);
});

test("odd branch names still give valid Worker names", () => {
  for (const branch of ["---", "ünïcödé", "a".repeat(200), "x/" + "-".repeat(60) + "/y", "1234"]) {
    const name = previewWorkerName(branch);
    assert.ok(isValidLabel(name), `${branch} -> ${name}`);
    assert.ok(name.startsWith("pokemonguessinggame-rooms-"), name);
  }
});
