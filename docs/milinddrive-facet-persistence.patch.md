# Backend change so record facets actually persist

**I could not apply this.** Writing into `../milindDrive` is outside this
repository and was blocked, correctly — you should be the one to apply a change
to another service. Everything below is written against the real files as they
are today, but **none of it has been run**: I have no database and cannot start
that backend.

Apply order: SQL first, then `tasks.ts`, then `docs.ts`.

---

## 1. `milindDrive/schema.sql` — add the facet columns

Additive and nullable, so existing rows and existing writes are unaffected.

```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS start_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS all_day            BOOLEAN,
  ADD COLUMN IF NOT EXISTS body               JSONB,
  ADD COLUMN IF NOT EXISTS sheet              JSONB,
  ADD COLUMN IF NOT EXISTS google_event_id    TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;

-- These two are what let a record exist WITHOUT a task facet. While they are
-- NOT NULL, anything stored in this table is forced to look like a task —
-- which is why a new sheet used to appear on the board.
ALTER TABLE tasks
  ALTER COLUMN completed  DROP NOT NULL,
  ALTER COLUMN importance DROP NOT NULL;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS completed  BOOLEAN,
  ADD COLUMN IF NOT EXISTS importance TEXT
    CHECK (importance IS NULL OR importance IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS due_date   DATE,
  ADD COLUMN IF NOT EXISTS column_id  TEXT,
  ADD COLUMN IF NOT EXISTS sheet      JSONB;

CREATE INDEX IF NOT EXISTS idx_tasks_scheduled
  ON tasks(user_id, start_at) WHERE start_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_google
  ON tasks(user_id, google_calendar_id, google_event_id) WHERE google_event_id IS NOT NULL;
```

Check first — dropping NOT NULL is only safe if nothing relies on it:

```sql
SELECT COUNT(*) FROM tasks WHERE completed IS NULL;   -- expect 0 today
```

## 2. `src/routes/tasks.ts`

### 2a. `createTaskSchema` — accept the facets

Zod strips unknown keys and this schema has no `.passthrough()`, which is
exactly why these were being discarded. Insert before `createdAt`:

```ts
  /* Record facets. milindCal treats a task, a calendar entry, a doc and a
   * sheet as one record wearing different faces; which faces it has follows
   * from which of these are present. All optional — nothing existing changes
   * shape. */
  start: z.string().nullable().optional(),             // ISO timestamp
  end: z.string().nullable().optional(),
  allDay: z.boolean().nullable().optional(),
  body: z.record(z.unknown()).nullable().optional(),   // Tiptap JSON
  sheet: z.record(z.unknown()).nullable().optional(),  // sparse A1 cells
  googleEventId: z.string().nullable().optional(),
  googleCalendarId: z.string().nullable().optional(),
```

### 2b. `toClientTask` — return them

`undefined` rather than `null` when absent, so `field !== undefined` stays the
client's test for "does this record have this face?". Insert before `createdAt`:

```ts
    start: record.start_at ? new Date(record.start_at).toISOString() : undefined,
    end: record.end_at ? new Date(record.end_at).toISOString() : undefined,
    allDay: record.all_day ?? undefined,
    body: record.body ?? undefined,
    sheet: record.sheet ?? undefined,
    googleEventId: record.google_event_id ?? undefined,
    googleCalendarId: record.google_calendar_id ?? undefined,
```

`TaskRecord` in `src/types` needs the matching snake_case fields.

### 2c. `POST /` — carry them into the INSERT

Append to `fields`:

```ts
    'start_at', 'end_at', 'all_day', 'body', 'sheet',
    'google_event_id', 'google_calendar_id',
```

and to `values`, in the same order:

```ts
    data.start ?? null,
    data.end ?? null,
    data.allDay ?? null,
    data.body ? JSON.stringify(data.body) : null,
    data.sheet ? JSON.stringify(data.sheet) : null,
    data.googleEventId ?? null,
    data.googleCalendarId ?? null,
```

### 2d. `PATCH /:id` — allow updating them

Add to the destructure, then after the `source` line:

```ts
  // `undefined` means "not mentioned"; an explicit null clears the facet,
  // which is how unscheduling or removing a body is expressed.
  if (start !== undefined) { updates.push(`start_at = $${idx++}`); params.push(start); }
  if (end !== undefined) { updates.push(`end_at = $${idx++}`); params.push(end); }
  if (allDay !== undefined) { updates.push(`all_day = $${idx++}`); params.push(allDay); }
  if (body !== undefined) { updates.push(`body = $${idx++}`); params.push(body ? JSON.stringify(body) : null); }
  if (sheet !== undefined) { updates.push(`sheet = $${idx++}`); params.push(sheet ? JSON.stringify(sheet) : null); }
  if (googleEventId !== undefined) { updates.push(`google_event_id = $${idx++}`); params.push(googleEventId); }
  if (googleCalendarId !== undefined) { updates.push(`google_calendar_id = $${idx++}`); params.push(googleCalendarId); }
```

## 3. `src/routes/docs.ts` — the same shape

Add to `createDocSchema`:

```ts
  completed: z.boolean().nullable().optional(),
  importance: z.enum(['low', 'medium', 'high']).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  columnId: z.string().nullable().optional(),
  sheet: z.record(z.unknown()).nullable().optional(),
```

then mirror 2b–2d for `completed`, `importance`, `due_date`, `column_id`,
`sheet` in `toClientDoc`, the INSERT and the PATCH.

---

## How to tell it worked

With the app signed in to Google (not `DEV_AUTH_BYPASS`, which uses
localStorage and hides this entirely):

1. Drag a task onto the calendar, reload — it should still be on the grid.
2. Open Sheet, type a value, reload — it should still be there.
3. Drag a doc onto the task board, reload — it should still be on the board.
4. Drag a Google event onto the board, reload — there should be **one** tile,
   not two.

Each of those fails today, and each is a single facet round-tripping.

## Caveats

Untested end to end. `TaskRecord` / `DocumentRecord` in `src/types` need the
new snake_case fields or TypeScript will reject `toClient*`. And confirm
`SELECT COUNT(*) FROM tasks WHERE completed IS NULL` is 0 before dropping that
NOT NULL — if anything already relies on the constraint, drop it in a separate
step you can roll back.
