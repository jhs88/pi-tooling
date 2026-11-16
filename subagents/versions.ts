/** Exact upstream releases reviewed for the adapter's private integration seams. */
export const REVIEWED_SUBAGENTS_VERSIONS: readonly string[] = [
  "0.22.0",
  "0.23.0",
];

export function isReviewedSubagentsVersion(
  version: unknown,
): version is string {
  return (
    typeof version === "string" && REVIEWED_SUBAGENTS_VERSIONS.includes(version)
  );
}
