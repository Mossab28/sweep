# sweep — conversational tidy & Claude-style plan output

**Date:** 2026-06-19
**Status:** Design approved, building
**Author:** Mossab (Mossab28)
**Builds on:** `2026-06-19-sweep-v2-audit-report-design.md`

## 1. Purpose

Today a tidy plan is rendered as a raw, one-line-per-file list inside a box —
a 673-line wall that overflows the terminal. It should read the way a person
(Claude) would describe a cleanup: a short natural-language summary grouped by
destination, the notable/sensitive files called out, full detail only on
demand — and then you can **talk to it** to adjust ("clean everything except
the screenshots", "why are you trashing that?") before anything moves.

## 2. User flow

Scan → an initial plan is built immediately → shown as a **grouped summary**:

```
Here's my plan for ~/Downloads — 673 files into 9 folders, 89 set aside.

  📄 Documents    312   pdf, reports, course notes
  🖼  Images       180   jpg, png, screenshots
  🎬 Videos         24   mp4
  ⌫  Quarantine    89   62 duplicates · 27 old installers

  ⚠️  Worth a look:
     • npm_recovery_codes.txt — looks like recovery codes; I left it untouched.
     • renamed: mt05-p24-final.pdf → mt05-p24.pdf  (and 1 more)

[y] apply · [d] details · [n] cancel · or tell me what to change ▸
```

The prompt accepts:
- **`y`** → apply the current plan (existing execute + undo).
- **`d`** → print the full per-file detail (no box, truncated per group), then
  re-show the prompt.
- **`n`** / empty → cancel, nothing changed.
- **anything else** → a chat instruction (see §4).

## 3. The grouped summary (local, no Claude call)

`summarizePlan(plan, index, now)` derives a `PlanSummary` purely from the plan:
- group `move`/`rename` ops by destination top folder → `{ folder, count, exts }`
  (a few representative extensions per folder);
- `quarantine` total, split into **duplicates** vs **junk** by re-checking each
  quarantined path against the index's duplicate groups and the junk heuristic;
- `moveCount`, `folderCount`.

`render.renderPlanSummary(summary, notable)` prints the natural-language summary
+ groups + the "Worth a look" block. `render.renderPlanDetail(plan)` prints the
full list as a plain indented list (no box; truncated to ~20 per folder with
"…and N more") so long filenames never overflow.

## 4. Conversational refine loop (strategy-based flows)

After the summary, typing an instruction enters a turn:

`converse.refineTurn(context, history, userMessage, client)` sends Claude:
- a compact **folder summary** (zone stats — never raw file lists),
- the **current plan summary** (text),
- the **conversation history** (prior user/assistant turns, kept small),
- the user's message.

Claude replies with a small JSON `{ reply: string, strategy: Strategy | null }`:
- `reply` — what it says back: an explanation, or a **clarifying question**;
- `strategy` — a new strategy if it's ready to re-plan, or `null` if it's
  waiting for the user's answer.

sweep prints `reply`. If `strategy` is present, it **re-expands locally**
(`expandStrategy`) into a new plan, re-summarizes, and re-shows. Loop until `y`.
**Nothing moves until `y`.** Conversation history is re-sent each turn (works
for both the Claude Code subscription and the API).

### `keep` exclusions (makes "all except X" work)

`Strategy` gains an optional `keep: string[]` — filename substrings to leave
untouched. `expandStrategy` skips any file whose name contains a `keep` entry
(in addition to sensitive files, §5). So "clean everything except the
screenshots" → Claude returns a strategy with `keep: ["screenshot", "Capture"]`,
and those files stay put; the summary notes "N kept untouched per your request".

**Scope:** the refine loop applies to the strategy-based tidy — the audit-menu
zones and `sweep <path>` in organize/clean mode. The free-form `sweep <path> -i
"sort photos by year"` per-file path keeps its current behaviour but **also**
gets the new summary render (§3); it has no chat loop in this iteration.

## 5. Sensitive files (local, safety)

`sensitive.isSensitive(name)` flags likely-secret files by pattern: recovery /
backup codes, `.env`, `id_rsa`/`*.pem`/`*.key`, `password`/`secret`/`credential`,
`wallet`/`seed`/mnemonic. `expandStrategy` **never moves or quarantines** a
sensitive file — it is left exactly where it is. `findSensitive(index)` returns
the list so the summary's "Worth a look" block can surface them ("looks like X;
I left it untouched"). Deterministic, free, always on.

## 6. Architecture (on the v2 base)

```
summarize.ts   summarizePlan(plan, index, now) → PlanSummary        (local)
sensitive.ts   isSensitive(name); findSensitive(index)              (local)
converse.ts    buildRefinePrompt(...) + refineTurn(...) → {reply, strategy|null}
strategy.ts    + `keep` in StrategySchema; expandStrategy skips keep + sensitive
render.ts      + renderPlanSummary(summary, notable); renderPlanDetail(plan)
cli.ts         tidyZone / runTidy: summary render + the y/d/n/chat loop
```

**Reused unchanged:** `expandStrategy` core, `executor`/`undo`, `store`,
`scanner`, `safety`, `categorize` (junk + ext→category).

### Types (added to `types.ts`)

- `PlanSummary { moveCount; folderCount; groups: { folder; count; exts: string[] }[]; quarantine: { total; duplicates; junk } }`
- `Notable { sensitive: FileEntry[]; renames: { from: string; to: string }[]; keptCount: number }`
- `ConversationTurn { role: 'user' | 'assistant'; text: string }`
- `Strategy` gains `keep?: string[]`.

## 7. Safety

Execution is unchanged: quarantine (no real deletion), dry-run, full undo,
bounds-checked ops, refuse `/`/`~`. Sensitive files are never touched. The chat
only ever changes the *proposed* plan; the user still confirms with `y`.

## 8. Testing (TDD)

- `summarize`: grouping by destination folder, counts, quarantine
  duplicate/junk split correct on a fixture plan+index.
- `sensitive`: patterns match (recovery codes, `.env`, keys) and don't
  false-positive on normal names; `findSensitive` returns the right files.
- `strategy.expandStrategy`: a `keep` entry leaves matching files untouched; a
  sensitive file is never moved/quarantined; everything else routes as before.
- `converse.refineTurn`: valid `{reply, strategy}` parsed; a question turn
  (`strategy: null`) parsed; malformed → friendly error; fences stripped;
  Claude mocked.
- `render.renderPlanSummary` / `renderPlanDetail`: groups, counts, the "Worth a
  look" block, and a non-overflowing detail list with per-group truncation.

All filesystem tests use temp fixtures; no network (the client is injected).

## 9. Out of scope (this iteration)

- Chat refine for the free-form `-i` per-file path (it gets the new render only).
- Overriding sensitive-file protection via chat (always protected for now).
- Persisting conversations across runs.
