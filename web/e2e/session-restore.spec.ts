import { expect, test, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-e2e",
    data,
    meta,
  };
}

type SessionRestoreMockOptions = {
  runningTasks?: Array<{
    id: string;
    userId: string;
    mode: "chat" | "execute" | "council" | "code" | "compute" | "long_run" | "high_risk" | "radar_review" | "upgrade_execution";
    status: "queued" | "running" | "blocked" | "retrying" | "done" | "failed" | "cancelled";
    title: string;
    input: Record<string, unknown>;
    idempotencyKey: string;
    traceId?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  assistantContexts?: Array<{
    id: string;
    userId: string;
    clientContextId: string;
    source: string;
    intent: string;
    prompt: string;
    widgetPlan: string[];
    status: "queued" | "running" | "completed" | "failed";
    taskId: string | null;
    servedProvider: "openai" | "gemini" | "anthropic" | "local" | null;
    servedModel: string | null;
    usedFallback: boolean;
    selectionReason: string | null;
    output: string;
    error: string | null;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }>;
};

async function installSessionRestoreMocks(page: Page, options?: SessionRestoreMockOptions) {
  const runningTasks = options?.runningTasks ?? [];
  const assistantContexts = options?.assistantContexts ?? [];
  await page.route(`${API_BASE}/api/v1/**`, async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const path = new URL(request.url()).pathname;

    if (path.includes("/events") || path.endsWith("/stream")) {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
        body: "event: stream.open\ndata: {\"request_id\":\"req-e2e\"}\n\nevent: stream.close\ndata: {}\n\n",
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/dashboard/overview") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            generated_at: "2026-02-28T00:00:00.000Z",
            tasks: [],
            pending_approvals: [],
            running_tasks: runningTasks,
            signals: {
              task_count: runningTasks.length,
              running_count: runningTasks.length,
              failed_count: 0,
              blocked_count: 0,
              pending_approval_count: 0,
            },
          })
        ),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/tasks") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope([])),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/providers") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            providers: [
              {
                provider: "openai",
                enabled: true,
                model: "gpt-5",
              },
            ],
          })
        ),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/providers/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            providers: [
              {
                provider: "openai",
                configured_model: "gpt-5",
                recommended_model: "gpt-5",
                source: "configured",
                models: ["gpt-5"],
              },
            ],
          })
        ),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/assistant/contexts") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            contexts: assistantContexts,
          })
        ),
      });
      return;
    }

    if (method === "GET" && /^\/api\/v1\/tasks\/[^/]+$/.test(path)) {
      const taskId = path.split("/").pop() ?? "task-unknown";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            id: taskId,
            mode: "research",
            title: "mock task detail",
            input: {
              prompt: "mock prompt",
            },
            status: "running",
            createdAt: "2026-02-28T00:00:00.000Z",
            updatedAt: "2026-02-28T00:01:00.000Z",
            traceId: "trace-task-detail",
          })
        ),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/upgrades/proposals") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ proposals: [] })),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/radar/recommendations") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ recommendations: [] })),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({})),
    });
  });
}

test("session click defaults to focus-only and restore full expands mounted widgets", async ({ page, context }) => {
  await page.addInitScript(() => {
    const sessions = [
      {
        id: "session-focus",
        prompt: "focus session",
        createdAt: "2026-02-28T00:00:00.000Z",
        activeWidgets: ["inbox"],
        mountedWidgets: ["inbox", "tasks"],
        focusedWidget: "inbox",
        workspacePreset: "mission",
        lastWorkspacePreset: "mission",
        restoreMode: "full",
        status: "background",
      },
      {
        id: "session-inbox",
        prompt: "inbox session",
        createdAt: "2026-02-28T00:01:00.000Z",
        activeWidgets: ["inbox"],
        mountedWidgets: ["inbox"],
        focusedWidget: "inbox",
        workspacePreset: null,
        lastWorkspacePreset: null,
        restoreMode: "full",
        status: "active",
      },
    ];

    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("hud-sessions", JSON.stringify(sessions));
    window.localStorage.setItem("hud-active-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-mounted-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-focused-widget", "inbox");
    window.localStorage.setItem("hud-workspace-preset", "");
  });

  await context.addCookies([
    {
      name: "jarvis_auth_token",
      value: "e2e-token",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await installSessionRestoreMocks(page);
  await page.goto("/");
  const panelToggle = page.getByTitle("Toggle panel (Ctrl+.)");
  if (await panelToggle.isVisible()) {
    await panelToggle.click();
  }

  const sessionCard = page.locator('[data-testid="session-card-session-focus"]:visible').first();
  await expect(sessionCard).toBeVisible();
  await sessionCard.locator("button").first().click();

  await expect.poll(async () => {
    return page.evaluate(() => window.localStorage.getItem("hud-active-widgets"));
  }).toContain("inbox");

  const restoredSnapshot = await page.evaluate(() => {
    const active = JSON.parse(window.localStorage.getItem("hud-active-widgets") ?? "[]") as string[];
    const mounted = JSON.parse(window.localStorage.getItem("hud-mounted-widgets") ?? "[]") as string[];
    const focused = window.localStorage.getItem("hud-focused-widget");
    return { active, mounted, focused };
  });

  expect(restoredSnapshot.active).toEqual(["inbox"]);
  expect(restoredSnapshot.mounted).toEqual(["inbox", "tasks"]);
  expect(restoredSnapshot.focused).toBe("inbox");

  await page.locator('[data-testid="session-restore-full-session-focus"]:visible').first().click();

  const fullRestoreSnapshot = await page.evaluate(() => {
    const active = JSON.parse(window.localStorage.getItem("hud-active-widgets") ?? "[]") as string[];
    const mounted = JSON.parse(window.localStorage.getItem("hud-mounted-widgets") ?? "[]") as string[];
    const sessions = JSON.parse(window.localStorage.getItem("hud-sessions") ?? "[]") as Array<{
      id: string;
      restoreMode?: string;
    }>;
    const focusedSession = sessions.find((item) => item.id === "session-focus");
    return {
      active,
      mounted,
      restoreMode: focusedSession?.restoreMode ?? null,
    };
  });

  expect(fullRestoreSnapshot.active).toEqual(["inbox", "tasks"]);
  expect(fullRestoreSnapshot.mounted).toEqual(["inbox", "tasks"]);
  expect(fullRestoreSnapshot.restoreMode).toBe("full");

  await page.locator('[data-testid="session-restore-focus-session-focus"]:visible').first().click();

  const focusOnlySnapshot = await page.evaluate(() => {
    const active = JSON.parse(window.localStorage.getItem("hud-active-widgets") ?? "[]") as string[];
    const mounted = JSON.parse(window.localStorage.getItem("hud-mounted-widgets") ?? "[]") as string[];
    const sessions = JSON.parse(window.localStorage.getItem("hud-sessions") ?? "[]") as Array<{
      id: string;
      restoreMode?: string;
    }>;
    const focusedSession = sessions.find((item) => item.id === "session-focus");
    return {
      active,
      mounted,
      restoreMode: focusedSession?.restoreMode ?? null,
    };
  });

  expect(focusOnlySnapshot.active).toEqual(["inbox"]);
  expect(focusOnlySnapshot.mounted).toEqual(["inbox", "tasks"]);
  expect(focusOnlySnapshot.restoreMode).toBe("focus_only");
});

test("session click from task detail route navigates back to home and restores assistant focus", async ({ page, context }) => {
  await page.addInitScript(() => {
    const sessions = [
      {
        id: "session-assistant",
        prompt: "오늘 최신 뉴스 중에 중요한거 보고해봐",
        createdAt: "2026-03-03T04:30:00.000Z",
        activeWidgets: [],
        mountedWidgets: ["inbox", "tasks", "workbench", "assistant", "reports"],
        focusedWidget: null,
        workspacePreset: "studio_intelligence",
        lastWorkspacePreset: "studio_intelligence",
        restoreMode: "focus_only",
        status: "background",
        taskId: "task-news-1",
      },
      {
        id: "session-other",
        prompt: "other session",
        createdAt: "2026-03-03T04:10:00.000Z",
        activeWidgets: ["inbox"],
        mountedWidgets: ["inbox"],
        focusedWidget: "inbox",
        workspacePreset: null,
        lastWorkspacePreset: null,
        restoreMode: "focus_only",
        status: "active",
      },
    ];

    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("hud-sessions", JSON.stringify(sessions));
    window.localStorage.setItem("hud-active-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-mounted-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-focused-widget", "inbox");
    window.localStorage.setItem("hud-workspace-preset", "");
  });

  await context.addCookies([
    {
      name: "jarvis_auth_token",
      value: "e2e-token",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await installSessionRestoreMocks(page);
  await page.goto("/tasks/task-news-1");

  const panelToggle = page.getByTitle("Toggle panel (Ctrl+.)");
  if (await panelToggle.isVisible()) {
    await panelToggle.click();
  }

  const sessionCard = page.locator('[data-testid="session-card-session-assistant"]:visible').first();
  await expect(sessionCard).toBeVisible();
  await sessionCard.locator("button").first().click();

  await expect.poll(async () => page.evaluate(() => window.location.pathname)).toBe("/");
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("hud-active-widgets") ?? "")).toContain("assistant");
});

test("session click restores assistant response content from session store", async ({ page, context }) => {
  await page.addInitScript(() => {
    const sessions = [
      {
        id: "session-news-content",
        prompt: "오늘 최신 뉴스중 중요한거 보고해봐",
        createdAt: "2026-03-03T04:50:00.000Z",
        activeWidgets: ["assistant"],
        mountedWidgets: ["assistant", "tasks"],
        focusedWidget: "assistant",
        workspacePreset: "studio_intelligence",
        lastWorkspacePreset: "studio_intelligence",
        restoreMode: "focus_only",
        status: "background",
        taskId: "task-news-content",
      },
      {
        id: "session-other-active",
        prompt: "other active",
        createdAt: "2026-03-03T04:30:00.000Z",
        activeWidgets: ["inbox"],
        mountedWidgets: ["inbox"],
        focusedWidget: "inbox",
        workspacePreset: null,
        lastWorkspacePreset: null,
        restoreMode: "focus_only",
        status: "active",
      },
    ];

    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("hud-sessions", JSON.stringify(sessions));
    window.localStorage.setItem("hud-active-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-mounted-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-focused-widget", "inbox");
    window.localStorage.setItem("hud-workspace-preset", "");
    window.localStorage.setItem(
      "assistant-session-messages-v1",
      JSON.stringify({
        "session-news-content": [
          {
            role: "assistant",
            content: "Connected to backend. Ask anything and I will route this to available providers.",
            route: "system",
          },
          {
            role: "assistant",
            content: "복구 테스트 응답 본문",
            status: "openai/gpt-5",
            route: "auto_context",
            contextId: "session-news-content",
            promptRef: "오늘 최신 뉴스중 중요한거 보고해봐",
          },
        ],
      })
    );
  });

  await context.addCookies([
    {
      name: "jarvis_auth_token",
      value: "e2e-token",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await installSessionRestoreMocks(page);
  await page.goto("/");

  const panelToggle = page.getByTitle("Toggle panel (Ctrl+.)");
  if (await panelToggle.isVisible()) {
    await panelToggle.click();
  }

  const sessionCard = page.locator('[data-testid="session-card-session-news-content"]:visible').first();
  await expect(sessionCard).toBeVisible();
  await sessionCard.locator("button").first().click();

  await expect(page.getByText("복구 테스트 응답 본문")).toBeVisible();
});

test("sidebar home button navigates back from task detail route", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("hud-active-widgets", JSON.stringify([]));
    window.localStorage.setItem("hud-mounted-widgets", JSON.stringify(["inbox", "tasks"]));
    window.localStorage.setItem("hud-focused-widget", "");
  });

  await context.addCookies([
    {
      name: "jarvis_auth_token",
      value: "e2e-token",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await installSessionRestoreMocks(page);
  await page.goto("/tasks/task-home-return");

  await page.getByRole("button", { name: "Inbox" }).first().click();
  await expect.poll(async () => page.evaluate(() => window.location.pathname)).toBe("/");
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("hud-active-widgets") ?? "")).toContain("inbox");
});

test("running task click restores linked session and returns to home HUD", async ({ page, context }) => {
  await page.addInitScript(() => {
    const sessions = [
      {
        id: "session-running-linked",
        prompt: "오늘 최신 뉴스 중에 중요한거 보고해봐",
        createdAt: "2026-03-03T04:35:00.000Z",
        activeWidgets: [],
        mountedWidgets: ["assistant", "tasks", "reports", "workbench"],
        focusedWidget: null,
        workspacePreset: "studio_intelligence",
        lastWorkspacePreset: "studio_intelligence",
        restoreMode: "focus_only",
        status: "background",
        taskId: "task-news-linked",
      },
      {
        id: "session-other",
        prompt: "other active session",
        createdAt: "2026-03-03T04:20:00.000Z",
        activeWidgets: ["inbox"],
        mountedWidgets: ["inbox"],
        focusedWidget: "inbox",
        workspacePreset: null,
        lastWorkspacePreset: null,
        restoreMode: "focus_only",
        status: "active",
      },
    ];

    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("hud-sessions", JSON.stringify(sessions));
    window.localStorage.setItem("hud-active-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-mounted-widgets", JSON.stringify(["inbox"]));
    window.localStorage.setItem("hud-focused-widget", "inbox");
    window.localStorage.setItem("hud-workspace-preset", "");
  });

  await context.addCookies([
    {
      name: "jarvis_auth_token",
      value: "e2e-token",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await installSessionRestoreMocks(page, {
    runningTasks: [
      {
        id: "task-news-linked",
        userId: "user-e2e",
        mode: "chat",
        status: "running",
        title: "오늘 최신 뉴스중에 중요한거 보고해",
        input: { prompt: "오늘 최신 뉴스중에 중요한거 보고해" },
        idempotencyKey: "e2e-task-news-linked",
        traceId: "trace-e2e-task-news-linked",
        createdAt: "2026-03-03T04:35:10.000Z",
        updatedAt: "2026-03-03T04:35:20.000Z",
      },
    ],
  });
  await page.goto("/tasks/task-news-linked");

  const panelToggle = page.getByTitle("Toggle panel (Ctrl+.)");
  if (await panelToggle.isVisible()) {
    await panelToggle.click();
  }

  await page.locator('[data-testid="running-task-restore-task-news-linked"]:visible').first().click();
  await expect.poll(async () => page.evaluate(() => window.location.pathname)).toBe("/");
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("hud-active-widgets") ?? "")).toContain("assistant");
});
