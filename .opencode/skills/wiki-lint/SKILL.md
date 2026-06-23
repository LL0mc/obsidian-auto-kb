---
name: wiki-lint
description: >
  Audit and maintain the health of the Obsidian wiki. Use this skill when the user wants to check their
  wiki for issues, find orphaned pages, detect contradictions, identify stale content, fix broken wikilinks,
  or perform general maintenance on their knowledge base. Also triggers on "clean up the wiki",
  "what needs fixing", "audit my notes", or "wiki health check".
---

# Wiki Lint — Health Audit

You are performing a health check on an Obsidian wiki. Your goal is to find and fix structural issues that degrade the wiki's value over time.

## Before You Start

1. KB 目录：`$OBSIDIAN_VAULT_PATH/kb`（通过 `.env` 配置）
2. Read `kb/wiki/index.md` for the full page inventory
3. Read `kb/wiki/log.md` for recent activity context

## Tier 1: Deterministic Checks (auto-fix)

These have clear right/wrong answers. Fix them automatically, then report what you did.

### 1a. Index Consistency

Compare `kb/wiki/index.md` against actual files under `kb/wiki/`:

- File exists but missing from index → add entry with placeholder summary
- Index entry points to nonexistent file → mark as `[MISSING]` (don't delete, let user decide)

### 1b. Broken Wikilinks

For every `[[wikilink]]` in wiki/ article files:

- Target does not exist → search for a file with the same name
  - Exactly one match → fix the path
  - Zero or multiple matches → report to user

### 1c. Missing Frontmatter

Every page should have: title, type, tags, created, updated.

- Grep frontmatter blocks (scope to `^---` at file heads)
- Flag pages missing required fields
- Auto-add missing fields with reasonable defaults

### 1d. Missing Summary (soft)

Every page *should* have a `summary:` field (≤200 chars). Flag but don't auto-fix — this is a nudge for future ingests.

## Tier 2: Heuristic Checks (report only)

These require judgment. Report findings without auto-fixing. Let the user decide.

### 2a. Orphaned Pages

Find pages with zero incoming wikilinks (knowledge islands).

- Glob all `.md` files in `kb/wiki/concepts/` and `kb/wiki/sources/`
- For each, grep the rest of the vault for `[[page-name]]` references
- Pages with zero incoming links are orphans

### 2b. Contradictions

Claims that conflict across pages.

- Focus on pages that share tags or are heavily cross-referenced
- Look for phrases like "however", "in contrast", "despite"
- Note both the contradiction and the sources involved

### 2c. Stale Content

Pages whose `updated` timestamp is old relative to their sources.

- Compare page `updated` to raw file modification times
- Flag pages where sources are newer

### 2d. Missing Concepts

Terms that appear frequently in raw sources but lack their own concept page.

- Check raw files for repeated terms not covered by any `concepts/*.md`

## Output Format

```markdown
## Wiki Health Report

### Auto-fixed (N issues)
- `index.md`: added missing entry for `concepts/foo.md`
- `concepts/bar.md:15`: fixed broken link [[old-name]] → [[new-name]]

### Needs decision (N issues)
- **Orphan**: `concepts/baz.md` — no incoming links. Suggested: add link from `concepts/qux.md`
- **Contradiction**: `concepts/A.md` claims "X" but `concepts/B.md` claims "not X"
- **Stale**: `sources/summary-xxx.md` — raw file updated 2026-06-20, page last updated 2026-06-01
```

## After Linting

Append to `kb/wiki/log.md`:
```
- [TIMESTAMP] LINT issues_found=N auto_fixed=M needs_decision=K
```

Git commit if any auto-fixes were applied.
