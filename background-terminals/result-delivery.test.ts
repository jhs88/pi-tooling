import assert from "node:assert/strict";
import test from "node:test";
import { createCompletionBroker } from "./src/result-delivery.ts";

test("completion broker coalesces pending settlements and delivers each id once", () => {
  const broker = createCompletionBroker<{ id: string; n: number }>();
  broker.defer({ id: "bt-1", n: 1 });
  broker.defer({ id: "bt-2", n: 2 });
  broker.defer({ id: "bt-1", n: 3 });
  assert.deepEqual(broker.drain(), [
    { id: "bt-1", n: 3 },
    { id: "bt-2", n: 2 },
  ]);
  assert.deepEqual(broker.drain(), []);
});

test("status or kill consumption suppresses the pending follow-up", () => {
  const broker = createCompletionBroker<{ id: string }>();
  broker.defer({ id: "bt-1" });
  broker.consume(["bt-1"]);
  assert.deepEqual(broker.drain(), []);
});
