# Provenance

This workflow engine was selectively copied and adapted at the repository owner's explicit direction from `davis7dotsh/my-pi-setup` commit `797eaf6d6f178759cf7aabde927ef15c91346e7e` (2026-07-24). The sandbox compilation boundary, UTF-8 phase-message limit, and regression fixture were selectively refreshed from commit `73bf4d826f39b5cab6b7865e706ba4a2669629ca` at the owner's direction on 2026-08-05.

Local adaptations make invocation explicit-only, cap each run at three total/concurrent local children, deny recursive workflow/subagent/question/background tools inside children, use `ModelRuntime` from Pi 0.83.0, and impose a 30-minute deadline on detached background runs. The restricted Node sandbox, structured output path, bounded persistence, artifacts, and dashboard are retained.

The pinned upstream repository had no detected license. This is owner-directed adaptation, not a claim that the source is open source or generally licensed for reuse. See `docs/history/selective-pi-tooling-extensions/research/upstream-compatibility-and-provenance.md`.
