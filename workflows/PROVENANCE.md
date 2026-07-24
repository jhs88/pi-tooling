# Provenance

This workflow engine was selectively copied and adapted at the repository owner's explicit direction from `davis7dotsh/my-pi-setup` commit `797eaf6d6f178759cf7aabde927ef15c91346e7e` (2026-07-24).

Local adaptations make invocation explicit-only, cap each run at three total/concurrent local children, deny recursive workflow/subagent/question/background tools inside children, use `ModelRuntime` from Pi 0.80.10, and impose a 30-minute deadline on detached background runs. The restricted Node sandbox, structured output path, bounded persistence, artifacts, and dashboard are retained.

The pinned upstream repository had no detected license. This is owner-directed adaptation, not a claim that the source is open source or generally licensed for reuse. See `.scratch/selective-pi-tooling-extensions/research/upstream-compatibility-and-provenance.md`.
