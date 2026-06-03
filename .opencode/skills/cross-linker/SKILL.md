---
name: cross-linker
description: >
  Scan the Obsidian wiki and automatically discover missing cross-references between pages.
  Use this skill when the user says "link my pages", "find missing links", "cross-reference",
  "connect my wiki", "add wikilinks", "what pages should be linked", or after any large ingestion
  to ensure new pages are woven into the existing knowledge graph. Also trigger when the user
  mentions "orphan pages" in the context of wanting to connect them, or says things like
  "my wiki feels disconnected" or "pages aren't linked well". This is a write-heavy skill —
  it actually modifies pages to add links, unlike wiki-lint which just reports issues.
---

# Cross-Linker — Automated Wiki Cross-Referencing

You are weaving the wiki's knowledge graph tighter by finding and inserting missing `[[wikilinks]]` between pages that should reference each other but currently don't.

**Follow the Retrieval Primitives table in `llm-wiki/SKILL.md`.** Build the registry in Step 1 by grepping frontmatter only (not full pages). Reserve full `Read` for the unlinked-mention detection pass, and even there, only read pages whose summaries/titles make them plausible link targets. Blind full-vault reads are what this framework exists to avoid.

## Before You Start

1. Read `.env` to get `OBSIDIAN_VAULT_PATH`
2. Read `$OBSIDIAN_VAULT_PATH/kb/wiki/index.md` to get the full inventory of pages and their one-line descriptions
3. Skim `$OBSIDIAN_VAULT_PATH/kb/wiki/log.md` to see what was recently ingested (focus linking effort on new pages)
4. **Set `WIKI_DIR=kb/wiki`** — all wiki files live under this subdirectory, not at vault root. The wiki page directory is `$OBSIDIAN_VAULT_PATH/kb/wiki/`.

## Step 1: Build the Page Registry

Glob all `.md` files under `$OBSIDIAN_VAULT_PATH/kb/wiki/` (excluding `_archives/`, `.obsidian/`). For each page, extract:

- **Filename** (without `.md`) — this is the wikilink target
- **Title** from frontmatter
- **Aliases** from frontmatter (if any)
- **Tags** from frontmatter
- **Category** from frontmatter or directory inference
- **One-line summary** — first sentence or `title` field

Build a lookup table:

```
page_name → { path, title, aliases, tags, summary }
```

This is your "vocabulary" — every entry in this table is a valid wikilink target.

## Step 2: Scan for Missing Links

For each page in the vault:

1. **Read the full content**
2. **Extract existing wikilinks** — find all `[[...]]` references already present
3. **Search for unlinked mentions** — check if the page's text contains any of these, without being wrapped in `[[...]]`:
   - Page filenames (e.g., the word "MyProject" appears but `[[projects/my-project/my-project]]` is missing)
   - Page titles from frontmatter
   - Aliases from frontmatter
   - Entity names, project names, concept names from the registry

4. **Check for semantic connections** — pages that share multiple tags or are in the same project directory but don't link to each other

### Matching Rules

- **Case-insensitive matching** for names (e.g., "my-project" matches page `MyProject`)
- **Skip self-references** — a page shouldn't link to itself
- **Skip common words** — don't link "the", "and", generic terms. Only match on distinctive names
- **Prefer the shortest unambiguous wikilink path** — use `[[page-name]]` not `[[full/path/to/page-name]]` when the name is unique across the vault
- **Don't link inside code blocks** or frontmatter
- **Don't double-link** — if `[[foo]]` already appears on the page, don't add another

## Step 3: Score and Rank Suggestions

Not every possible link is worth adding. Score each candidate:

| Signal | Weight | Example |
|---|---|---|
| **Exact name match in text** | High | "MyProject" appears in body text → link to my-project.md |
| **Shared tags (2+)** | Medium | Both tagged `#ai #agent` but no link between them |
| **Same project, no link** | Medium | Both under `projects/my-project/` but don't reference each other |
| **Mentioned entity/concept** | Medium | Page mentions "knowledge graphs" → link to `[[concepts/knowledge-graphs]]` |
| **Partial name match** | Low | "graph" appears but page is `knowledge-graphs` — too ambiguous, skip |

Only act on **High** and **Medium** confidence links.

## Step 4: Apply Links

For each page with missing links:

### 4a: Inline linking (preferred)

Find the first natural mention of the term in the body text and wrap it in wikilinks:

**Before:**
```markdown
This project uses knowledge graphs to connect entities.
```

**After:**
```markdown
This project uses [[concepts/knowledge-graphs|knowledge graphs]] to connect entities.
```

Use the `[[path|display text]]` format when the wikilink path differs from the display text.

### 4b: Related section (fallback)

If the term isn't mentioned naturally in the body but the pages are semantically related (shared tags, same project), add a `## Related` section at the bottom of the page:

```markdown
## Related

- [[projects/my-project/my-project]] — Also uses AI agents for research automation
- [[concepts/knowledge-graphs]] — Core technique used in this project
```

If a `## Related` section already exists, append to it. Don't duplicate existing entries.

## Step 5: Report

Present a summary:

```markdown
## Cross-Link Report

### Links Added: 23 across 12 pages

| Page | Links Added | Type |
|---|---|---|
| `projects/my-project/my-project.md` | 3 | 2 inline, 1 related |
| `entities/jane-doe.md` | 5 | 3 inline, 2 related |
| ... | | |

### Orphan Pages Remaining: 2
- `references/foo.md` — no incoming or outgoing links found
- `concepts/bar.md` — could not find related pages

### Pages Skipped: 3
- `kb/wiki/index.md`, `kb/wiki/log.md` — special files
- `kb/wiki/_archives/*` — archived content
```

## Step 6: Update Log

Append to `$OBSIDIAN_VAULT_PATH/kb/wiki/log.md`:
```
- [TIMESTAMP] CROSS_LINK pages_scanned=N links_added=M pages_modified=P orphans_remaining=Q
```

## Tips

- **Run after every ingest.** New pages are almost always poorly connected. This is the fix.
- **Be conservative with inline links.** Only link the first natural mention, not every occurrence.
- **Don't touch pages in `_archives/`.** Those are frozen snapshots.
- **Respect existing structure.** If a page carefully curates its links in a `## Key Concepts` section, add to that section rather than creating a separate `## Related`.
- **Entity pages are link magnets.** An entity like `jane-doe` should be linked from almost every project page. Prioritize these.
