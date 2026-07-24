# Integrate explicit workflows

Type: task
Status: resolved
Blocked by: 03

## Question

Implement and verify the chosen workflow architecture with explicit-only invocation, no `ultracode` trigger, a maximum of three local children, structured phase outputs, inspectable artifacts, clear background notifications, and complete child-tool guards. Children must exclude workflow tools; `Agent`, `get_subagent_result`, and `steer_subagent`; `ask_user`; and `bg_start`, `bg_status`, `bg_list`, and `bg_kill`.

## Result

Implemented the independent explicit `workflow` engine plus shared child-session/activity/timeout helpers. Runs retain the restricted Node sandbox, structured output tool, bounded result/transcript artifacts, persistence, `/workflows` dashboard, and completion follow-ups. Local adaptations remove the `ultracode` trigger, require explicit user workflow requests in tool guidance, cap both total children and concurrency at three, add a 30-minute detached-background deadline, and deny `Agent`, `get_subagent_result`, `steer_subagent`, upstream recursive subagent tools, `workflow`, `ask_user`, and all `bg_*` orchestration tools inside children.

Child session creation uses Pi 0.80.10 `ModelRuntime` with local-only catalog refresh instead of the removed `createAgentSession({ modelRegistry })` option. Provenance and the owner-directed adaptation posture are recorded alongside the implementation.
