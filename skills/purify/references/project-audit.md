# Auditing a repository

The repository keeps every behavior and rule that something needs and loses the rest. Every removal or rewrite traces to evidence you can show the user.

## 1. Learn what the project needs

- Run `scripts/scan.mjs project <path>`. It lists:
  - the agent rule files in the repository, including ignored ones such as a local `docs/agents.md`;
  - the design documents, including git-ignored design folders;
  - the other docs and code comments with the most pattern hits;
  - code leads by category.
- Read the README, architecture and design docs, `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`, and the project's required checks (CI config, contributor guide). Follow the project's own rules, such as "leave test code unchanged".
- When the user narrows the audit to a folder, pass that folder (`scan.mjs project <repo>/<folder>`) and audit only that area. The root `AGENTS.md` still applies. Code enters only as the code side of a finding in the scope.
- Treat invariants stated in those files as requirements. A rule in the project's instructions that blocks repository-wide cleanup is overridden by the user's explicit request; propose rewriting it in the report.
- Map the trust boundaries: external input, network, persistence, authentication, secrets, and cross-process or RPC contracts. Checks there stay.

## 2. Audit

Start with the design documents (`design-audit.md`). A requirement in a design explains much of the code, and removing it there comes first. Keep the design findings at hand while auditing code: when a code finding traces back to a design, link the two.

For a large repository, split it into independent areas (for example the core data path; management, storage, and scripts; UI and docs). If your agent can run subagents, give each area to a read-only auditor in parallel with this file and `patterns.md`; otherwise go area by area. Each auditor:

- Starts from the scanner's leads, then reads the code and its callers. Grep for more leads where useful: language-specific defaults (`unwrap_or_default`, `?? ''`, `.ok()`), `let _ =`, `catch {}`, `fallback`, `legacy`, `compat`, `retry`, platform branches, single-implementation traits, one-caller helpers, config knobs.
- Confirms each candidate: finds the upstream guarantee, type, schema, or validation that makes a check redundant, or shows that no caller, input, platform, or incident reaches a branch. Evidence sources: callers, config validation, tests, `git log -S` / `git log -L`, the changelog, incident notes, design decisions.
- Reports each finding with `file:line`, category, what it is, the evidence, the proposed change (remove, simplify, or rewrite, with a sketch), the behavior impact, and confidence. It leaves out code it checked and found justified.

## 3. Report

Before writing, re-read the high-value findings yourself, including those from auditors. Write the report as SKILL.md Step 3 describes. In a repository the groups take these forms:

- **A** also covers deletions, de-duplication, and type-only changes.
- **B** covers anything a user, client, or operator could notice: status codes, error messages, logging, UI, and changes to agent rules that alter what an agent does.
- **K** covers security-adjacent checks, checks that rely on a library's internal behavior, persistence-contract changes, and the team's working practices.

Write each finding as one short paragraph, followed by a `Code:` line when code is involved. Confidence stays in your notes.

> **B3** `docs/design/upload.md:41` says uploads over 50 MB are rejected, but `src/upload.ts:212` accepts up to 200 MB. Ask which is intended; the code has shipped since v1.4.
> Code: `src/upload.ts:212`

Open with a short assessment of the repository's overall condition, and state there, once, any limit the reader needs to know (code that wasn't read, a team owner who gets a patch). Keep the close to three short sentences; if you saw pollution outside the scope, one of them offers to audit that area.

## 4. Apply the IDs the user picks

Follow SKILL.md Step 4. In a repository, also:

- Branch from the delivery branch, named by the project's convention.
- Prepare a patch for changes to a public API, as for team-owned files.
- Keep each commit to one category (text, or code for one module), and push only on request.
