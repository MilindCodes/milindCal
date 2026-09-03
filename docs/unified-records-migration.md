# Collapsing `documents` and `tasks` into one `records` table

**Status: proposal. Nothing here has been run.** I have no access to the
database and cannot execute this backend, so treat every statement below as
reviewable intent, not tested code.

## Why this is the last architectural gap

milindCal's premise is that a calendar entry, a task, a doc and a sheet are one
record wearing different faces. In the client that is now literally true: a
record's views follow from which fields it carries (`start` → calendar,
`status` → board, `body` → editor, `sheet` → grid), those facets are additive,
and cross-view drag writes a field rather than creating a copy.

Storage has not caught up. `documents` and `tasks` are separate tables, and
that leaks into the domain in ways users can feel:

- **A sheet had to pretend to be a task.** `tasks.completed` is `NOT NULL`, so
  any record stored there acquired a task facet and appeared on the board. I
  worked around this client-side by making the field optional in TypeScript
  (`8bbca31`), but the column still forces a value on write.
- **Facet transitions cross a table boundary.** `updateTask` and `updateDoc`
  hand off to each other when an id is not theirs. That handoff exists purely
  because the id space is split; with one table it disappears.
- **A record cannot be both, at rest.** `documents` has no completion columns
  at all — see the blocker below.

## Blocker found while writing this: the facets do not persist

Everything above assumed the client-side model was merely *split* across two
tables. It is worse than that. The new facet fields have **no server-side
persistence at all**, so for a signed-in user they are silently discarded.

`../milindDrive/backend/src/routes/tasks.ts` accepts exactly:

    id title description completed importance dueDate assigneeEmail columnId
    attachedToEventKey canvasPos asanaGid asanaProjectName asanaAssigneeName
    source createdAt updatedAt

and `docs.ts` accepts no `completed` / `importance` / `dueDate` / `columnId`
either. Neither schema calls `.passthrough()`, and Zod strips unknown keys by
default — so every one of these is dropped on write:

| Field | Added to | Consequence when signed in |
|---|---|---|
| `start` / `end` / `allDay` | `Task` | Dragging a task onto the calendar does not survive reload |
| `body` | `Task` | A task given doc content loses it |
| `sheet` | `Task`, `MilindDocFile` | **Spreadsheets do not persist at all** |
| `googleEventId` / `googleCalendarId` | `Task` | Adopting a Google event does not stick; the duplicate tile returns |
| `completed` / `importance` / `dueDate` / `columnId` | `MilindDocFile` | A doc put on the board falls off it |

**Why I did not catch this earlier.** Every verification I ran used
`DEV_AUTH_BYPASS=true`, which has no Google token, so `EntityStoreProvider`
takes the localStorage path — and localStorage serialises the whole object,
facets included. The milindDrive path needs a real Google session and the
backend running, neither of which I have. So the feature genuinely works in
everything I tested and genuinely does not work for you.

This makes the backend work below **not** architectural tidiness. Until it
lands, the unified record model is a local-only feature.

### Minimum fix, if you want it before the full unification

Add the columns and widen the two Zod schemas. That alone makes the current
client correct, without collapsing the tables:

```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS all_day  BOOLEAN,
  ADD COLUMN IF NOT EXISTS body     JSONB,
  ADD COLUMN IF NOT EXISTS sheet    JSONB,
  ADD COLUMN IF NOT EXISTS google_event_id    TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
  ALTER COLUMN completed  DROP NOT NULL,
  ALTER COLUMN importance DROP NOT NULL;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS completed  BOOLEAN,
  ADD COLUMN IF NOT EXISTS importance TEXT
    CHECK (importance IS NULL OR importance IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS due_date   DATE,
  ADD COLUMN IF NOT EXISTS column_id  TEXT,
  ADD COLUMN IF NOT EXISTS sheet      JSONB;
```

Dropping `NOT NULL` on `tasks.completed` matters specifically: it is what lets
a sheet-only record exist without acquiring a task facet, which is the fix
`8bbca31` made client-side and could not make in the database.

## Target schema


One table. Every facet is a nullable column, and *presence* is what gives a
record that facet — the same rule the client already uses.

```sql
CREATE TABLE IF NOT EXISTS records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  summary       TEXT,                      -- plain-text description

  -- Calendar facet: a start makes it a calendar entry.
  start_at      TIMESTAMPTZ,
  end_at        TIMESTAMPTZ,
  all_day       BOOLEAN,
  location      TEXT,

  -- Task facet: a completion state makes it actionable. NULLABLE on purpose —
  -- this nullability is the whole point. A sheet with no status must not be
  -- forced onto the board.
  completed     BOOLEAN,
  importance    TEXT CHECK (importance IS NULL OR importance IN ('low','medium','high')),
  due_date      DATE,
  column_id     TEXT,
  assignee_email TEXT,

  -- Doc facet: Tiptap JSON, with GCS overflow for large bodies.
  body          JSONB,
  body_gcs_key  TEXT,

  -- Sheet facet: sparse A1-keyed cells, e.g. {"A1":"12","B2":"=SUM(A1:A5)"}.
  -- Sparse because most grids are mostly empty and records sync on every edit.
  sheet         JSONB,

  -- Google projection. When set, this record IS that event — milindCal's
  -- identity for it, not a copy beside it.
  google_event_id    TEXT,
  google_calendar_id TEXT,

  -- Presentation state, per view.
  canvas_pos    JSONB,
  graph_pos     JSONB,
  node_color    TEXT,

  -- Provenance.
  source            TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','asana')),
  asana_gid         TEXT,
  asana_project_name TEXT,
  asana_assignee_name TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Facet lookups are the hot path: every view filters by presence.
CREATE INDEX IF NOT EXISTS idx_records_user        ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_scheduled   ON records(user_id, start_at) WHERE start_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_records_actionable  ON records(user_id, completed) WHERE completed IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_records_docs        ON records(user_id, updated_at DESC) WHERE body IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_records_google      ON records(user_id, google_calendar_id, google_event_id)
  WHERE google_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_records_title_fts   ON records USING GIN(to_tsvector('english', title));
```

`entity_links` needs no change — it already keys on opaque `from_key` / `to_key`
strings. Once ids share one space those become plain record ids rather than
`"doc:abc"` / `"task:xyz"`, which is a simplification, not a migration.

## Migration

Additive and reversible. The old tables are left in place and untouched, so a
rollback is "point the routes back".

```sql
BEGIN;

INSERT INTO records (
  id, user_id, title, summary, completed, importance, due_date, column_id,
  assignee_email, canvas_pos, source, asana_gid, asana_project_name,
  asana_assignee_name, created_at, updated_at
)
SELECT
  id, user_id, title, description, completed, importance, due_date, column_id,
  assignee_email, canvas_pos, source, asana_gid, asana_project_name,
  asana_assignee_name, created_at, updated_at
FROM tasks
ON CONFLICT (id) DO NOTHING;

INSERT INTO records (
  id, user_id, title, body, body_gcs_key, graph_pos, node_color,
  completed, importance, due_date, column_id,
  start_at, end_at, all_day, google_event_id, google_calendar_id,
  created_at, updated_at
)
SELECT
  d.id, d.user_id, d.title, d.content, d.content_gcs_key, d.graph_pos, d.node_color,
  -- Only valid after the ALTER TABLE above; documents has no completion
  -- columns today.
  d.completed, d.importance, d.due_date, d.column_id,
  -- calendar_meta already carried the schedule and the Google projection;
  -- in the unified model those are simply the record's own columns.
  (d.calendar_meta->>'start')::timestamptz,
  (d.calendar_meta->>'end')::timestamptz,
  (d.calendar_meta->>'allDay')::boolean,
  d.calendar_meta->>'eventId',
  d.calendar_meta->>'calendarId',
  d.created_at, d.updated_at
FROM documents d
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

### Things to check before running

- **Id collision between the two tables.** Both are `gen_random_uuid()` so a
  clash is vanishingly unlikely, but `ON CONFLICT DO NOTHING` would silently
  drop the second row rather than error. Verify first:
  ```sql
  SELECT COUNT(*) FROM tasks t JOIN documents d ON t.id = d.id;  -- expect 0
  ```
- **`calendar_meta` shape.** The casts above assume `start`/`end` are ISO
  strings and `allDay` a JSON boolean. Confirm against real rows; a malformed
  value fails the whole transaction, which is the safe outcome.
- **Row counts match** after the copy:
  ```sql
  SELECT (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM documents)
       = (SELECT COUNT(*) FROM records) AS ok;
  ```

## Cutover

1. Create the table and indexes. No behaviour changes; nothing reads it yet.
2. Run the copy. Verify the counts above.
3. Add `routes/records.ts` alongside the existing routes, mirroring the
   `tasks.ts` pattern (Zod schema, `toClient*` mapper, broadcast on write).
4. **Dual-write** from the client for one release: keep calling the existing
   endpoints, and mirror to `/api/records`. This is the step that makes the
   cutover safe — if `records` diverges, nothing is lost yet.
5. Switch reads to `/api/records`. `useRecords()` already exists client-side
   and every view already filters by facet, so this is a change to
   `lib/milindDriveClient.ts` and the hydration path in
   `entity-store-context.tsx` — not to the views.
6. Delete the cross-store handoff in `updateTask` / `updateDoc`, the
   `tasksProjected` / `docsProjected` merges, and the `recordFromTask` /
   `recordFromDoc` adapters in `lib/record.ts`. All of that machinery exists
   only to paper over the split, and this is where the real simplification
   lands.
7. Drop `documents` and `tasks` once a backup is confirmed.

Steps 1–4 are reversible at any point. Step 5 is the first irreversible one and
should follow a backup.

## What I would want to see before trusting this

I cannot run any of it. Specifically untested: whether `calendar_meta` casts
cleanly on real data, whether any id collides, and whether the new routes
behave. Run it against a copy of production first and diff the results
against the old endpoints.
