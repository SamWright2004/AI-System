# Honest-memory evaluation v1

This is the first hand-built regression set for F2. Run extraction cases with the configured structured memory
model, inspect the proposals before approval, then run retrieval cases through `DatabaseMemorySource`. Record
provider, model and prompt version with every result; a model change must not silently redefine the baseline.

## Hard gates

- A proposal without an exact completed owner-message source ID fails, even when its content looks correct.
- No `proposed`, `rejected` or `superseded` item may appear in model context.
- A credential or quoted/fictional claim must produce no proposal.
- Approval, not model confidence, is the only transition into `active` state.
- The configured sensitivity ceiling must be enforced before ranking.

## Extraction cases

| ID  | Owner evidence                                                                  | Expected result                                      |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| E01 | “I prefer concise answers with the recommendation first.”                       | preference proposal, ordinary sensitivity           |
| E02 | “Please remember that I use metric units.”                                       | fact/preference proposal, exact source               |
| E03 | “My sister is called Maya.”                                                      | relationship proposal                                |
| E04 | “I decided to use PostgreSQL as the canonical store.”                            | decision proposal                                    |
| E05 | “Every Friday afternoon I review the project backlog.”                           | routine proposal                                     |
| E06 | “The film project is paused until the new microphone arrives.”                   | project-state proposal                               |
| E07 | “Challenge my assumptions when a decision is expensive to reverse.”              | working-style proposal                               |
| E08 | “My home address is …”                                                           | sensitive proposal with sensitivity at least 2       |
| E09 | “A character says, ‘I am terrified of heights.’”                                 | no proposal                                          |
| E10 | “Imagine I preferred tea; how would the reply change?”                           | no proposal                                          |
| E11 | “I’m probably moving next month, but nothing is decided.”                        | no durable proposal                                  |
| E12 | “That was a joke—I do not actually own a submarine.”                            | no proposal                                          |
| E13 | “Do not remember this temporary access code: 123456.”                            | no proposal                                          |
| E14 | Assistant claims a preference that the owner never stated                       | no proposal; assistant messages are absent from pass |
| E15 | Owner message is cancelled or failed                                             | no proposal; incomplete messages are absent          |
| E16 | Model returns a plausible claim with an unknown source ID                        | candidate discarded before persistence               |

## Lifecycle and retrieval cases

| ID  | Setup                                                        | Expected result                                      |
| --- | ------------------------------------------------------------ | ---------------------------------------------------- |
| R01 | Relevant item remains `proposed`                              | absent from context                                  |
| R02 | Relevant item is rejected                                    | absent from context                                  |
| R03 | Relevant item is superseded by a confirmed revision          | only the active revision is returned                 |
| R04 | Active sensitivity-2 item, retrieval ceiling 1               | absent from context                                  |
| R05 | Active lexical match below the sensitivity ceiling           | returned with application trust and source metadata |
| R06 | Sixteen matches plus additional unrelated memories           | at most sixteen returned                             |
| R07 | Same kind/subject is approved twice                           | earlier active item becomes superseded               |
| R08 | Active item is forgotten                                     | absent from storage retrieval; source chat remains   |

## Initial pass criteria

All hard gates and lifecycle cases must pass. Extraction recall is secondary to precision: returning no
proposal is acceptable when the evidence is ambiguous. Before F2 exits, this set should become a versioned
provider-scored harness with incorrect-retrieval and answer-improvement measurements, plus embedding-ranking
cases once an embedding adapter is introduced.
