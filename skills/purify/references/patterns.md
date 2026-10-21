# Codex-style pollution: what to remove, what to keep

## Where it comes from

OpenAI's prompting guide for GPT-6 Astra lists habits that developers should switch off in their prompts: telling the reader what the model won't do, what stays unchanged, or how it separated the work; unprompted "X, not Y" contrasts; unsolicited warnings, disclaimers, approval flows, and safety checklists for hypothetical risks; and stock phrases ([latest-model guide](https://developers.openai.com/api/docs/guides/latest-model), [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)). User reports add invented rules that the model keeps enforcing after correction, scope expansion, fallbacks that fill in missing data, and tests written for test helpers ([openai/codex#42937](https://github.com/openai/codex/issues/42937), [OpenAI community thread](https://community.openai.com/t/codex-astra-gpt-6-is-absolutely-terrible-and-not-worth-using/1399757)).

These habits leave text behind: in instruction files, memories, skills, code comments, docs, and changelogs. Other agents read that text and copy the style.

## The judging test

Keep a rule, sentence, or check when you can name what needs it: a user decision, an incident, a contract, a reachable failure (a caller, input, platform, or event you can point to), or a security or data-integrity need. Rewrite or remove the rest.

## Text patterns

| # | Pattern | Typical text | Treatment |
|---|---|---|---|
| 1 | What was not done / left unchanged | "本次仅修改 A，未改动 B、C，也未运行 D"; "no changes to X"; "X is unchanged" | State what changed and the next step. Mention an omission only when the reader would otherwise assume it happened. |
| 2 | Proof-boundary disclaimer | "X 不代表 Y"; "a passing test proves only its own fixture"; "mark CI, packaging, and runtime as unverified unless each one ran" | List the checks that ran and what they showed. If a result could be read as stronger evidence, say once what remains untested. |
| 3 | Authorization boilerplate | "Reviews … do not authorize implementation"; "these rules grant no additional authorization"; "未经授权的操作一律不做" plus lists of "不提交/不 push/不发版" | Say where to stop or what is granted: "For review requests, deliver the findings and wait for the go-ahead." List granted actions only. |
| 4 | Contrast nobody raised | "不是 X，而是 Y"; "X, not Y"; "rather than" used to dismiss an option nobody proposed | State Y. |
| 5 | Hypothetical-risk hedge | "以防万一"; "潜在风险"; "just in case"; safety checklists added unasked | Delete, unless a real failure path is named. |
| 6 | Duplicated rule | The same rule in AGENTS.md, a role file, and the global file | Keep it once where it belongs; link from the others. |
| 7 | Invented or one-off rule | A rule with no traceable user decision or incident; a single event turned into permanent law ("every complex fix gets an independent review") | Ask the user, or delete. |
| 8 | Old-model or Codex-only rule | Rules written around a past model's habits; Codex tool names (`spawn_agent`, `send_message_to_thread`, `apply_patch`) inside another agent's files | Rewrite for the current tool, or delete. |
| 9 | Copied constants | Limits, timeouts, and defaults copied from code into instruction files | Describe the invariant and point to the source file. |
| 10 | Task-log memory | "Task 1 … success", `rollout_summary_files` blocks, keyword dumps, "Failures and how to do differently" lists | Distill to durable facts; see `memory.md`. |
| 11 | Stock phrases | "delve", "leverage", "it's worth noting", "Bottom line:", "In short:" | Plain wording. |
| 12 | Unexplained labels and coined nouns | "S2 收口", "A3 待回签", "T2", "⑧", "口径已拉齐": stage numbers, item IDs, and compound nouns the reader never saw defined | Replace each with what it refers to, or define it where it first appears; turn noun stacks into sentences with a subject and an action. |

A short "avoid" rule is fine. Long prohibition lists keep the forbidden behavior in the reader's focus; prefer one direct instruction.

### Common Codex-era rules and their rewrites

| Found | Rewrite |
|---|---|
| "A planning request does not authorize any implementation." | "For a planning or review request, deliver the plan or findings and wait for a go-ahead before editing." |
| "Treat CI, packaging, and runtime as unverified unless each one actually ran." | "List the checks that ran and their results. If a result could be read as stronger evidence, say once what remains untested." |
| "Nothing in this file grants extra permissions." | Delete. |
| "This excludes releases, deployments, and pull requests." | "A release, deployment, or pull request needs a separate request." |
| "Prefers strict proof boundaries." | "Prefers claims backed by evidence." |
| "A test proves only its declared fixture …" | Delete, or state the positive procedure (baseline, repeat, report variance). |
| "These rules cover the requested change, not repository-wide cleanup." | Delete; "make focused changes" already covers it. |

## Code patterns

| Pattern | Example | Keep when |
|---|---|---|
| Fallback that hides a broken contract | `profile?.name ?? ''` where the API type requires `profile`; `unwrap_or_default()` on validated config | The input really can be absent (external data, optional field) |
| Repeated validation | Re-checking what config validation, the type system, a schema, or the callee already guarantees | It is the owning trust boundary |
| Swallowed error | `catch {}`; `let _ = …` on a fallible call; `except: pass` | The contract says the failure is ignorable, and that is documented |
| Speculative knob | Retries, timeouts, caches, feature flags, or config options with no named requirement | A requirement, incident, or measured problem asks for it |
| Shim or platform branch | Adapters for callers that don't exist; `cfg(not(unix))` in a crate that can't build on Windows | The platform or caller exists |
| Single-use layer | A factory, wrapper, or trait with one implementation and one caller | It isolates a real boundary (I/O, FFI, a test seam the tests use) |
| Dead code | Unreachable arms, unused exports, fields only tests read | — |
| Duplicated helper | The same time/parse/lock helper copied into several modules | — |
| Test of a test or of a library | Assertions on serde behaviour, helper self-tests, duplicated assertions | Project rules forbid test changes: then report only |

## Keep

- Invariants written as "never" that state a real contract ("a refund never exceeds the captured amount").
- Checks at trust boundaries, authentication, TLS verification, secret handling, integrity checks, and resource bounds.
- Safety notes where an operator could lose data or lock themselves out.
- A limitation the reader would otherwise miss ("built, not yet run end to end").
- The user's own words and decisions. Quote them; rewrite them only with the user's consent.
- Fallbacks that a protocol or standard requires.
