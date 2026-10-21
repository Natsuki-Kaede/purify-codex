# Where agents keep instructions, memory, and skills

`scripts/scan.mjs agents` checks every path below that exists. Paths marked † come from third-party documentation; the scanner only checks whether they exist.

| Tool | Global instructions | Project instructions | Memory | Skills | Also check |
|---|---|---|---|---|---|
| Codex | `~/.codex/AGENTS.md`, `~/.codex/AGENTS.override.md`; `config.toml` keys `developer_instructions`, `model_instructions_file` | `AGENTS.md` / `AGENTS.override.md` from the repository root down to the working directory; `project_doc_fallback_filenames` | `~/.codex/memories/`; `memory_summary.md` is loaded into every session and regenerated from session logs. Settings: `[features] memories`, `[memories] generate_memories`, `[memories] use_memories` | `~/.codex/skills`, `~/.agents/skills` | Hooks in `~/.codex/hooks.json` and in `config.toml` (`[[hooks.<Event>.hooks]]`); desktop import settings `[desktop] external-agent-import-sync-enabled` and `external-agent-import-sync-item-types` |
| Claude Code | `~/.claude/CLAUDE.md` and its `@imports`, `~/.claude/rules/` | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/rules/` in the repository and every parent directory; recent versions also load `AGENTS.md` | `~/.claude/projects/<encoded-path>/memory/`; its `MEMORY.md` index loads every session | `~/.claude/skills`, `.claude/skills` | Subagents `~/.claude/agents`, commands, output styles; `settings.json` hooks on `SessionStart` / `UserPromptSubmit` can inject text |
| Claude app (desktop, web, Cowork) | Personal preferences, styles, and project instructions live in the account | — | Account memory | Cowork skills: `~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/` (macOS), `%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\` (Windows) | Ask the user to paste account-level text |
| Antigravity | `~/.gemini/GEMINI.md`, `~/.gemini/AGENTS.md`† | `GEMINI.md`, `AGENTS.md`, `.agent/rules/` or `.agents/rules/`†, workflows in `.agent/workflows/`† | Knowledge items in `~/.gemini/antigravity/knowledge/` | `~/.gemini/antigravity/skills`, `~/.gemini/antigravity/global_skills`, `.agents/skills` | Shares `~/.gemini/GEMINI.md` with Gemini CLI |
| Gemini CLI | `~/.gemini/GEMINI.md` | `GEMINI.md` in the project and its parents; `settings.json` `contextFileName` can add `AGENTS.md` | Saved memories are appended to `GEMINI.md` | `~/.gemini/skills`, `.agents/skills` | Hooks in `~/.gemini/settings.json` |
| Cursor | User Rules in Settings → Rules (ask the user) | `.cursor/rules/*.mdc`, legacy `.cursorrules`, `AGENTS.md` | Memories in settings | `~/.cursor/skills` | |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | `.windsurf/rules/`, legacy `.windsurfrules` | `~/.codeium/windsurf/memories/` | `~/.codeium/windsurf/skills` | |
| GitHub Copilot | VS Code user `prompts/` folder (`*.instructions.md`) | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md` | — | `~/.copilot/skills` | |
| OpenCode | `~/.config/opencode/AGENTS.md` | `AGENTS.md` | — | `~/.config/opencode/skills` | |
| Amp† | `~/.config/amp/AGENTS.md`† | `AGENTS.md` | — | `~/.config/agents/skills` | |
| Cline, Roo, Kiro | — | `.clinerules`, `.roo/rules/`, `.kiro/steering/` | — | `.roo/skills`, `~/.kiro/skills` | |
| Shared | `~/AGENTS.md`, `~/CLAUDE.md`, `~/GEMINI.md`: tools that walk parent directories apply them to every session under home | | | `~/.agents/skills`, the `npx skills` canonical directory, symlinked into each agent | |

## Channels that spread pollution between agents

Check each one. A channel that stays open will bring the pollution back after you clean it.

1. **Import and sync features.** The Codex desktop app can import Claude Code's configuration, skills, hooks, and projects (`external-agent-import-sync-*`). An import can write a copy of `~/.claude/CLAUDE.md` to `~/AGENTS.md` with agent names swapped and references broken; Claude Code then loads both files in every session. One-off migrations, such as importing Codex memory into Claude Code, bring the task-log format along.
2. **Home-level files.** Anything in `~` applies to every session under home.
3. **Repository `CLAUDE.md` that only says `@AGENTS.md`.** Claude reads whatever Codex wrote into `AGENTS.md`.
4. **Shared skills.** One skill symlinked into many agents carries its style everywhere; copies that drifted apart show where someone edited one copy only.
5. **Hooks.** Hooks that inject text at session start or on each prompt; hooks copied from another agent, such as a Codex hook that runs `git-ai checkpoint claude` and so records Codex's edits as Claude's.
6. **Account-level text** (Claude app preferences, ChatGPT custom instructions, Cursor User Rules) drafted by Codex and pasted in.
7. **Instruction files left inside agent directories.** An `AGENTS.md` or `CLAUDE.md` in an archive, import, or backup folder loads as a rule whenever an agent reads files there.
