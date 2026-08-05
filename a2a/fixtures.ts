import type { AddressInfo } from "node:net";
import type { PiA2AServer } from "./server.ts";

export const TEST_TOKEN = "pi-a2a-test-token";

export function sendMessageRequest(
  text: string,
  contextId = "ctx-test",
  id: string | number = "rpc-1",
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method: "SendMessage",
    params: {
      message: {
        messageId: "message-1",
        contextId,
        role: "ROLE_USER",
        parts: [{ text, mediaType: "text/plain" }],
      },
    },
  };
}

export async function authenticatedFetch(
  url: string,
  init: RequestInit = {},
  token = TEST_TOKEN,
) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function postJson(
  url: string,
  body: unknown,
  token = TEST_TOKEN,
) {
  return authenticatedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, token);
}

export async function startOnEphemeralPort(server: PiA2AServer) {
  await server.start();
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP server address");
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}
