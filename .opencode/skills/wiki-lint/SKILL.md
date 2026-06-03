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

**Before scanning anything:** follow the Retrieval Primitives table in `llm-wiki/SKILL.md`. Prefer frontmatter-scoped greps and section-anchored reads over full-page reads. On a large vault, blindly reading every page to lint it is exactly what this framework is built to avoid.

## Before You Start

1. Read `.env` to get `OBSIDIAN_VAULT_PATH`
2. Read `$OBSIDIAN_VAULT_PATH/kb/wiki/index.md` for the full page inventory
3. Read `$OBSIDIAN_VAULT_PATH/kb/wiki/log.md` for recent activity context
4. **Set `WIKI_DIR=kb/wiki`** — all wiki files live under this subdirectory, not at vault root.

## Lint Checks

Run these checks in order. Report findings as you go.

### 1. Orphaned Pages

Find pages with zero incoming wikilinks. These are knowledge islands that nothing connects to.

**How to check:**
- Glob all `.md` files in the vault
- For each page, Grep the rest of the vault for `[[page-name]]` references
- Pages with zero incoming links (except `kb/wiki/index.md` and `kb/wiki/log.md`) are orphans

**How to fix:**
- Identify which existing pages should link to the orphan
- Add wikilinks in appropriate sections

### 2. Broken Wikilinks

Find `[[wikilinks]]` that point to pages that don't exist.

**How to check:**
- Grep for `\[\[.*?\]\]` across all pages
- Extract the link targets
- Check if a corresponding `.md` file exists

**How to fix:**
- If the target was renamed, update the link
- If the target should exist, create it
- If the link is wrong, remove or correct it

### 3. Missing Frontmatter

Every page should have: title, category, tags, sources, created, updated.

**How to check:**
- Grep frontmatter blocks (scope to `^---` at file heads) instead of reading every page in full
- Flag pages missing required fields

**How to fix:**
- Add missing fields with reasonable defaults

### 3a. Missing Summary (soft warning)

Every page *should* have a `summary:` frontmatter field — 1–2 sentences, ≤200 chars. This is what cheap retrieval (e.g. `wiki-query`'s index-only mode) reads to avoid opening page bodies.

**How to check:**
- Grep frontmatter for `^summary:` across the vault
- Flag pages without it, **but as a soft warning, not an error** — older pages predating this field are fine; the check exists to nudge ingest skills into filling it on new writes.
- Also flag pages whose summary exceeds 200 chars.

**How to fix:**
- Re-ingest the page, or manually write a short summary (1–2 sentences of the page's content).

### 4. Stale Content

Pages whose `updated` timestamp is old relative to their sources.

**How to check:**
- Compare page `updated` timestamps to source file modification times
- Flag pages where sources have been modified after the page was last updated

### 5. Contradictions

Claims that conflict across pages.

**How to check:**
- This requires reading related pages and comparing claims
- Focus on pages that share tags or are heavily cross-referenced
- Look for phrases like "however", "in contrast", "despite" that may signal existing acknowledged contradictions vs. unacknowledged ones

**How to fix:**
- Add an "Open Questions" section noting the contradiction
- Reference both sources and their claims

### 6. Index Consistency

Verify `$OBSIDIAN_VAULT_PATH/kb/wiki/index.md` matches the actual page inventory.

**How to check:**
- Compare pages listed in `$OBSIDIAN_VAULT_PATH/kb/wiki/index.md` to actual files on disk under `$OBSIDIAN_VAULT_PATH/kb/wiki/`
- Check that summaries in `$OBSIDIAN_VAULT_PATH/kb/wiki/index.md` still match page content

### 7. Provenance Drift

Check whether pages are being honest about how much of their content is inferred vs extracted. See the Provenance Markers section in `llm-wiki` for the convention.

**How to check:**
- For each page, count sentences/bullets in the body and how many end with `^[inferred]` or `^[ambiguous]`
- Compute the rough fractions (`extracted`, `inferred`, `ambiguous`)
- **Speculation-heavy:** flag pages where `inferred + ambiguous > 0.6` of total content. The wiki is supposed to compile knowledge, not speculate.
- **Drift:** if the page has a `provenance:` frontmatter block, flag it when any field is more than 0.20 off from the recomputed value.
- **Skip** pages that have no `provenance:` frontmatter and no markers — they're treated as fully extracted by convention (the check is opt-in for older pages).

**How to fix:**
- For drift: update the `provenance:` frontmatter to match reality.
- For speculation-heavy: re-ingest the page from its sources, or split the inferred content into a `synthesis/` page (where speculation is expected) and leave the original page tighter.

## Output Format

Report findings as a structured list:

```markdown
## Wiki Health Report

### Orphaned Pages (N found)
- `concepts/foo.md` — no incoming links

### Broken Wikilinks (N found)
- `entities/bar.md:15` — links to [[nonexistent-page]]

### Missing Frontmatter (N found)
- `skills/baz.md` — missing: tags, sources

### Stale Content (N found)
- `references/paper-x.md` — source modified 2024-03-10, page last updated 2024-01-05

### Contradictions (N found)
- `concepts/scaling.md` claims "X" but `synthesis/efficiency.md` claims "not X"

### Index Issues (N found)
- `concepts/new-page.md` exists on disk but not in kb/wiki/index.md

### Missing Summary (N found — soft)
- `concepts/foo.md` — no `summary:` field
- `entities/bar.md` — summary exceeds 200 chars

### Provenance Issues (N found)
- `concepts/scaling.md` — speculation-heavy: 72% of bullets marked `^[inferred]`
- `entities/some-tool.md` — drift: frontmatter says inferred=0.10, recomputed=0.45
```

## After Linting

Append to `$OBSIDIAN_VAULT_PATH/kb/wiki/log.md`:
```
- [TIMESTAMP] LINT issues_found=N orphans=X broken_links=Y stale=Z contradictions=W prov_issues=P missing_summary=S
```

Offer to fix issues automatically or let the user decide which to address.
