import { expect, test, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-e2e",
    data,
    meta,
  };
}

async function installHomeMocks(page: Page): Promise<{
  getCounts: () => {
    createdTaskCount: number;
    createdContextCount: number;
  };
}> {
  let createdTaskCount = 0;
  let createdContextCount = 0;
  const assistantContexts = new Map<string, {
    id: string;
    userId: string;
    clientContextId: string;
    source: string;
    intent: string;
    prompt: string;
    widgetPlan: string[];
    status: "running" | "completed" | "failed";
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
  }>();

  await page.route(`${API_BASE}/api/v1/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
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

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({})),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers/models**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          providers: [
            {
              provider: "openai",
              configured_model: "gpt-4.1",
              source: "configured",
              models: ["gpt-4.1", "gpt-4.1-mini"],
            },
          ],
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          providers: [
            {
              provider: "openai",
              enabled: true,
              model: "gpt-4.1",
            },
          ],
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/assistant/contexts**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const path = url.pathname;

    if (method === "GET" && path === "/api/v1/assistant/contexts") {
      const contexts = Array.from(assistantContexts.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ contexts })),
      });
      return;
    }

    if (method === "POST" && path === "/api/v1/assistant/contexts") {
      const payload = request.postDataJSON() as {
        client_context_id: string;
        source?: string;
        intent?: string;
        prompt: string;
        widget_plan?: string[];
      };
      const existing = Array.from(assistantContexts.values()).find((item) => item.clientContextId === payload.client_context_id);
      if (existing) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(envelope(existing, { idempotent_replay: true })),
        });
        return;
      }

      createdContextCount += 1;
      const now = new Date(Date.now() + createdContextCount * 1000).toISOString();
      const nextId = `context-${createdContextCount}`;
      const row = {
        id: nextId,
        userId: "00000000-0000-4000-8000-000000000000",
        clientContextId: payload.client_context_id,
        source: payload.source ?? "inbox_quick_command",
        intent: payload.intent ?? "general",
        prompt: payload.prompt,
        widgetPlan: payload.widget_plan ?? [],
        status: "running" as const,
        taskId: null,
        servedProvider: null,
        servedModel: null,
        usedFallback: false,
        selectionReason: null,
        output: "",
        error: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      assistantContexts.set(nextId, row);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(envelope(row, { idempotent_replay: false })),
      });
      return;
    }

    const runMatch = path.match(/^\/api\/v1\/assistant\/contexts\/([^/]+)\/run$/);
    if (method === "POST" && runMatch) {
      const contextId = runMatch[1] ?? "";
      const current = assistantContexts.get(contextId);
      if (!current) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            request_id: "req-e2e",
            error: {
              code: "NOT_FOUND",
              message: "assistant context not found",
            },
          }),
        });
        return;
      }

      const now = new Date(Date.now() + createdContextCount * 1000 + 500).toISOString();
      const completed = {
        ...current,
        status: "completed" as const,
        servedProvider: "openai" as const,
        servedModel: "gpt-4.1",
        usedFallback: false,
        selectionReason: "top=openai score=1.000 task=code",
        output: "자동 위젯 오픈 후 Assistant가 요청을 처리했습니다.",
        error: null,
        revision: current.revision + 1,
        updatedAt: now,
      };
      assistantContexts.set(contextId, completed);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify(envelope(completed, { accepted: true, task_type: "code" })),
      });
      return;
    }

    const streamMatch = path.match(/^\/api\/v1\/assistant\/contexts\/([^/]+)\/events\/stream$/);
    if (method === "GET" && streamMatch) {
      const contextId = streamMatch[1] ?? "";
      const current = assistantContexts.get(contextId);
      if (!current) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            request_id: "req-e2e",
            error: {
              code: "NOT_FOUND",
              message: "assistant context not found",
            },
          }),
        });
        return;
      }

      const now = new Date().toISOString();
      const body = [
        "event: stream.open",
        `data: ${JSON.stringify({ request_id: "req-e2e", context_id: contextId, since_sequence: null })}`,
        "",
        "event: assistant.context.event",
        `data: ${JSON.stringify({
          context_id: contextId,
          timestamp: now,
          event: {
            id: `evt-${contextId}`,
            contextId,
            sequence: 1,
            eventType: "assistant.context.run.completed",
            data: {
              provider: "openai",
              model: "gpt-4.1",
              used_fallback: false,
              attempts: [
                {
                  provider: "openai",
                  status: "success",
                  latencyMs: 120,
                },
              ],
            },
            createdAt: now,
          },
          context: current,
        })}`,
        "",
        "event: stream.close",
        `data: ${JSON.stringify({ context_id: contextId, since_sequence: 1 })}`,
        "",
      ].join("\n");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
      return;
    }

    const eventsMatch = path.match(/^\/api\/v1\/assistant\/contexts\/([^/]+)\/events$/);
    if (method === "GET" && eventsMatch) {
      const contextId = eventsMatch[1] ?? "";
      const current = assistantContexts.get(contextId);
      if (!current) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            request_id: "req-e2e",
            error: {
              code: "NOT_FOUND",
              message: "assistant context not found",
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            context_id: contextId,
            events: [
              {
                id: `evt-history-${contextId}`,
                contextId,
                sequence: 1,
                eventType: "assistant.context.run.completed",
                data: {
                  provider: "openai",
                  model: "gpt-4.1",
                  used_fallback: false,
                  attempts: [
                    {
                      provider: "openai",
                      status: "success",
                      latencyMs: 120,
                    },
                  ],
                },
                createdAt: current.updatedAt,
              },
            ],
            next_since_sequence: 1,
          })
        ),
      });
      return;
    }

    const contextMatch = path.match(/^\/api\/v1\/assistant\/contexts\/([^/]+)$/);
    if (contextMatch) {
      const contextId = contextMatch[1] ?? "";
      const current = assistantContexts.get(contextId);
      if (!current) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            request_id: "req-e2e",
            error: {
              code: "NOT_FOUND",
              message: "assistant context not found",
            },
          }),
        });
        return;
      }

      if (method === "PATCH") {
        const payload = request.postDataJSON() as { task_id?: string | null };
        const now = new Date(Date.now() + createdContextCount * 1000 + 700).toISOString();
        const updated = {
          ...current,
          taskId: typeof payload.task_id === "string" ? payload.task_id : current.taskId,
          revision: current.revision + 1,
          updatedAt: now,
        };
        assistantContexts.set(contextId, updated);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(envelope(updated)),
        });
        return;
      }

      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(envelope(current)),
        });
        return;
      }
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        request_id: "req-e2e",
        error: {
          code: "NOT_FOUND",
          message: "mock route not implemented",
        },
      }),
    });
  });

  await page.route(`${API_BASE}/api/v1/tasks**`, async (route) => {
    if (route.request().method() === "POST") {
      createdTaskCount += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            id: `task-${createdTaskCount}`,
            userId: "00000000-0000-4000-8000-000000000000",
            mode: "code",
            status: "queued",
            title: "quick command",
            input: {},
            idempotencyKey: `e2e-${createdTaskCount}`,
            createdAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          })
        ),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope([
          {
            id: "task-seed",
            userId: "00000000-0000-4000-8000-000000000000",
            mode: "execute",
            status: "running",
            title: "seed running task",
            input: {},
            idempotencyKey: "seed",
            createdAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ])
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/upgrades/proposals**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ proposals: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/radar/recommendations**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ recommendations: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/dashboard/overview**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          generated_at: "2026-02-25T00:00:00.000Z",
          tasks: [],
          pending_approvals: [],
          running_tasks: [],
          signals: {
            task_count: 0,
            running_count: 0,
            failed_count: 0,
            blocked_count: 0,
            pending_approval_count: 0,
          },
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/dashboard/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
      body: "event: stream.open\ndata: {\"request_id\":\"req-e2e\"}\n\nevent: stream.close\ndata: {}\n\n",
    });
  });

  await page.route(`${API_BASE}/api/v1/settings/overview**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          generated_at: "2026-02-25T00:00:00.000Z",
          backend: {
            env: "test",
            store: "memory",
            db: "n/a",
            now: "2026-02-25T00:00:00.000Z",
          },
          providers: [],
          policies: {
            high_risk_requires_approval: true,
            approval_max_age_hours: 24,
            high_risk_allowed_roles: ["operator", "admin"],
            provider_failover_auto: true,
            auth_required: true,
          },
        })
      ),
    });
  });

  return {
    getCounts: () => ({
      createdTaskCount,
      createdContextCount,
    }),
  };
}

test("quick command auto-opens assistant/workbench/tasks and assistant auto-runs", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
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

  const mocks = await installHomeMocks(page);

  await page.goto("/?widget=inbox");

  await page.getByPlaceholder("Ask JARVIS anything...").fill("로그인 버그 수정하고 테스트까지 진행해");
  await page.getByRole("button", { name: "EXEC" }).click();

  await expect(page.getByRole("heading", { name: "AI ASSISTANT", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "WORKBENCH", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "TASK MANAGER", exact: true }).first()).toBeVisible();

  await expect(page.getByText("자동 위젯 오픈 후 Assistant가 요청을 처리했습니다.").first()).toBeVisible();
  const counts = mocks.getCounts();
  expect(counts.createdTaskCount).toBe(1);
  expect(counts.createdContextCount).toBe(1);
});

test("quick command ignores rapid duplicate submits and creates a single context", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
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

  const mocks = await installHomeMocks(page);
  await page.goto("/?widget=inbox");

  await page.getByPlaceholder("Ask JARVIS anything...").fill("중복 실행 방지 확인해");
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === "EXEC");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  await expect(page.getByText("자동 위젯 오픈 후 Assistant가 요청을 처리했습니다.").first()).toBeVisible();

  const counts = mocks.getCounts();
  expect(counts.createdTaskCount).toBe(1);
  expect(counts.createdContextCount).toBe(1);

  const sessionCount = await page.evaluate(() => {
    const raw = window.localStorage.getItem("hud-sessions");
    if (!raw) {
      return 0;
    }
    const parsed = JSON.parse(raw) as unknown[];
    return Array.isArray(parsed) ? parsed.length : 0;
  });
  expect(sessionCount).toBe(1);
});
