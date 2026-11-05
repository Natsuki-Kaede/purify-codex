---
name: purify
description: Audit and clean Codex-style pollution in AI agent setups and in repositories, including their design documents. Pollution means replies padded with what was not done or left unchanged, proof-boundary disclaimers, "X, not Y" framing, invented or duplicated rules, task-log memories, and over-defensive code (fallbacks, repeated validation, shims). Covers Codex, Claude Code, the Claude app, Antigravity, Gemini CLI, Cursor, Windsurf, GitHub Copilot, OpenCode, and others. Use for /purify, 净化, Codex 风格污染, 过度设计, 过度边界, de-hedging AGENTS.md / CLAUDE.md / GEMINI.md or agent memory, or cleaning a codebase written with GPT-5.x / GPT-6 (Sol, Astra) in Codex.
---

# Purify

Codex models tend to tell the reader what they won't do, list what stayed unchanged, add disclaimers for hypothetical risks, invent rules, and write defensive code that no requirement asks for. OpenAI's own prompting guide tells developers to switch these habits off. The habits spread anyway:

- into Codex's own memory and `AGENTS.md`;
- into other agents' instruction files, memories, and hooks, through import and sync features and copied rules;
- into the code and docs of the repositories these agents work in.

Other models then read that text and imitate it. This skill finds the pollution, shows the evidence, and changes what the user picks. Daily reporting rules belong in the agent's global instructions; `PURIFY.md` is a reusable template. Keep rules already merged there. The installer (`npx github:Natsuki-Kaede/purify-codex`) installs the audit skill and supplies rules where needed; use `install --skill-only` for custom wording maintained by the user.

## Modes

| Invocation | What it does |
|---|---|
| `/purify` | Agent audit, then an offer to audit the current repository |
| `/purify agents` | Audit agent instructions, rules, memory, skills, hooks, and settings on this machine |
| `/purify <path>` | Audit one repository: design documents, code, docs, comments, and the agent rules inside it. A folder inside a repository narrows the audit to that folder |

Each mode ends with a report. Files change only for the finding IDs the user picks, or for a whole group when the user says so ("apply A").

## Step 1: Scan

Run the read-only scanner from this skill's directory. It needs Node 18 or later.

```sh
node <skill-dir>/scripts/scan.mjs agents
node <skill-dir>/scripts/scan.mjs project <path>
```

Add `--json` for structured output.

**Agents mode** prints, for each installed agent:

- its global instructions, including `@` references and explicit `Read and follow` / `读取并遵循` references; when it has none, which paths were checked;
- recognized rule configuration: inline text, managed inline blocks, or references to recognized rules;
- memory directories and summary files found on disk, including both Codex `memories_v2` and `memories`;
- its hooks, flagging any that name a different agent;
- the text that is kept in the account and not on disk.

It then prints, across all agents:

- the skills with the most hits, and skill copies that drifted apart;
- duplicated or name-swapped instruction files;
- instruction files sitting inside agent directories;
- the Codex settings that matter.

**Project mode** prints:

- the agent rule files;
- design documents, including git-ignored design folders, with their non-goal and limitation sections, process logs, and compatibility, speculative, and fallback terms;
- the other docs and code comments with the most hits;
- code leads.

Text hits include internal labels that a file uses but never explains (`label`) and coined compound nouns (`jargon`).

Hits are leads. Confirm each one by reading the file. Without Node, walk the paths in `references/locations.md` by hand.

## Step 2: Judge

Read `references/patterns.md`. Its test: keep a rule, sentence, or check when you can name what needs it, such as a user decision, an incident, a contract, a reachable failure, or a security or data-integrity need. Rewrite or remove the rest.

**Agent audit.** Use `references/locations.md` and check:

1. **Global instructions and their imports.** Look for rules that produce the style: lists of checks to report as unverified, "does not authorize" boilerplate, "proof boundaries", copied constants, and duplicated prohibitions.
2. **Text loaded twice or by accident.** Examples:
   - a home-level `AGENTS.md` next to `CLAUDE.md` or `GEMINI.md`;
   - a copy written by an import feature with agent names swapped;
   - an `AGENTS.md` left in an archive or backup inside an agent directory.

   Name which tool loads which file.
3. **Open channels.** Import and sync settings, shared skill directories, and hooks copied from another agent will bring the pollution back. For example, a Codex hook that runs `git-ai checkpoint claude` records Codex's edits as Claude's. Propose closing or correcting each one.
4. **Memory.** Distill memories imported from Codex, or written in its task-log format, with `references/memory.md`.

   For Codex-managed memory, check which sources the active session actually uses. The scanner inventories both `~/.codex/memories_v2/` and the older `~/.codex/memories/`; files on disk may be inactive. Preserve user preferences, source pointers and generated files. When the user explicitly requests a memory correction, use the correction mechanism supported by the active host. Treat wording problems with a scoped correction; keep memory loading settings intact.
5. **Skills.** Look for Codex-only tool names inside other agents' skills, proof-boundary boilerplate, and copies that drifted apart. A skill installed from a package (`~/.agents/skills`, plugin directories) belongs to its publisher: report it, and edit a local copy only if the user accepts the drift.
6. **Daily reporting rules.** Inspect recognized configuration and read custom wording the scanner does not recognize. Detection describes files on disk; establish actual loading from session evidence when it matters.
   - Reuse rules already merged into global instructions. For custom wording, install only the audit skill with `npx github:Natsuki-Kaede/purify-codex install --skill-only`.
   - Where rules are needed, propose using the template once in the agent's global instructions. The installer preserves user-maintained references and recognized inline rules; it updates its own marked blocks.
7. **Repositories.** When the current repository's `CLAUDE.md` or `GEMINI.md` only imports `AGENTS.md`, recommend a project audit.
8. **Account-level text.** Claude app preferences, styles, and project instructions; Cursor User Rules; and ChatGPT custom instructions are not on disk. Ask for them at the end of the report.

**Repository audit.** Follow `references/project-audit.md`, and judge design documents with `references/design-audit.md`.

## Step 3: Report

Report only findings you confirmed against the source, and drop hits that did not hold.

Group the findings, and within each group sort them by area (agent rules, design documents, docs, code by module). Give them stable IDs, such as A1 or B3:

- **A, apply directly**: edits that keep the behavior. This covers rule rewrites with the same meaning, dead code, duplicates, and comments.
- **B, your decision**: anything that changes behavior, configuration, or what gets loaded. This covers new files, settings, deleted rules, status codes, and UI.
- **K, keep**: leads that look like pollution but are contracts or needed; at most about five lines, one each with the reason.

Each finding gives its location, what it is, the evidence, and the proposed change. B findings also state the impact. The location is `file:line`, a file plus a key for configuration, or a path that is missing.

Open with the main conclusion. Close by saying once how the audit ran and what you need from the user.

Save long reports outside tracked files, such as a git-ignored docs folder or a scratch directory, and give the path. Copy only the excerpts you need from private or credential directories.

Write the report using the applicable global reporting rules. Use the bundled `PURIFY.md` as a template for gaps, preserving the user's decisions.

## Step 4: Apply what the user picks

- **Back up first.** Before editing files outside a git repository, archive every file you will touch into a timestamped directory, and give its path.
- **Repositories.** Work on an isolated branch or worktree, keep unrelated changes, and commit only when asked.
- **Files owned by a team, a package, or another tool.** Prepare a patch for the user.
- **Memory.** Follow `references/memory.md`, then re-run the scanner and compare the counts.
- **Code.** Run the project's required checks, and report which ran and their results.
- **Instruction files.** These load at session start, so tell the user once that new sessions pick up the change.
