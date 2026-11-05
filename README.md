# purify-codex

English | [简体中文](README.zh-CN.md)

purify-codex keeps AI coding agents from writing in the Codex style, and cleans up what that style already left behind. It has two parts:

- **`PURIFY.md`**, a reusable template of daily reporting rules to merge into global instructions;
- **`/purify`**, a skill that audits your agent setup and your repositories.

Codex models (GPT-5.x, GPT-6 Sol and Astra) have recognizable habits:

- padding replies with what they did *not* do and what stayed unchanged;
- proof-boundary disclaimers ("this does not prove…");
- "X, not Y" framing;
- invented or duplicated rules;
- fallbacks and re-validation that no requirement asks for.

OpenAI's own [prompting guide](https://developers.openai.com/api/docs/guides/latest-model) tells developers to switch these habits off. They spread anyway: into `AGENTS.md`, into memories, into other agents' `CLAUDE.md` / `GEMINI.md` through import features and copied rules, and into code and docs. Other models then read that text and copy the style.

## Install

```bash
npx github:Natsuki-Kaede/purify-codex
```

For each agent it finds, the installer installs the `/purify` skill. It preserves recognized rules already merged into global instructions and existing user-maintained references. Where rules are needed, it adds a managed block:

| Agent | Rules | Skill |
|---|---|---|
| Claude Code | `~/.claude/PURIFY.md`, referenced by a managed `@PURIFY.md` block in `~/.claude/CLAUDE.md` | `~/.claude/skills/purify` |
| Codex | inline in `~/.codex/AGENTS.md` (or `AGENTS.override.md` when present) | `~/.codex/skills/purify` |
| Gemini CLI and Antigravity | inline in `~/.gemini/GEMINI.md`, which both read | `~/.gemini/skills/purify` |

Installer-owned blocks sit between `<!-- purify-codex:start -->` and `<!-- purify-codex:end -->` markers. Run the command again to update managed blocks and copied skills; `uninstall` removes them. User-maintained inline rules, explicit read references and legacy unmarked `@` references are preserved, along with the files they reference. Linked skill folders, such as those made by the skills CLI, are left in place.

An existing unreferenced `PURIFY.md` is preserved. In that case, Claude Code receives an inline managed block. Examples inside fenced code blocks are left untouched. Uninstall checks user references across all supported agents before removing a managed rules file.

If you maintain the rules in your own wording, install or remove only the audit skill:

```bash
npx github:Natsuki-Kaede/purify-codex install --skill-only
npx github:Natsuki-Kaede/purify-codex uninstall --skill-only
```

Recognition covers the bundled rule wording, including clauses split across sections and the stronger implementation rule covering caches, abstractions and existing guarantees. Review other wording manually. Daily rules apply through global instructions; invoke the skill when you want an audit.

For other agents, paste [`PURIFY.md`](skills/purify/PURIFY.md) into their global rules (Cursor User Rules, Windsurf `global_rules.md`, Claude app preferences), and add the skill with the [skills CLI](https://github.com/vercel-labs/skills): `npx skills add Natsuki-Kaede/purify-codex`.

The installer and the scanner need Node 18 or later.

## Use

| Command | What it does |
|---|---|
| `/purify` | Audit your agents, then offer to audit the current repository |
| `/purify agents` | Audit instruction files, rules, memory, skills, and sync settings for Codex, Claude Code, the Claude app, Antigravity, Gemini CLI, Cursor, Windsurf, GitHub Copilot, OpenCode, and more |
| `/purify <path>` | Audit one repository: design documents, code, docs, comments, and the agent rules inside it |

In Codex, mention the skill as `$purify` or ask for it by name.

The audit modes end with a report. Findings carry IDs in three groups:

- **A, apply directly**: the change keeps the behavior.
- **B, your decision**: the change alters behavior, configuration, or what gets loaded.
- **K, keep**: things you might expect to change, with the reason to keep them.

Reply with the IDs you want changed. The skill backs up files before editing them, works on an isolated branch inside repositories, and runs the project's checks after code changes.

## What it checks

- **Instruction files.** Rules that produce the style, such as lists of checks to report as "unverified", "does not authorize" boilerplate, duplicated prohibitions, and constants copied from code.
- **Cross-agent channels.** These include:
  - instruction files loaded twice, including copies written by import features with agent names swapped;
  - rule files left inside agent directories;
  - broken references;
  - shared skills whose copies drifted apart;
  - hooks copied from another agent;
  - sync settings that will bring the pollution back.
- **Memories.** Inspect both Codex `memories_v2` and `memories` directories and their summary files. Confirm active sources from the session. Correct generated memories through the host's supported mechanism when explicitly requested; distill user-maintained imported copies into durable facts.
- **Daily reporting rules.** Recognized inline text, managed blocks, `@` references and explicit `Read and follow` / `读取并遵循` references. The scan reports configuration found on disk; review custom wording and establish actual loading from session evidence when needed.
- **Design documents.** These are read from `docs/`, `design/`, `rfc/`, `adr/`, `spec/`, and similar folders, including git-ignored ones. The audit looks for:
  - process logs and handoff prompts left inside designs;
  - long non-goal and limitation lists;
  - proof-boundary acceptance criteria;
  - compatibility nobody needs, speculative extension points, and unexplained fallbacks.

  Design findings are linked to the code that implements them. See [`design-audit.md`](skills/purify/references/design-audit.md).
- **Repositories.** Fallbacks that hide broken contracts, repeated validation, swallowed errors, platform branches for platforms the code can't build on, single-use layers, dead code, negative comments, and agent rule files.

## The scanner

`skills/purify/scripts/scan.mjs` is a read-only, dependency-free Node script:

```bash
node skills/purify/scripts/scan.mjs agents
node skills/purify/scripts/scan.mjs project ~/code/my-repo
```

It reads instruction text and a few named configuration keys. It prints sample lines from instruction files, and only counts for files under directories named `private`, `secret`, or `credential`. It writes nothing.

## Development

```bash
npm test
```

The tests build small fixtures in a temp directory and run the installer and the scanner against them.

## License

MIT
