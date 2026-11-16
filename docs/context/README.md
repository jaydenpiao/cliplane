# Context map

Start with current.md. Treat Git and GitHub as live facts; documents are dated evidence.

| Need                                      | Canonical source                    |
| ----------------------------------------- | ----------------------------------- |
| Current increment, blockers, next command | current.md                          |
| Behavior and setup                        | ../../README.md                     |
| Commands, tooling, skills and access      | ../development.md                   |
| Product scope and milestone acceptance    | ../backlog.md                       |
| Live tasks and issue board                | ../project/board.md                 |
| Review, QA, staging and production gates  | ../project/workflow.md              |
| Durable decisions                         | ../adr/                             |
| Architecture                              | ../architecture/overview.md         |
| Security and public-beta blockers         | ../security/threat-model.md         |
| Research and integration choices          | ../research/practice.md             |
| Prior verification                        | ../verification.md                  |
| Operational recovery                      | ../runbooks/local-and-production.md |
| Demo recording and publishing             | ../demos/README.md                  |

Keep one source of truth per fact. Link it instead of copying instructions everywhere.
Update the current handoff before stopping, including partial/uncommitted work.

A handoff names the goal, branch, verified revision/checks, changed files, remaining
steps, exact commands, external permissions and linked issue/PR. A fresh agent should
continue the next unfinished step without repeating completed research or tests.
