---
name: background-terminals
description: Run and manage long-lived shell commands in Pi background terminals. Use for development servers, watchers, streaming builds, and other non-interactive commands that should continue while the agent works.
---

# Background Terminals

Use `bg_start` for long-running commands. Use the regular shell tool for quick commands.

## Start

Call `bg_start` with:

- `command`: the shell command to run;
- `title`: a short, recognizable label;
- `working_dir`: the project directory when different from the current directory.

Background commands receive no stdin. Never use them for interactive prompts, password requests, or other commands that require user input. At most eight background terminals may run concurrently.

After starting a command, continue useful work instead of polling. Pi delivers one completion message when the process exits.

## Inspect and stop

- Use `bg_status` only when current output or status is needed.
- Use `bg_list` to inventory tracked terminals.
- Use `bg_kill` when a process is no longer needed or is stuck; termination covers its process tree and continues even if the tool wait is aborted.
- Tell the user they can open `/ps` to inspect live output and stop terminals interactively.

Prefer meaningful titles and avoid starting duplicate servers or watchers. Output is retained in private, bounded spill files; tool and completion messages show a concise retained tail rather than claiming to contain a full log. Terminals are session-scoped and stop during shutdown or reload.

## Provenance

Selectively adapted at the repository owner's direction from `davis7dotsh/my-pi-setup@797eaf6d6f178759cf7aabde927ef15c91346e7e`, `skills/background-terminals/SKILL.md`. The upstream repository had no detected license; this is owner-directed adaptation, not a claim of licensed or open-source reuse.
