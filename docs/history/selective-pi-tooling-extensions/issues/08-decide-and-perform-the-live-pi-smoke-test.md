# Decide and perform the live Pi smoke test

Type: task
Status: resolved
Blocked by: 07

## Question

After static verification passes, obtain explicit approval for any live Pi-client invocation or provide the human with a precise smoke-test checklist; record the observed results needed to decide whether the branch has reached the destination.

## Answer

The repository owner will perform the live Pi smoke test after pulling the pushed `feat/pi-tooling-extensions` branch. The agent must not launch Pi or local inference. Deliver a concise checklist covering tool discovery, `ask_user`, file search, self-hosted Firecrawl, workflows, background process lifecycle, completion notifications, and preservation of `@tintinweb/pi-subagents`.
