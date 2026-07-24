/**
 * Adapted with repository-owner authorization from davis7dotsh/my-pi-setup
 * commit 797eaf6d6f178759cf7aabde927ef15c91346e7e. Local changes make abort,
 * dismissal, and non-TUI outcomes explicit for Pi 0.80.10.
 */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;

export const ASK_USER_PARAMETER_DESCRIPTIONS = {
  optionLabel: "Short display label for this option",
  optionDescription: "Optional one-line description shown below the label",
  question: "The single question to ask the user",
  options:
    "Between 2 and 5 answer options. A free-form 'write my own answer' option is always appended automatically; never include it yourself.",
};

export const ASK_USER_TOOL_DESCRIPTION =
  "Ask the user exactly one multiple-choice question with 2-5 options. A free-form answer is always available, and the user may dismiss without answering.";

export const ASK_USER_PROMPT_SNIPPET =
  "Ask one multiple-choice question (2-5 options plus a free-form answer)";

export const ASK_USER_PROMPT_GUIDELINES = [
  "Use ask_user when likely answers can be enumerated instead of asking in plain text.",
  "Ask exactly one question per ask_user call; ask follow-ups in later calls.",
  "A dismissed or aborted ask_user call is not an answer; do not infer a choice.",
];

export function assertValidOptionCount(count: number): void {
  if (count < MIN_OPTIONS || count > MAX_OPTIONS) {
    throw new Error(
      `ask_user requires between ${MIN_OPTIONS} and ${MAX_OPTIONS} options (got ${count}). Retry with a valid number of options.`,
    );
  }
}

export type AskUserOutcome =
  | { kind: "no-ui" }
  | { kind: "aborted" }
  | { kind: "dismissed" }
  | { kind: "custom"; answer: string }
  | { kind: "selected"; answer: string; index: number };

export function buildAskUserResultMessage(outcome: AskUserOutcome): string {
  switch (outcome.kind) {
    case "no-ui":
      return "No terminal UI is available, so ask_user could not display the question. Ask the user in plain text instead.";
    case "aborted":
      return "The ask_user interaction ended because the agent turn was aborted. The user did not answer.";
    case "dismissed":
      return "User dismissed the question without answering. Do not assume an answer; proceed accordingly or ask differently.";
    case "custom":
      return `User wrote their own answer: ${outcome.answer}`;
    case "selected":
      return `User selected option ${outcome.index}: ${outcome.answer}`;
  }
}
