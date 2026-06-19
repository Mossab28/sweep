# sweep — AI-powered file cleanup & organizer CLI

**Date:** 2026-06-19
**Status:** Design approved, pending spec review
**Author:** Mossab (Mossab28)

## 1. Purpose

`sweep` is a free, open-source command-line tool that uses Claude to clean up
and organize the files on a user's computer. The user points it at a messy
folder (Downloads, Desktop, Documents, or any path); `sweep` scans it locally,
sends a compact summary to Claude, and gets back a concrete reorganization
**plan**. The user reviews the plan, confirms, and `sweep` executes it — with a
full **undo** available afterwards.

Goal: ship something genuinely useful and safe, build an open-source following
("fame"), and keep the door open to a paid tier later if a real market appears.

### Non-goals (v1)

- No GUI / desktop app (CLI only).
- No hosted backend; the user brings their **own Claude API key**. We pay for
  no one's tokens.
- No real deletion (everything "deleted" is quarantined, see §6).
- No whole-disk `/` scanning; scans are bounded to user content (see §6).
- The existing VPS / Dokploy setup is **not** used by the engine. It may host a
  marketing landing / waitlist later — out of scope here.

## 2. Users & core use case

Developers and power users whose Downloads/Desktop/project folders accumulate
thousands of files (images, installers, code, docs). They run `sweep`, pick a
**mode** or type a **free-form instruction**, and get their folder tidied with
one confirmation.

## 3. Form factor & stack

- **Language:** Node.js + TypeScript.
- **Distribution:** `npx` (package published as `@mossab/sweep`, with `sweep` as
  the bin name; the bare `sweep` npm name is taken by an abandoned package).
- **AI access:** user-provided Claude API key (env var `ANTHROPIC_API_KEY` or
  `sweep auth`). Uses the official `@anthropic-ai/sdk`. Default model: the latest
  capable Claude model available at build time (configurable).

## 4. Engine approach: local scan → compact summary → Claude

Claude never sees raw file contents or thousands of paths verbatim. The flow:

1. **Scan locally** — walk the target directory, collecting per file: relative
   path, name, extension/type, size, modified date, and a partial content hash
   (for duplicate detection). Apply the exclusion list (§6).
2. **Build a compact Index** — an in-memory structure summarizing the tree
   (counts by type, size buckets, duplicate groups, notable large/old files,
   a sampled/aggregated file listing) sized to fit comfortably in a prompt.
3. **Compose intent** — a preset prompt (`clean` or `organize`) and/or the
   user's free-form natural-language instruction.
4. **Ask Claude** — send Index + intent, request a **Plan** as strict JSON.
5. **Validate & show** — validate the JSON against the Plan schema, reject any
   operation outside the target/safety bounds, and render a diff-style preview.
6. **Confirm → execute → journal** — on explicit confirmation, apply operations
   one by one, writing an undo journal.
7. **Undo** — `sweep undo` replays the journal in reverse.

This keeps token cost low, scales to large folders, and keeps Claude's role to
*planning*, never direct filesystem mutation.

## 5. Architecture (isolated modules)

Each module has one responsibility, a typed interface, and is unit-testable in
isolation. The Claude call is mocked in tests.

```
cli/        Command parsing, interactive mode/instruction prompts, plan preview,
            confirmation. Commands: `sweep <path>`, `sweep undo`, `sweep auth`.
scanner/    Walks the target dir, applies exclusions, computes per-file metadata
            + partial hash, groups duplicates. Produces an Index. No mutation.
intent/     Preset prompts (clean | organize) + free-form instruction handling.
            Pure prompt construction; no I/O.
planner/    Builds the Claude prompt from Index + intent, calls the Anthropic
            SDK, parses and validates the returned Plan JSON against the schema.
executor/   Applies a validated Plan operation by operation; writes an UndoLog.
undo/       Reads the most recent UndoLog and replays it in reverse to restore.
safety/     Exclusion list, forbidden-path guards, quarantine ("trash") handling.
```

### Key data types

- `Index` — summary of the scanned tree (see §4.2).
- `Intent` — `{ mode: 'clean' | 'organize' | 'custom', instruction?: string }`.
- `Operation` — one of:
  - `{ op: 'mkdir', path }`
  - `{ op: 'move', from, to }`
  - `{ op: 'rename', from, to }`
  - `{ op: 'quarantine', path }` (the v1 "delete": moves to trash, see §6)
- `Plan` — `{ summary: string, operations: Operation[] }`.
- `UndoLog` — `{ timestamp, target, applied: AppliedOp[] }` recording the inverse
  of each executed operation.

## 6. Safety model (non-negotiable)

1. **Bounded scan.** Refuse to operate on `/`, a bare `~`/home root, or known
   system directories. Default suggested targets: `~/Downloads`, `~/Desktop`,
   `~/Documents`. The user may pass an explicit path, still subject to the
   forbidden-path guard.
2. **Default exclusions.** Skip dotfiles/dot-dirs, `.git`, `node_modules`,
   application bundles, and OS/system paths. Exclusions are configurable.
3. **No real deletion in v1.** Any "delete" becomes a `quarantine` op moving the
   file to `~/.sweep/trash/<timestamp>/`. Nothing is `rm`'d.
4. **Dry-run by default.** The plan is shown and nothing on disk changes until
   the user explicitly confirms.
5. **Plan validation.** Every operation's source and destination must resolve
   inside the target directory (or the quarantine). Operations escaping these
   bounds are rejected and the run aborts.
6. **Undo journal.** Each execution writes a timestamped `UndoLog` under
   `~/.sweep/undo/`; `sweep undo` restores the last run.

## 7. Modes & free-form instruction

- `clean` — find duplicates, junk/temp files, old installers, large unused
  files; propose quarantining/archiving to free space.
- `organize` — sort into intelligent category subfolders (images, docs,
  installers, code, …) and clean up messy filenames.
- `custom` — the user types a natural-language instruction ("group all my dev
  projects", "sort photos by year"); the same engine turns it into a Plan.

Presets are just canonical prompts over the identical engine — minimal extra
code.

## 8. Testing (TDD)

- `scanner` — exclusion rules honored; duplicate grouping correct via hash.
- `safety` — forbidden paths (`/`, `~`, system dirs) refused; out-of-bounds
  operations rejected.
- `planner` — valid Plan JSON parsed; malformed/out-of-scope JSON rejected;
  Claude call mocked.
- `executor` + `undo` — applying a `move`/`rename`/`quarantine` then `undo`
  restores the original state exactly.

All filesystem tests run against temp fixture directories. No network in tests.

## 9. Repo & licensing

- Rename the local `2048` directory/project to `sweep`.
- `git init`, create GitHub repo under **Mossab28**, license **MIT**.
- README oriented for adoption: one-line value prop, demo GIF/asciinema,
  `npx @mossab/sweep ~/Downloads`, safety guarantees front and center.

## 9b. Visual identity (DA)

Brand palette: **black + pink**. Applied consistently across:

- **CLI output** — dark/black background assumed; pink (magenta/hot-pink ANSI,
  256-color or truecolor with graceful fallback to standard magenta) as the
  accent for prompts, the `sweep` banner/logo, progress, and confirmations.
  Neutral grey for secondary text; conventional green/red only for
  success/warning where clarity demands it.
- **ASCII banner** shown on launch, in pink.
- **README** — pink accent in logo/badges on a dark theme; demo GIF/asciinema
  using the same palette.

## 10. Future (out of scope for v1)

- GUI (Tauri/Electron) once the CLI proves the concept.
- Agent mode with tools for complex custom requests.
- Hosted/paid tier (this is where the VPS/Dokploy setup could return).
- Scheduling / watch mode for continuous tidying.
