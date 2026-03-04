"use client";

import { useEffect, useState } from "react";
import type { TaskViewSchema } from "@/lib/api/types";
import { JARVIS_RUNTIME_EVENT_STREAM, type JarvisRuntimeEventDetail } from "@/lib/runtime-events";
import { renderRuntimeWidget } from "./widget-registry";

type RuntimeSchemaEventPayload = {
  taskId?: string;
  schema?: TaskViewSchema;
};

function parseTaskViewSchemaFromEvent(event: Event): TaskViewSchema | null {
  const customEvent = event as CustomEvent<JarvisRuntimeEventDetail<RuntimeSchemaEventPayload>>;
  const detail = customEvent.detail;
  if (!detail || detail.name !== "v2_task_view_schema_updated") return null;
  if (!detail.payload || typeof detail.payload !== "object") return null;
  const schema = detail.payload.schema;
  if (!schema || typeof schema !== "object") return null;
  return schema;
}

export function TaskViewRenderer() {
  const [schema, setSchema] = useState<TaskViewSchema | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const nextSchema = parseTaskViewSchemaFromEvent(event);
      if (nextSchema) {
        setSchema(nextSchema);
      }
    };
    window.addEventListener(JARVIS_RUNTIME_EVENT_STREAM, handler as EventListener);
    return () => {
      window.removeEventListener(JARVIS_RUNTIME_EVENT_STREAM, handler as EventListener);
    };
  }, []);

  if (!schema) {
    return null;
  }

  return (
    <section className="pointer-events-auto absolute left-4 bottom-4 z-[70] w-[min(520px,92vw)] rounded-xl border border-cyan-300/30 bg-slate-950/80 p-4 shadow-[0_16px_64px_rgba(8,145,178,0.22)] backdrop-blur-md">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-cyan-200/70">Task View Schema</p>
          <p className="text-sm text-cyan-50">{schema.task_id}</p>
        </div>
        <span className="rounded border border-cyan-300/40 px-2 py-0.5 text-[10px] text-cyan-200">{schema.layout}</span>
      </header>

      <div className="grid gap-2">{schema.widgets.map((widget) => renderRuntimeWidget(widget))}</div>

      <div className="mt-3 flex flex-wrap gap-2">
        {schema.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!action.enabled}
            className={[
              "rounded px-2 py-1 text-[11px] uppercase tracking-[0.16em] transition-colors",
              action.enabled
                ? "border border-cyan-300/45 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                : "cursor-not-allowed border border-white/20 bg-white/5 text-white/45",
            ].join(" ")}
            title={action.reason}
          >
            {action.id}
          </button>
        ))}
      </div>
    </section>
  );
}
