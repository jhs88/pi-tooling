export interface A2AServerConfig {
  host: "127.0.0.1" | "::1" | "localhost";
  port: number;
  bearerToken: string;
  maxBodyBytes: number;
  maxTasks: number;
  executionTimeoutMs: number;
}

export const MAX_A2A_TASKS = 1_024;

const LOOPBACK_HOSTS = new Set<A2AServerConfig["host"]>([
  "127.0.0.1",
  "::1",
  "localhost",
]);

function positiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return parsed;
}

export function loadA2AServerConfig(
  env: Record<string, string | undefined> = process.env,
): A2AServerConfig {
  const bearerToken = env.PI_A2A_BEARER_TOKEN?.trim();
  if (!bearerToken) {
    throw new Error("PI_A2A_BEARER_TOKEN is required");
  }

  const requestedHost = env.PI_A2A_HOST ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(requestedHost as A2AServerConfig["host"])) {
    throw new Error("PI_A2A_HOST must be a loopback host in the first milestone");
  }

  return {
    host: requestedHost as A2AServerConfig["host"],
    port: positiveInteger("PI_A2A_PORT", env.PI_A2A_PORT, 10000, 65_535),
    bearerToken,
    maxBodyBytes: positiveInteger(
      "PI_A2A_MAX_BODY_BYTES",
      env.PI_A2A_MAX_BODY_BYTES,
      1_048_576,
      1_048_576,
    ),
    maxTasks: positiveInteger(
      "PI_A2A_MAX_TASKS",
      env.PI_A2A_MAX_TASKS,
      256,
      MAX_A2A_TASKS,
    ),
    executionTimeoutMs: positiveInteger(
      "PI_A2A_EXECUTION_TIMEOUT_MS",
      env.PI_A2A_EXECUTION_TIMEOUT_MS,
      300_000,
    ),
  };
}
