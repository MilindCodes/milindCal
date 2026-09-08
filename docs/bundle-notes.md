# Where the bundle actually goes

Measured, not estimated. Every number here comes from `npm run build` plus the
script at the bottom; re-run both if they look stale.

## Today

| | |
|---|---|
| Route `/` first load | **207 kB** |
| — route-specific | 51.8 kB |
| — shared by all routes | 102 kB |
| Total client JS emitted | 529 kB gzipped (1.65 MB raw), 51 chunks |

Down from 336 kB route / 447 kB first load when the optimisation work started.
The reductions came from lazy-loading the canvas, docs, graph, sheet, event
editor and calendar dialog; self-hosting fonts via `next/font`;
`optimizePackageImports` for lucide; replacing FullCalendar with the hand-built
grid in `lib/calendar-grid.ts` + `components/calendar-grid/`; and dropping
date-fns and uuid for native equivalents.

## What is actually on the critical path

Not the biggest chunks — the biggest chunks are TipTap and ProseMirror, and
they are lazy. These nine are what route `/` loads before it can paint:

| gzipped | chunk | what it is |
|---:|---|---|
| 53 kB | `4bd1b696-*` | react-dom |
| 45 kB | `1255-*` | react-dom + scheduler |
| **38 kB** | **`6120-*`** | **framer-motion** |
| 29 kB | `page-*` | milindCal's own code |
| 22 kB | `9374-*` | dnd-kit + lucide |
| 9 kB | `6489-*` | next-auth |
| 5 kB | `2251-*` | — |
| 2 kB | `webpack-*` | webpack runtime |
| **203 kB** | | (Next reports 207 kB; it counts framework and polyfills slightly differently) |

Two things fall out of that table.

**React and react-dom are 98 kB — 48% of first load.** That is the floor for
this stack. Nothing short of changing framework moves it.

**framer-motion is 38 kB, 19%, and the largest thing that is actually ours.**
It is the only remaining item where a decision would change the number
meaningfully.

## The framer-motion decision is open, and it is a product call

`LazyMotion` + `domAnimation` is the usual answer and it does not apply here.
That path drops the layout-projection and drag engines, and the codebase leans
on both:

- **7 `layoutId` props forming 3 shared-element transitions.**
  `dive-view-pill`, `dive-today-pill` and `dive-app-brand` each have their two
  endpoints in *different components*, so the element morphs across a view
  change rather than cross-fading. Layout projection is the entire mechanism.
- **7 bare `layout` props** across calendar-workspace, docs-sidebar,
  tasks-sidebar and milind-doc, for lists that reflow when an item is added,
  removed or reordered.
- **3 `drag` nodes** in the canvas, with 11 supporting drag props
  (`dragControls`, `dragMomentum`, `onDragEnd`…).

None of these degrade gracefully. Remove the engine and the props stop working
— the pill jumps instead of morphing, the lists snap instead of reflowing.

Twelve components import framer-motion. Most use only `motion.div` with
`initial`/`animate`/`exit`, which CSS transitions and `@keyframes` replace
exactly; `AnimatePresence` exit animations and the canvas drag do not have a
cheap CSS equivalent.

So the honest framing is: **38 kB buys the animation layer.** Cutting it means
cutting animation, not finding a cleverer import. That is a taste decision
about how milindCal should feel, and it belongs to the owner, not to a build
script.

## Ruled out already

- **`optimizePackageImports` for date-fns** — moot, date-fns is gone.
- **Splitting FullCalendar's plugins** — moot, FullCalendar is gone. (It was
  63 kB and could not be trimmed by configuration; the React wrapper registers
  plugins at construction, so a plugin passed later was never picked up.)
- **Lazy-loading lucide icons** — already correct. Icons used only by the docs
  editor are absent from the first-load chunk; `optimizePackageImports`
  rewrites the barrel import into per-module ones.

## Re-measuring

```bash
npm run build
```

Then, for what is on the critical path specifically — this reads the build
manifest rather than guessing from chunk size, which is the mistake the
previous version of this file made:

```bash
python3 - <<'PY'
import json, gzip, os
m = json.load(open(".next/app-build-manifest.json"))
raw = gz = 0
for f in m["pages"].get("/page", []):
    p = os.path.join(".next", f)
    if not f.endswith(".js") or not os.path.exists(p):
        continue
    d = open(p, "rb").read()
    c = len(gzip.compress(d))
    raw += len(d); gz += c
    print(f"{len(d)/1024:7.0f} kB raw {c/1024:6.0f} kB gz  {os.path.basename(f)}")
print(f"TOTAL {raw/1024:.0f} kB raw, {gz/1024:.0f} kB gz")
PY
```

To identify an unlabelled chunk, grep it for a library's distinctive runtime
strings — `projectionNodeConstructor` for framer-motion, `droppableRects` for
dnd-kit, `unstable_scheduleCallback` for the React scheduler.
