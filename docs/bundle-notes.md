# Where the bundle actually goes

Measured, not estimated. Re-run with `npx next build` and the script at the
bottom if these drift.

## Today

| | |
|---|---|
| Route `/` first load | **280 kB** |
| — shared by all routes | 102 kB |
| — route-specific | 129 kB |
| Total client JS emitted | 603 kB gzipped (1.95 MB raw) |

Down from 336 kB route / 447 kB first load at the start of the optimisation
work. The reductions came from lazy-loading the canvas, docs, graph, sheet,
event editor and calendar dialog; self-hosting fonts via `next/font`; and
`optimizePackageImports` for lucide and date-fns.

## FullCalendar is the largest single remaining item

It occupies one chunk on its own:

```
3150-*.js    210 kB raw    63 kB gzipped    434 "fc-" class tokens
```

That chunk is essentially pure FullCalendar — the only other marker in it is
two incidental lucide references. So **FullCalendar is ~63 kB of the 280 kB
first load, about 22%**.

### It cannot be trimmed by configuration

Already tried and reverted (see the comment in `calendar-workspace.tsx`):
loading the Month and Year plugins on demand. It does not work — the React
wrapper registers plugins at construction, so a plugin added to the prop later
is never picked up and `changeView()` silently no-ops onto a view FullCalendar
does not know about, leaving every view rendering as Week. The saving measured
at ~1 kB anyway, because the plugins share most of their weight with core,
which loads regardless.

So the only lever on this 63 kB is replacing the library.

### What replacing it would cost

Not a small job, and worth being honest about the surface area. FullCalendar
currently provides: four view layouts (day/week/month/year), event collision
and stacking within a day column, drag-to-move and drag-to-resize, click-drag
selection to create, the `+N more` overflow affordance, all-day rows, "now"
indicator, and date arithmetic across DST.

A replacement would need the timegrid and daygrid layouts plus collision
maths, which is the genuinely hard part. The tiles themselves are already
ours — `renderEventContent` returns a `.milind-tile` — so the visual layer
survives a swap; it is the layout engine underneath that would be rewritten.

My honest read: 63 kB is a real cost but not an emergency, and a hand-rolled
calendar layout is a large, bug-prone surface. Worth doing only if the bundle
target is aggressive enough that 22% matters more than the risk.

## Re-measuring

```bash
npx next build
```

then, for the per-chunk breakdown:

```bash
python3 - <<'PY'
import glob, gzip, re, os
for f in sorted(glob.glob(".next/static/chunks/**/*.js", recursive=True),
                key=os.path.getsize, reverse=True)[:8]:
    d = open(f, "rb").read()
    txt = d.decode("utf-8", "ignore")
    marks = [l for l in ("fullcalendar","tiptap","prosemirror","dnd-kit",
                         "framer-motion","lucide") if re.search(l, txt, re.I)]
    print(f"{len(d)/1024:7.0f} kB raw  {len(gzip.compress(d))/1024:6.0f} kB gz  "
          f"{os.path.basename(f):40s} {','.join(marks)}")
PY
```
