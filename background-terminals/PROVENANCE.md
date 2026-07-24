# Background terminals provenance

Adapted with repository-owner authorization from [`davis7dotsh/my-pi-setup@797eaf6`](https://github.com/davis7dotsh/my-pi-setup/tree/797eaf6d6f178759cf7aabde927ef15c91346e7e), `extensions/background-terminals/`.

Local changes use a session-owned dependency-free process supervisor, deterministic shell selection, no stdin, atomic concurrency accounting, bounded/redacted retained tails, private quota-bounded spills with stale cleanup, coalesced best-effort follow-ups, and bounded process-tree teardown. Windows tree termination is best effort and unverified; SIGKILL, hard crashes, and power loss cannot guarantee cleanup.
