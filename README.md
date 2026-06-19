# 🩷 sweep

**AI-powered file cleanup & organizer — free, open-source, runs in your terminal.**

> Point it at a messy folder. Claude makes a plan. You approve it. Done.

---

## Safety first

sweep is designed to be safe by default:

- **Dry-run before anything moves** — you see the full plan and confirm `y/N` before a single file is touched.
- **No real deletion** — files marked for removal are quarantined to `~/.sweep/trash/<timestamp>/`, never permanently deleted.
- **Full undo** — `sweep undo` reverts the last run instantly.
- **Refuses dangerous targets** — sweep will not operate on `/` or your bare home directory (`~`), and automatically skips system/noise directories (`node_modules`, `.git`, etc.).

---

## Quick start

You need your own [Claude API key](https://console.anthropic.com/).

```bash
ANTHROPIC_API_KEY=sk-ant-... npx @mossab/sweep ~/Downloads
```

That's it. sweep scans the folder, asks Claude for a tidy plan, shows it to you, and waits for your `y` before doing anything.

### No API key? Use your Claude Code subscription

If you have [Claude Code](https://claude.com/claude-code) installed and logged in, pass `--claude-code` (`-c`) and sweep will ask Claude through your existing subscription — no API key, no per-token cost:

```bash
npx @mossab/sweep ~/Downloads --claude-code
```

---

## Usage

### Modes

```bash
# Organize (default) — group and sort files into logical folders
sweep ~/Downloads

# Clean — remove junk, duplicates, and clutter
sweep ~/Downloads --mode clean
```

### Custom instruction

Use `-i` to tell sweep exactly what you want:

```bash
sweep ~/Photos -i "sort photos by year"
sweep ~/Documents -i "archive anything older than 2023"
sweep ~/Desktop -i "keep only PDFs, move everything else to a subfolder"
```

### Undo

Revert the most recent run at any time:

```bash
sweep undo
```

---

## How it works

1. **Local scan** — sweep reads file names, sizes, dates, types, and duplicate hashes from your folder. Nothing is sent to Claude except a compact summary.
2. **AI plan** — Claude returns a structured JSON plan describing every move.
3. **You confirm** — the plan is displayed; nothing happens until you type `y`.
4. **Execute** — files are moved or quarantined according to the plan.
5. **Undo** — run `sweep undo` to restore everything to where it was.

---

## Requirements

- Node.js >= 20
- **Either** a Claude API key (set via `ANTHROPIC_API_KEY`) — get one at [console.anthropic.com](https://console.anthropic.com/) — **or** [Claude Code](https://claude.com/claude-code) installed and logged in, then run with `--claude-code`.

---

## License

MIT © 2026 Mossab
