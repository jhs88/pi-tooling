import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidOptionCount,
  buildAskUserResultMessage,
} from "./prompt.ts";

test("ask_user enforces the 2-5 option contract at runtime", () => {
  assert.doesNotThrow(() => assertValidOptionCount(2));
  assert.doesNotThrow(() => assertValidOptionCount(5));
  assert.throws(() => assertValidOptionCount(1), /between 2 and 5 options \(got 1\)/);
  assert.throws(() => assertValidOptionCount(6), /between 2 and 5 options \(got 6\)/);
});

test("dismissal, abort, and non-TUI fallback are distinct model outcomes", () => {
  assert.match(buildAskUserResultMessage({ kind: "dismissed" }), /dismissed/);
  assert.match(buildAskUserResultMessage({ kind: "dismissed" }), /Do not assume/);
  assert.match(buildAskUserResultMessage({ kind: "aborted" }), /turn was aborted/);
  assert.match(buildAskUserResultMessage({ kind: "no-ui" }), /plain text/);
  assert.notEqual(
    buildAskUserResultMessage({ kind: "dismissed" }),
    buildAskUserResultMessage({ kind: "aborted" }),
  );
});

test("selected and custom outcomes preserve user answer identity", () => {
  assert.equal(
    buildAskUserResultMessage({ kind: "selected", answer: "Blue", index: 2 }),
    "User selected option 2: Blue",
  );
  assert.equal(
    buildAskUserResultMessage({ kind: "custom", answer: "Indigo" }),
    "User wrote their own answer: Indigo",
  );
});
