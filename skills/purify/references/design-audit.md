# Auditing design documents

A requirement written into a design gets built, tested, and defended, so Codex's habits do their most lasting damage in design documents. Audit the designs before the code, then check the code against them.

## What the scanner reports

`scan.mjs project <path>` reads Markdown under directories named `docs`, `design`, `rfc`, `adr`, `spec`, `proposal`, `decision`, or `plan` (up to three levels down). It reads them whether they are tracked or git-ignored, and leaves out archive folders. Pass a folder inside the repository (`scan.mjs project <repo>/docs/design`) to audit only that folder; then every Markdown file in it is listed.

- **Per folder**: document count (with the git-ignored count), lines in non-goal or limitation sections, process-log sections and their lines, and weighted text hits.
- **Per document**:
  - text pattern hits;
  - the matching section headings, including dated log entries and log-style file names such as `*PROGRESS*` or `*HANDOFF*`;
  - the status line near the top, flagged when it still says pending;
  - tooling files that read the document;
  - counts of compatibility, speculative, and fallback terms, each with an example line.

The term counts are leads. "Fallback" is ordinary vocabulary in an HTTP client, and "migration" is real when the product has released data. Read the section before judging it.

## What a design needs

Keep these, and make them easy to find:

- the problem and who has it;
- the decision, its reasons, and alternatives someone actually proposed;
- contracts: APIs, data and persistence formats, protocol behavior, invariants;
- failure modes a caller, input, platform, or incident can reach, and how each is handled;
- acceptance criteria tied to the requirement;
- open questions, each with an owner.

## Patterns and treatment

| # | Pattern | Signal | Treatment | Group |
|---|---|---|---|---|
| 1 | Process log inside the design | "Implementation log", "实施记录", "开发交接 Prompt", review records, "independent review", CI run ids, SHA lists | Replace with one status line and a link, such as "Shipped in v0.4.2 (`abc123`); review notes in reviews/…". Move a handoff prompt into the handoff queue, or delete it once done. | A when git, the tracker, or a review doc already holds the record; otherwise B |
| 2 | Long non-goal or limitation list | "Non-goals", "Out of scope", "限制", "不做", "本期不包含 A、B、C…" | Keep an item only when it settles a question someone raised, or the reader would otherwise assume it. A "limitation" that is really a pending check belongs in the acceptance plan. | A to rewrite; B to drop a non-goal someone relied on |
| 3 | Proof-boundary acceptance | "本地通过不代表生产", "this only proves…", "未验证…" lists | State the acceptance criterion and who checks it, where. | A |
| 4 | Process or authorization boilerplate | "本 prompt 仅补齐设计，不授权实施", "do not send automatically" | Keep the workflow in the team's process file and delete it from the design. | A |
| 5 | Compatibility or migration nobody needs | Support for versions never released, data never deployed, callers that do not exist | Remove the requirement and the code that implements it. | B |
| 6 | Speculative extension | Plugin layers, extension points, config knobs, or fields reserved "for later" | Remove, or move to a backlog note. | B |
| 7 | Fallback, retry, or degradation with no named failure | "On failure fall back to…", "retry 3 times", "降级" | Keep protocol-required behavior and handling for reachable failures; remove the rest. | B |
| 8 | Phases beyond the requirement | Phase 2 and 3 for work nobody asked for, or phase 1 already meets the need | Drop the later phases or move them to the backlog. | B |
| 9 | Duplicated or superseded design | The same decision in several documents; a design the code no longer follows, left unmarked | Put "Superseded by …" at the top, or archive the document. | B |
| 10 | Design and code disagree | The design says X; the code does Y | Report the mismatch and ask which one is right. Leave both unchanged until the user answers. | B |
| 11 | Stale status line | "状态：尚未实现", "No-Go", "TBD", "仍在推进", at the top or further down, while the code has shipped | Update the line to what the code and history show, such as "已在 vX 交付（`sha`）". | A when git history shows it shipped as designed; B when the status records a decision, such as No-Go or deferred, that the code contradicts, or when the implementing code isn't in this repository and only in-repo evidence (consumers, later decision records, task status) shows it shipped |

Example of pattern 1:

- Before: "## Implementation log — 2025-03-10: first batch shipped in `abc123`, CI green; the gate was not rerun; nothing uploaded to third parties; production untouched. …"
- After: "Status: shipped in v0.4.2 (`abc123`). Review notes: `reviews/2025-03-10-upload.md`."

## Design and code together

- **When a B finding removes a requirement**, find the code that implements it: grep the identifiers, configuration keys, error codes, and test names the design mentions. List that code in the same finding. Change the design first, then the code, in one change set or two linked ones.
- **When a code finding from the project audit traces back to a design**, report the design finding first. The code change follows from it.
- **When the implementing code lives in another repository** or an unsynced dependency, link the consuming code you can read. Say once that the rest wasn't read, and ask before fetching it.
- **When tooling reads the document**, a wording edit can break hash pins, phrase checks, or CI. The scanner lists these consumers, scripts first; grep for the document's path and file name as well. Run the check read-only when you can. An edit is B when it would break a check that passes now, or touch text a phrase check covers; otherwise it stays A, with one note naming the pin.
- **When a finding has no code**, such as a process log or a duplicated rule, leave out the `Code:` line.
- **Long logs.** For a log-style file, confirm the pattern on a few entries and count the entries with `grep` instead of reading every one.

## Ownership and formats

- **Wording.** Rewriting wording is A.
- **Decisions.** Removing a requirement, a non-goal someone relied on, or a decision is the user's call (B).
- **Decision records (ADRs).** These are history. Add a superseding record rather than rewriting a past decision.
- **Formats.** The scanner reads Markdown and plain text. For docx, PDF, and online documents (Notion, Confluence, Feishu, Google Docs), ask for an export or a paste.
- **Language.** Rewrite in the document's own language.
