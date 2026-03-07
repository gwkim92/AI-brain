const STORAGE_PREFIX = "hud-widget-layout:";
const HUD_VIEWPORT_SELECTOR = "[data-hud-viewport='true']";

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

export function measureHudViewport(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: 0, height: 0 };
  }

  const element = document.querySelector<HTMLElement>(HUD_VIEWPORT_SELECTOR);
  if (element) {
    return {
      width: Math.max(320, element.clientWidth),
      height: Math.max(320, element.clientHeight),
    };
  }

  return {
    width: Math.max(320, window.innerWidth - 80),
    height: Math.max(320, window.innerHeight),
  };
}

export function tileWidgetLayouts(
  widgetIds: string[],
  viewportWidth: number,
  viewportHeight: number,
  topOffset = 52,
): void {
  if (widgetIds.length === 0) return;

  const gap = 12;
  const preferredTileWidth = 360;
  const maxColsByWidth = Math.max(1, Math.floor((viewportWidth - gap) / (preferredTileWidth + gap)));
  const cols = Math.max(1, Math.min(widgetIds.length, Math.ceil(Math.sqrt(widgetIds.length)), maxColsByWidth));
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

export function spotlightWidgetLayout(
  widgetId: string,
  viewportWidth: number,
  viewportHeight: number,
  topOffset = 52,
): void {
  const gap = 24;
  const safeWidth = Math.max(320, viewportWidth);
  const safeHeight = Math.max(320, viewportHeight);
  const availableHeight = Math.max(240, safeHeight - topOffset - gap * 2);
  const preferredWidth = Math.floor(safeWidth * 0.72);
  const preferredHeight = Math.floor(availableHeight * 0.82);
  const maxWidth = Math.max(320, safeWidth - gap * 2);
  const maxHeight = Math.max(240, safeHeight - topOffset - gap * 2);
  const width = Math.max(480, Math.min(preferredWidth, maxWidth));
  const height = Math.max(360, Math.min(preferredHeight, maxHeight));
  const x = Math.max(gap, Math.floor((safeWidth - width) / 2));
  const y = Math.max(topOffset + gap, Math.floor(topOffset + (availableHeight - height) / 2));

  saveWidgetLayout(widgetId, {
    x,
    y,
    w: width,
    h: height,
  });
}
