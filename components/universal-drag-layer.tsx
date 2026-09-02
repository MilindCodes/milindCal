"use client";

/**
 * Universal drag layer.
 *
 * Provides a single DndContext at the workspace root so a task, doc, or
 * calendar event can be dragged onto any compatible drop zone. The drop
 * handlers don't live here — they live in CalendarWorkspace (where the side
 * effects are: Google fetches, editor-open, task creation). We expose them
 * through context so nested draggables/droppables can stay decoupled.
 *
 * Why dnd-kit and not FullCalendar's `Draggable`: FC's external drag hook
 * leans on data-fc-draggable DOM attributes and its own mirror/render loop,
 * which made cross-container behavior feel laggy and broke under React
 * re-renders. dnd-kit is React-native, smoother, and gives us DragOverlay
 * for a consistent ghost across all views.
 */

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { payloadKey } from "@/lib/entity-store";
import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EntityKind, UniversalDragPayload } from "@/lib/entity-store";

/* ──────────────────────────────────────────────────────────────── */
/* Drop target metadata                                             */

/** Every droppable declares what it accepts + what kind of thing it makes. */
export interface DropZoneMeta {
  /** Stable id — dnd-kit uses this as the droppable id. */
  id: string;
  /** The entity kind a dropped payload becomes when it lands here. */
  targetKind: EntityKind;
  /** Optional scoping info (column id, calendar time slot, etc.). */
  data?: Record<string, unknown>;
}

/** Shape of the dispatched drop — side-effectful handlers live in CalendarWorkspace. */
export interface UniversalDropEvent {
  source: UniversalDragPayload;
  target: DropZoneMeta;
}

/* ──────────────────────────────────────────────────────────────── */
/* Hooks                                                            */

/**
 * Make an element draggable with the universal payload schema.
 *
 * Returns props to spread on the draggable element + a boolean flag so the
 * caller can style the dragging state. The element needs the returned
 * `ref` so dnd-kit can measure it.
 */
export function useUniversalDraggable(payload: UniversalDragPayload) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: payloadKey(payload),
    data: { payload },
  });
  return { setNodeRef, attributes, listeners, isDragging };
}

/**
 * Mark an element as a drop target for a given entity kind.
 *
 * Returns a ref + `isOver` so the caller can apply visual affordance.
 */
export function useUniversalDroppable(zone: DropZoneMeta) {
  const { setNodeRef, isOver } = useDroppable({
    id: zone.id,
    data: { zone },
  });
  return { setNodeRef, isOver };
}

/* ──────────────────────────────────────────────────────────────── */
/* Provider                                                         */

interface UniversalDragLayerProps {
  children: ReactNode;
  /** Called on every successful drop. Router inside CalendarWorkspace
   *  decides what to do (create event, link entities, open editor, etc.). */
  onDrop: (event: UniversalDropEvent) => void;
}

/**
 * pointerWithin first (wins when the pointer is clearly inside a zone — e.g.
 * tasks sidebar or calendar grid), falling back to rectIntersection so tall
 * drag-ghosts still register a drop when the pointer is just outside the zone
 * but the ghost overlaps it.
 */
const combinedCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) return hits;
  return rectIntersection(args);
};

import { useDndMonitor } from "@dnd-kit/core";

function UniversalDragOverlay() {
  const [active, setActive] = useState<UniversalDragPayload | null>(null);

  useDndMonitor({
    onDragStart(e) {
      const payload = e.active.data.current?.payload as UniversalDragPayload | undefined;
      if (payload) setActive(payload);
    },
    onDragEnd() {
      setActive(null);
    },
    onDragCancel() {
      setActive(null);
    },
  });

  return (
    <DragOverlay dropAnimation={null}>
      <AnimatePresence>
        {active ? (
          <motion.div
            key={active.kind + active.id}
            className="universal-drag-ghost"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 32 }}
          >
            <span className={`universal-drag-badge universal-drag-badge--${active.kind}`}>
              {active.kind}
            </span>
            <span className="universal-drag-label">{active.label || "Untitled"}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </DragOverlay>
  );
}

export function UniversalDragLayer({ children, onDrop }: UniversalDragLayerProps) {
  // 6px activation so clicks on task cards still open editors.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Keep onDrop in a ref so handleEnd stays stable across the drop sequence —
  // if the parent passes a new onDrop every render (deps change frequently),
  // we don't want to churn the DndContext's handler mid-drag.
  const onDropRef = useRef(onDrop);
  useEffect(() => { onDropRef.current = onDrop; });

  const handleEnd = useCallback(
    (e: DragEndEvent) => {
      const source = e.active.data.current?.payload as UniversalDragPayload | undefined;
      const target = e.over?.data.current?.zone as DropZoneMeta | undefined;
      if (!source || !target) return;
      onDropRef.current({ source, target });
    },
    [],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={combinedCollision}
      onDragEnd={handleEnd}
    >
      {children}
      <UniversalDragOverlay />
    </DndContext>
  );
}
