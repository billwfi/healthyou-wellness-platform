# Umbraco Content Export

Full content tree pulled from the Umbraco CMS at **https://www.cosreachyourpeak.com/umbraco**
and stored here so it lives inside the HealYou platform under **Communication › Umbraco**.

- **Pulled:** 2026-06-15
- **Source user:** jerrichambers@myhealthyou.com (editor)
- **Start node:** `Global` (id 1328) — the editor's content root
- **Nodes:** 2,203 (2,046 published / 157 draft)

## Files

| File | Description |
|------|-------------|
| `umbraco-content.json` | Lean export — one object per node with metadata + every editor property (`{ alias: value }`). This is the import source. |
| `umbraco-tree.json` | Lightweight tree (id, name, contentType, path, parentId) for quick structure inspection. |

### Node shape (`umbraco-content.json`)

```json
{
  "umb_id": 5101,
  "umb_key": "….",
  "udi": "umb://document/…",
  "name": "Zinc Supplementation - What to Know",
  "content_type": "pageArticle",
  "parent_id": 5099,
  "tree_path": "-1,1328,…,5101",
  "level": 4,
  "sort_order": 20,
  "published": false,
  "update_date": "2024-05-22 09:58:50",
  "url": "/…",
  "properties": { "articleByline": "(Article series)", "articleGrid": { … }, … }
}
```

Rich-content fields (`Umbraco.BlockList`, `Umbraco.Grid`, `Umbraco.MediaPicker3`, …)
keep their original JSON value, so the body content is preserved losslessly.

## Document types found

`pageStandard` (1152), `pageArticle` (713), `pageArticleCategory` (59),
`calloutBlock` (49), `contentData` (28), `pageRedirect` (17),
`contentAdditionalContent` (13), `eventItem` (148), plus home/search/event/folder types.

## Importing into the database

The content is surfaced in the admin portal at `/admin/umbraco.html`, served by the
`umbraco-content` Netlify function from the `umbraco_content` table (see `schema.sql`).

```bash
# 1. create the table (if not already)
psql "$DATABASE_URL" -f schema.sql

# 2. load the export
DATABASE_URL="postgres://…neon…" npm run import:umbraco
```

The import is idempotent (upserts on `umb_id`), so re-running after a fresh pull updates in place.

## Re-pulling

Content was pulled by authenticating against Umbraco's backoffice API
(`/umbraco/backoffice/UmbracoApi/Authentication/PostLogin`), walking the content tree
(`ContentTree/GetNodes`), and fetching each node (`Content/GetById`).
