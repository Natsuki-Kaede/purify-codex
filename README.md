# purify-codex

English | [简体中文](README.zh-CN.md)

purify-codex keeps AI coding agents from writing in the Codex style, and cleans up what that style already left behind. It has two parts:

- **`PURIFY.md`**, a short set of plain-reporting rules that every agent session loads;
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

For each agent it finds, the installer loads the rules and installs the `/purify` skill:

| Agent | Rules | Skill |
|---|---|---|
| Claude Code | `~/.claude/PURIFY.md`, imported by `@PURIFY.md` in `~/.claude/CLAUDE.md` | `~/.claude/skills/purify` |
| Codex | `~/.codex/PURIFY.md`, imported by an `@` line with its absolute path in `~/.codex/AGENTS.md` | `~/.codex/skills/purify` |
| Gemini CLI and Antigravity | inline in `~/.gemini/GEMINI.md`, which both read | `~/.gemini/skills/purify` |

The copy in `GEMINI.md` sits between `<!-- purify-codex:start -->` and `<!-- purify-codex:end -->` markers. Run the command again to update, and add `uninstall` to remove everything it added. A skill folder that is a symlink, such as one made by the skills CLI, is left in place. New sessions pick up the rules.

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
- **Memories.** Task-log memories imported from Codex are distilled down to durable facts. The audit also checks `memory_summary.md`, which Codex loads into every session.
- **Purify rules.** Whether each agent loads `PURIFY.md`, and where its own instructions repeat the same rules.
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
