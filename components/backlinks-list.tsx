"use client";

/**
 * Shared backlinks strip.
 *
 * Every entity (task, doc, event) can show the other entities linked to it.
 * Renders as a row of clickable chips with a kind-colored dot + label; click
 * opens the linked entity in the doc editor (the universal viewer). The X
 * removes the edge in both directions.
 */

import { useMemo } from "react";
import { Calendar, CheckSquare, FileText, Table, X } from "lucide-react";
import { useEntityActions, useLinks } from "@/components/entity-store-context";
import { neighbors, parseEntityKey, type EntityKey, type EntityKind } from "@/lib/entity-store";

interface BacklinksListProps {
  /** The entity whose links we're rendering. */
  entityKey: EntityKey;
  /** Optional label shown above the chips. Omit for a bare strip. */
  label?: string;
  /** When true, renders nothing if there are no links. Default true. */
  hideWhenEmpty?: boolean;
}

const KIND_ICON: Record<EntityKind, typeof FileText> = {
  event: Calendar,
  task: CheckSquare,
  doc: FileText,
  sheet: Table,
};

export function BacklinksList({
  entityKey,
  label = "Linked",
  hideWhenEmpty = true,
}: BacklinksListProps) {
  const { resolveLabel, unlink, openAsDoc } = useEntityActions();
  const graph = useLinks();
  const links = useMemo(() => neighbors(graph, entityKey), [graph, entityKey]);

  if (links.length === 0 && hideWhenEmpty) return null;

  return (
    <div className="backlinks-list">
      {label ? <span className="backlinks-list__label">{label}</span> : null}
      <div className="backlinks-list__chips">
        {links.map((key) => {
          const parsed = parseEntityKey(key);
          if (!parsed) return null;
          const Icon = KIND_ICON[parsed.kind];
          const displayLabel = resolveLabel(key);
          return (
            <span
              key={key}
              className={`backlinks-chip backlinks-chip--${parsed.kind}`}
              title={`${parsed.kind}: ${displayLabel}`}
            >
              <button
                className="backlinks-chip__open"
                onClick={(e) => {
                  e.stopPropagation();
                  openAsDoc(key);
                }}
                type="button"
              >
                <Icon size={10} />
                <span className="backlinks-chip__label">{displayLabel}</span>
              </button>
              <button
                aria-label="Unlink"
                className="backlinks-chip__unlink"
                onClick={(e) => {
                  e.stopPropagation();
                  unlink(entityKey, key);
                }}
                type="button"
              >
                <X size={9} />
              </button>
            </span>
          );
        })}
        {links.length === 0 ? (
          <span className="backlinks-list__empty">No links yet</span>
        ) : null}
      </div>
    </div>
  );
}
