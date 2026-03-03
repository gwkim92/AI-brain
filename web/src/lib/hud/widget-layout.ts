const STORAGE_PREFIX = "hud-widget-layout:";

export type WidgetLayout = { x: number; y: number; w: number; h: number };

export function loadWidgetLayout(id: string): WidgetLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof data.x === "number" &&
      typeof data.y === "number" &&
      typeof data.w === "number" &&
      typeof data.h === "number"
    ) {
      return data as unknown as WidgetLayout;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveWidgetLayout(id: string, layout: WidgetLayout): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(layout));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function clearWidgetLayout(id: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + id);
  } catch {
    // ignore
  }
}

export function clearAllWidgetLayouts(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keysToRemove.push(key);
    }
    for (const key of keysToRemove) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function tileWidgetLayouts(
  widgetIds: string[],
  viewportWidth: number,
  viewportHeight: number,
  topOffset = 52,
): void {
  if (widgetIds.length === 0) return;

  const gap = 12;
  const cols = Math.ceil(Math.sqrt(widgetIds.length));
  const rows = Math.ceil(widgetIds.length / cols);
  const usableW = viewportWidth - gap * (cols + 1);
  const usableH = viewportHeight - topOffset - gap * (rows + 1);
  const tileW = Math.floor(usableW / cols);
  const tileH = Math.floor(usableH / rows);

  widgetIds.forEach((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    saveWidgetLayout(id, {
      x: gap + col * (tileW + gap),
      y: topOffset + gap + row * (tileH + gap),
      w: tileW,
      h: tileH,
    });
  });
}
