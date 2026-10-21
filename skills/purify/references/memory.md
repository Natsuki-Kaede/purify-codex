# Distilling Codex-style memories

Codex writes memories as task logs: task narration, keyword dumps, thread ids, rollout pointers, and long lists of "do not …" lessons. Imported into another agent, or left in place, they teach the reader to write the same way. Distill each file to the facts a future session in that project would use.

## Before you start

- Archive every memory directory you will touch.
- Note the raw source (for example `~/.codex/memories/rollout_summaries/`); distilled files point to it instead of copying it.
- Leave memories written by other tools in their own format, and keep their index lines unchanged.

## Per file

1. **Decide.**
   - Delete a file that holds nothing a future session would use: a one-off Q&A unrelated to the project, or a finished task whose outcome is in git with no reusable lesson.
   - Merge files that cover the same topic.
   - When in doubt, keep and distill.
2. **Keep** architecture and ownership facts, file paths and entry points, exact commands and flags that worked, device and toolchain quirks, contracts and invariants, preferences the user actually stated (quote their words), and still-relevant branches, versions, and SHAs. Preserve identifiers exactly. Date point-in-time facts ("As of 2025-03-01, …").
3. **Drop** task narration, step-by-step histories, keyword lists, thread ids, and rollout paths. Replace the rollout block with one line: `Source: <raw path>/<basename>`.
4. **Lessons.** Keep a "user preference" or "failure" bullet only when it records a project-specific gotcha or a preference the user stated. Drop bullets that restate the user's global rules (verify SHAs, smallest change, report what is unverified, ask before acting).
5. **Write positively.** "`vendor/payments-sdk` was absent. Do not infer its retry policy from app code; mark it unverified" becomes "`vendor/payments-sdk` is absent from this checkout; read its retry policy from the SDK's own source."
6. **Keep the file as short as its durable facts allow.** Set no length target.

## Index

Replace keyword dumps with one line per file: `- [Title](file.md) — when this is useful`, keeping the text after the dash to about 120 characters. Remove lines for deleted files. Check that every link resolves and every file is indexed.

## Verify

- Count files and characters before and after.
- Re-run `scripts/scan.mjs agents` and compare the memory hit counts.
- Read two or three distilled files end to end.
