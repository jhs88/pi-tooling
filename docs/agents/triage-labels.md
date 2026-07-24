# Triage vocabulary on Hermes Kanban

Matt Pocock's five canonical triage roles map to Hermes Kanban states and card metadata as follows.

| Canonical role | Kanban representation | Meaning |
| --- | --- | --- |
| `needs-triage` | `triage` | Needs specification or maintainer evaluation |
| `needs-info` | `blocked` with a precise question | Waiting for missing information |
| `ready-for-agent` | `ready` with a configured assignee | Fully specified and runnable by an agent |
| `ready-for-human` | `blocked` with a human-action reason | Requires a human decision or operation |
| `wontfix` | `archived` with an explanatory comment | Intentionally not actioned |

Do not create GitHub labels merely to mirror these roles. The Kanban state and comment history are authoritative.
