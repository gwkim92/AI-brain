import { expect, test, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

test.describe.configure({ mode: "serial" });

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-e2e",
    data,
    meta,
  };
}

async function installAppApiMocks(page: Page) {
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

  await page.route(`${API_BASE}/api/v1/tasks**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope([])),
    });
  });

  await page.route(`${API_BASE}/api/v1/dossiers**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/dossiers") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ dossiers: [] })),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        request_id: "req-e2e",
        error: { code: "NOT_FOUND", message: "dossier not found" },
      }),
    });
  });

  await page.route(`${API_BASE}/api/v1/skills**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ skills: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/upgrades/proposals**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ proposals: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/missions**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    const missionEventsMatch = path.match(/^\/api\/v1\/missions\/([^/]+)\/events$/);
    if (missionEventsMatch) {
      const missionId = missionEventsMatch[1] ?? "mission-e2e";
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
        body: [
          "event: stream.open",
          `data: ${JSON.stringify({ request_id: "req-e2e", mission_id: missionId })}`,
          "",
          "event: mission.updated",
          `data: ${JSON.stringify({
            mission_id: missionId,
            timestamp: "2026-02-25T00:00:00.000Z",
            data: {
              id: missionId,
              userId: "00000000-0000-4000-8000-000000000000",
              workspaceId: null,
              title: "Mission",
              objective: "Synthetic mission stream",
              domain: "mixed",
              status: "running",
              steps: [
                {
                  id: "sid-1",
                  type: "execute",
                  title: "Step 1",
                  description: "Synthetic step",
                  route: "/mission",
                  status: "running",
                  order: 1,
                },
              ],
              createdAt: "2026-02-25T00:00:00.000Z",
              updatedAt: "2026-02-25T00:00:00.000Z",
            },
          })}`,
          "",
          "event: stream.close",
          `data: ${JSON.stringify({ request_id: "req-e2e", mission_id: missionId, reason: "timeout" })}`,
          "",
        ].join("\n"),
      });
      return;
    }

    const missionDetailMatch = path.match(/^\/api\/v1\/missions\/([^/]+)$/);
    if (missionDetailMatch) {
      const missionId = missionDetailMatch[1] ?? "mission-e2e";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            id: missionId,
            userId: "00000000-0000-4000-8000-000000000000",
            workspaceId: null,
            title: "Mission",
            objective: "Synthetic mission snapshot",
            domain: "mixed",
            status: "running",
            steps: [
              {
                id: "sid-1",
                type: "execute",
                title: "Step 1",
                description: "Synthetic step",
                route: "/mission",
                status: "running",
                order: 1,
              },
            ],
            createdAt: "2026-02-25T00:00:00.000Z",
            updatedAt: "2026-02-25T00:00:00.000Z",
          })
        ),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ missions: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers/models**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ providers: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ providers: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/reports/overview**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          generated_at: "2026-02-24T00:00:00.000Z",
          sampled_limits: { task_limit: 120, run_limit: 80 },
          tasks: {
            total: 0,
            by_status: { queued: 0, running: 0, blocked: 0, retrying: 0, done: 0, failed: 0, cancelled: 0 },
            by_mode: {
              chat: 0,
              execute: 0,
              council: 0,
              code: 0,
              compute: 0,
              long_run: 0,
              high_risk: 0,
              radar_review: 0,
              upgrade_execution: 0,
            },
            running: 0,
            failed_or_cancelled: 0,
          },
          councils: {
            total: 0,
            by_status: { queued: 0, running: 0, completed: 0, failed: 0 },
            by_consensus: { consensus_reached: 0, contradiction_detected: 0, escalated_to_human: 0 },
            escalated: 0,
          },
          executions: {
            total: 0,
            by_status: { queued: 0, running: 0, completed: 0, failed: 0 },
            avg_duration_ms: 0,
            fallback_used: 0,
            fallback_rate_pct: 0,
          },
          upgrades: {
            total: 0,
            by_status: {
              proposed: 0,
              approved: 0,
              planning: 0,
              running: 0,
              verifying: 0,
              deployed: 0,
              failed: 0,
              rolled_back: 0,
              rejected: 0,
            },
            pending_approvals: 0,
          },
          radar: {
            recommendation_total: 0,
            by_decision: { adopt: 0, hold: 0, discard: 0 },
          },
          providers: {
            enabled: 0,
            disabled: 0,
            items: [],
          },
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/radar/reports/telegram/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
      body: "event: stream.open\ndata: {\"request_id\":\"req-e2e\"}\n\nevent: stream.close\ndata: {}\n\n",
    });
  });

  await page.route(`${API_BASE}/api/v1/radar/reports/telegram**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ reports: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers/registry**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ models: [] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/providers/policies**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ policies: [] })),
    });
  });
}

async function installMissionDockMocks(page: Page) {
  await installAppApiMocks(page);

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

  await page.route(`${API_BASE}/api/v1/missions/mission-1/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
      body: [
        "event: stream.open",
        `data: ${JSON.stringify({ request_id: "req-e2e", mission_id: "mission-1" })}`,
        "",
        "event: mission.updated",
        `data: ${JSON.stringify({
          mission_id: "mission-1",
          timestamp: "2026-02-25T00:02:00.000Z",
          data: {
            id: "mission-1",
            userId: "00000000-0000-4000-8000-000000000000",
            workspaceId: null,
            title: "Alpha",
            objective: "execute coordinated mission",
            domain: "mixed",
            status: "running",
            steps: [
              {
                id: "step-code",
                type: "code",
                title: "Implement core flow",
                description: "build runtime integration",
                route: "/studio/code",
                status: "running",
                order: 1,
              },
              {
                id: "step-research",
                type: "research",
                title: "Collect references",
                description: "gather supporting data",
                route: "/studio/research",
                status: "pending",
                order: 2,
              },
            ],
            createdAt: "2026-02-25T00:00:00.000Z",
            updatedAt: "2026-02-25T00:02:00.000Z",
          },
        })}`,
        "",
        "event: stream.close",
        `data: ${JSON.stringify({ request_id: "req-e2e", mission_id: "mission-1", reason: "timeout" })}`,
        "",
      ].join("\n"),
    });
  });

  await page.route(`${API_BASE}/api/v1/missions/mission-1`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          id: "mission-1",
          userId: "00000000-0000-4000-8000-000000000000",
          workspaceId: null,
          title: "Alpha",
          objective: "execute coordinated mission",
          domain: "mixed",
          status: "running",
          steps: [
            {
              id: "step-code",
              type: "code",
              title: "Implement core flow",
              description: "build runtime integration",
              route: "/studio/code",
              status: "running",
              order: 1,
            },
            {
              id: "step-research",
              type: "research",
              title: "Collect references",
              description: "gather supporting data",
              route: "/studio/research",
              status: "pending",
              order: 2,
            },
          ],
          createdAt: "2026-02-25T00:00:00.000Z",
          updatedAt: "2026-02-25T00:02:00.000Z",
        })
      ),
    });
  });
}

test("sidebar mission/studio buttons open HUD widget workspaces without route navigation", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
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

  await installAppApiMocks(page);

  const navigationChecks: Array<{ testId: string; widgets: string[] }> = [
    { testId: "sidebar-workspace-jarvis", widgets: ["inbox", "assistant", "tasks"] },
    { testId: "sidebar-workspace-execution", widgets: ["assistant", "tasks", "workbench"] },
    { testId: "sidebar-workspace-research", widgets: ["dossier", "watchers", "assistant"] },
    { testId: "sidebar-workspace-control", widgets: ["reports", "action_center", "notifications"] },
  ];

  for (const item of navigationChecks) {
    await page.goto("/?widget=inbox");

    const navButton = page.getByTestId(item.testId);
    await expect(navButton).toBeVisible();
    await navButton.click();
    await expect(page).not.toHaveURL(/\/mission(?:\?|$)|\/studio\//);

    for (const widgetId of item.widgets) {
      await expect(page.getByTestId(`glass-widget-${widgetId}`)).toBeVisible();
    }
  }
});

test("legacy mission/studio routes redirect to HUD widgets", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
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

  await installAppApiMocks(page);

  const checks: Array<{ path: string; widgets: string[] }> = [
    { path: "/mission?mission=mid-1&step=sid-1", widgets: ["inbox", "assistant", "tasks"] },
    { path: "/studio/code", widgets: ["assistant", "tasks", "workbench"] },
    { path: "/studio/research", widgets: ["dossier", "watchers", "assistant"] },
    { path: "/studio/finance", widgets: ["reports", "action_center", "notifications"] },
    { path: "/studio/news", widgets: ["reports", "action_center", "notifications"] },
  ];

  for (const item of checks) {
    await page.goto(item.path);
    await expect(page).not.toHaveURL(/\/mission(?:\?|$)|\/studio\//);
    await expect
      .poll(() => {
        const currentUrl = new URL(page.url());
        return currentUrl.searchParams.get("widgets");
      })
      .toBeNull();

    const currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("widgets")).toBeNull();
    if (item.path.startsWith("/mission?")) {
      expect(currentUrl.searchParams.get("mission")).toBe("mid-1");
      expect(currentUrl.searchParams.get("step")).toBe("sid-1");
    }

    for (const widgetId of item.widgets) {
      await expect(page.getByTestId(`glass-widget-${widgetId}`)).toBeVisible();
    }
  }
});

test("single widget deep-links override persisted HUD layout and spotlight the requested widget", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
    window.localStorage.setItem("hud-mounted-widgets", JSON.stringify(["assistant", "tasks", "notifications"]));
    window.localStorage.setItem("hud-active-widgets", JSON.stringify(["assistant", "tasks", "notifications"]));
    window.localStorage.setItem("hud-focused-widget", "notifications");
    window.localStorage.setItem("hud-workspace-preset", "jarvis");
    window.localStorage.setItem("hud-widget-layout:workbench", JSON.stringify({ x: 1040, y: 32, w: 220, h: 220 }));
    window.localStorage.setItem("hud-widget-layout:assistant", JSON.stringify({ x: 32, y: 52, w: 420, h: 300 }));
    window.localStorage.setItem("hud-widget-layout:tasks", JSON.stringify({ x: 460, y: 52, w: 420, h: 300 }));
    window.localStorage.setItem("hud-widget-layout:notifications", JSON.stringify({ x: 900, y: 52, w: 280, h: 220 }));
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

  await installAppApiMocks(page);

  await page.goto("/?widget=workbench");

  await expect(page.getByTestId("glass-widget-workbench")).toBeVisible();
  await expect(page.getByTestId("glass-widget-assistant")).toBeHidden();
  await expect(page.getByTestId("glass-widget-tasks")).toBeHidden();
  await expect(page.getByTestId("glass-widget-notifications")).toBeHidden();

  const box = await page.getByTestId("glass-widget-workbench").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(480);
  expect(box!.height).toBeGreaterThan(360);
  expect(box!.x).toBeLessThan(900);
  expect(box!.x).not.toBe(1040);
  expect(box!.y).toBeGreaterThan(24);
  await expect(page).not.toHaveURL(/widget=|widgets=|focus=|replace=|activation=/);
});

test("research preset keeps watcher create form clickable beside empty dossier state", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "member");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
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

  await installAppApiMocks(page);

  const watchers: Array<{
    id: string;
    userId: string;
    kind: string;
    title: string;
    query: string;
    status: string;
    lastRunAt: string | null;
    createdAt: string;
    updatedAt: string;
  }> = [];
  const staleApprovalSession = {
    id: "jarvis-session-stale-1",
    userId: "00000000-0000-4000-8000-000000000000",
    title: "Stale approval from older mission",
    prompt: "older mission approval",
    source: "mission",
    intent: "code",
    status: "needs_approval",
    workspacePreset: "control",
    primaryTarget: "mission",
    taskId: null,
    missionId: "mission-stale-1",
    assistantContextId: null,
    councilRunId: null,
    executionRunId: null,
    briefingId: null,
    dossierId: null,
    lastEventAt: "2026-03-05T23:00:00.000Z",
    createdAt: "2026-03-05T23:00:00.000Z",
    updatedAt: "2026-03-05T23:00:00.000Z",
  };
  const staleApprovalAction = {
    id: "proposal-stale-1",
    userId: staleApprovalSession.userId,
    sessionId: staleApprovalSession.id,
    kind: "workspace_prepare",
    title: "Approve stale write",
    summary: "Stale write approval",
    status: "pending",
    payload: {
      command: "touch stale.txt",
      cwd: "/workspace",
      risk_level: "write",
      policy_severity: "high",
      impact_profile: "file_mutation",
      workspace_kind: "current",
      policy_disposition: "approval_required",
      policy_reason: "stale approval item",
    },
    decidedAt: null,
    decidedBy: null,
    createdAt: "2026-03-05T23:00:00.000Z",
    updatedAt: "2026-03-05T23:00:00.000Z",
  };
  const followUpSession = {
    id: "jarvis-session-e2e-1",
    userId: "00000000-0000-4000-8000-000000000000",
    title: "Policy change follow-up for watcher",
    prompt: "Review the new policy change from the watcher run",
    source: "watcher_follow_up",
    intent: "research",
    status: "needs_approval",
    workspacePreset: "control",
    primaryTarget: "briefing",
    taskId: null,
    missionId: null,
    assistantContextId: null,
    councilRunId: null,
    executionRunId: null,
    briefingId: "briefing-e2e-1",
    dossierId: "dossier-e2e-1",
    lastEventAt: "2026-03-06T00:05:00.000Z",
    createdAt: "2026-03-06T00:05:00.000Z",
    updatedAt: "2026-03-06T00:05:00.000Z",
  };
  const followUpAction = {
    id: "proposal-e2e-1",
    userId: followUpSession.userId,
    sessionId: followUpSession.id,
    kind: "custom",
    title: "Review policy change",
    summary: "A policy follow-up was created for review.",
    status: "pending",
    payload: {
      change_class: "policy_change",
      severity: "warning",
      research_profile: "policy_regulation",
      change_score: 62,
      change_reasons: ["official_source_signal", "effective_date_signal"],
      execution_option: "read_only_review",
    },
    decidedAt: null,
    decidedBy: null,
    createdAt: "2026-03-06T00:05:00.000Z",
    updatedAt: "2026-03-06T00:05:00.000Z",
  };

  await page.route(`${API_BASE}/api/v1/watchers**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/watchers" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ watchers })),
      });
      return;
    }
    if (path === "/api/v1/watchers" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { kind: string; title: string; query: string };
      watchers.unshift({
        id: "watcher-e2e-1",
        userId: "00000000-0000-4000-8000-000000000000",
        kind: body.kind,
        title: body.title,
        query: body.query,
        status: "active",
        lastRunAt: null,
        createdAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(envelope(watchers[0])),
      });
      return;
    }
    if (path === "/api/v1/watchers/watcher-e2e-1/run" && route.request().method() === "POST") {
      watchers[0] = {
        ...watchers[0],
        lastRunAt: "2026-03-06T00:05:00.000Z",
        updatedAt: "2026-03-06T00:05:00.000Z",
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            watcher: watchers[0],
            run: {
              id: "watcher-run-e2e-1",
              watcherId: watchers[0].id,
              userId: watchers[0].userId,
              status: "completed",
              summary: "Synthetic watcher run completed",
              briefingId: "briefing-e2e-1",
              dossierId: "dossier-e2e-1",
              error: null,
              createdAt: "2026-03-06T00:05:00.000Z",
              updatedAt: "2026-03-06T00:05:00.000Z",
            },
            briefing: {
              id: "briefing-e2e-1",
            },
            dossier: {
              id: "dossier-e2e-1",
            },
            follow_up: {
              session: {
                id: "jarvis-session-e2e-1",
              },
              actionProposal: {
                id: "proposal-e2e-1",
                title: "Review policy change",
              },
              changeClass: "policy_change",
              severity: "warning",
              summary: "A policy follow-up was created for review.",
              score: 62,
              reasons: ["official_source_signal", "effective_date_signal"],
            },
          })
        ),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(`${API_BASE}/api/v1/jarvis/sessions**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/jarvis/sessions") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ sessions: [staleApprovalSession, followUpSession] })),
      });
      return;
    }
    if (path === `/api/v1/jarvis/sessions/${followUpSession.id}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: followUpSession,
            events: [],
            actions: [followUpAction],
            stages: [],
            briefing: null,
            dossier: null,
          })
        ),
      });
      return;
    }
    if (path === `/api/v1/jarvis/sessions/${staleApprovalSession.id}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: staleApprovalSession,
            events: [],
            actions: [staleApprovalAction],
            stages: [],
            briefing: null,
            dossier: null,
          })
        ),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/studio/research");
  await expect(page).not.toHaveURL(/\/studio\//);
  await expect(page.getByTestId("glass-widget-watchers")).toBeVisible();
  await expect(page.getByTestId("glass-widget-dossier")).toBeVisible();
  await page
    .getByTestId("glass-widget-dossier")
    .getByRole("button", { name: "List", exact: true })
    .click();

  await page.getByPlaceholder("Watcher title").fill("Research lane watcher");
  await page.getByPlaceholder("What should Jarvis monitor?").fill("world major news and war updates");
  await page.getByRole("button", { name: "ADD", exact: true }).click();
  await page
    .locator("main")
    .filter({ has: page.getByText("Proactive monitoring lanes") })
    .first()
    .locator("div.rounded.border")
    .filter({ has: page.getByText("Research lane watcher") })
    .first()
    .getByRole("button", { name: "RUN", exact: true })
    .click();
  await page
    .getByTestId("glass-widget-dossier")
    .getByRole("button", { name: "List", exact: true })
    .click();

  await expect(page.getByText("Research lane watcher")).toBeVisible();
  await expect(page.getByText("External Topic · world major news and war updates")).toBeVisible();
  await expect(page.getByText("Latest run result")).toBeVisible();
  await expect(page.getByText("A follow-up review is ready.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Dossier" })).toBeVisible();
  const openActionCenterLink = page.getByRole("link", { name: "Open Action Center" });
  await expect(openActionCenterLink).toBeVisible();
  await openActionCenterLink.click();

  const actionCenter = page.getByTestId("glass-widget-action_center");
  await expect(actionCenter).toBeVisible();
  await expect(actionCenter.getByText("Policy change follow-up for watcher")).toBeVisible();
  await expect(actionCenter.getByText("Review policy change")).toBeVisible();
  await expect(actionCenter.getByText("A policy follow-up was created for review.")).toBeVisible();
});

test("widget close remains closed and refresh does not reopen preset widgets", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
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

  await installAppApiMocks(page);

  await page.goto("/studio/code");
  await expect(page).not.toHaveURL(/\/studio\//);

  await expect(page.getByTestId("glass-widget-workbench")).toHaveCount(1);
  await page.getByTestId("glass-widget-close-workbench").click();
  await expect(page.getByTestId("glass-widget-workbench")).not.toBeVisible();

  await page.reload();
  await expect(page.getByTestId("glass-widget-workbench")).not.toBeVisible();
  await expect(page.getByTestId("glass-widget-tasks")).toBeVisible();
  await expect(page.getByTestId("glass-widget-assistant")).toBeVisible();
});

test("approving an action refreshes inbox pending actions", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "member");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
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

  await installAppApiMocks(page);

  let pendingCount = 1;
  const sessionRecord = {
    id: "session-approval-1",
    userId: "00000000-0000-4000-8000-000000000000",
    title: "Approve process launch in Inbox Sync Runtime",
    prompt: "node -p process.version",
    source: "workspace_runtime",
    intent: "code",
    status: "needs_approval",
    workspacePreset: "execution",
    primaryTarget: "execution",
    taskId: null,
    missionId: null,
    assistantContextId: null,
    councilRunId: null,
    executionRunId: null,
    briefingId: null,
    dossierId: null,
    lastEventAt: "2026-03-06T00:01:00.000Z",
    createdAt: "2026-03-06T00:01:00.000Z",
    updatedAt: "2026-03-06T00:01:00.000Z",
  };
  const actionRecord = {
    id: "action-approval-1",
    userId: sessionRecord.userId,
    sessionId: sessionRecord.id,
    kind: "workspace_prepare",
    title: sessionRecord.title,
    summary: "A runtime or script process is expected to start.",
    status: "pending",
    payload: {
      command: "node -p process.version",
      cwd: "/workspace",
      risk_level: "build",
      policy_severity: "high",
      impact_profile: "process_launch",
      workspace_kind: "current",
      policy_disposition: "approval_required",
      policy_reason: "runtime or script launch on host or worktree runtimes requires approval",
      impact: {
        files: {
          level: "possible",
          summary: "Build artifacts, caches, or local outputs may be created.",
          targets: ["process.version"],
        },
        network: {
          level: "none",
          summary: "No external network access expected unless the tool fetches dependencies implicitly.",
          targets: [],
        },
        processes: {
          level: "expected",
          summary: "A runtime or script process is expected to start.",
          targets: ["node -p", "process.version"],
        },
        notes: ["Targets the primary repository checkout on the host."],
      },
    },
    decidedAt: null,
    decidedBy: null,
    createdAt: "2026-03-06T00:01:00.000Z",
    updatedAt: "2026-03-06T00:01:00.000Z",
  };

  await page.route(`${API_BASE}/api/v1/jarvis/sessions**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/jarvis/sessions") {
      const sessions = pendingCount > 0 ? [sessionRecord] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ sessions })),
      });
      return;
    }
    if (path === `/api/v1/jarvis/sessions/${sessionRecord.id}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: {
              ...sessionRecord,
              status: pendingCount > 0 ? "needs_approval" : "completed",
            },
            events: [],
            actions: pendingCount > 0 ? [actionRecord] : [],
            briefing: null,
            dossier: null,
          })
        ),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(`${API_BASE}/api/v1/jarvis/sessions/${sessionRecord.id}/actions/${actionRecord.id}/approve`, async (route) => {
    pendingCount = 0;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          session: { ...sessionRecord, status: "running" },
          action: { ...actionRecord, status: "approved" },
        })
      ),
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("glass-widget-inbox")).toBeVisible();
  await expect(page.getByText("1 proposal(s) waiting.")).toBeVisible();

  await page.getByTestId("sidebar-action-center").click();
  const actionCenter = page.getByTestId("glass-widget-action_center");
  await expect(actionCenter).toBeVisible();
  const sessionButton = actionCenter.getByRole("button", { name: /Approve process launch in Inbox Sync Runtime/i });
  await expect(sessionButton).toBeVisible();
  await sessionButton.click();
  const approveButton = actionCenter.getByRole("button", { name: "APPROVE", exact: true });
  await expect(approveButton).toBeVisible();
  await approveButton.click();

  await expect(page.getByText("0 proposal(s) waiting.")).toBeVisible();
});

test("approval-required workspace commands hide stale transcript until approval", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "member");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
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

  await installAppApiMocks(page);

  const workspace = {
    id: "workspace-e2e",
    userId: "00000000-0000-4000-8000-000000000000",
    name: "Approval Replay Runtime",
    cwd: "/workspace",
    kind: "current",
    baseRef: null,
    sourceWorkspaceId: null,
    containerName: null,
    containerImage: null,
    containerSource: null,
    containerImageManaged: false,
    containerBuildContext: null,
    containerDockerfile: null,
    containerFeatures: [],
    containerAppliedFeatures: [],
    containerWorkdir: null,
    containerConfigPath: null,
    containerRunArgs: [],
    containerWarnings: [],
    status: "stopped",
    approvalRequired: true,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    sessionId: "workspace-session-e2e",
    activeCommand: null,
    exitCode: 0,
    lastError: null,
  };

  await page.route(`${API_BASE}/api/v1/workspaces`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ workspaces: [workspace] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/workspaces/${workspace.id}/pty/read**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          workspace,
          chunks: [
            {
              sequence: 1,
              stream: "system",
              text: "command started: printf PREVIOUS-OUTPUT",
              createdAt: "2026-03-06T00:00:00.000Z",
            },
            {
              sequence: 2,
              stream: "stdout",
              text: "PREVIOUS-OUTPUT\\n",
              createdAt: "2026-03-06T00:00:00.100Z",
            },
            {
              sequence: 3,
              stream: "system",
              text: "command exited with code 0",
              createdAt: "2026-03-06T00:00:00.200Z",
            },
          ],
          nextSequence: 4,
        })
      ),
    });
  });

  await page.route(`${API_BASE}/api/v1/workspaces/${workspace.id}/pty/spawn`, async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          workspace,
          low_risk: false,
          requires_approval: true,
          policy: {
            normalizedCommand: "node -p process.version",
            riskLevel: "build",
            impactProfile: "process_launch",
            severity: "high",
            disposition: "approval_required",
            reason: "runtime or script launch on host or worktree runtimes requires approval",
            impact: {
              files: {
                level: "possible",
                summary: "Build artifacts, caches, or local outputs may be created.",
                targets: ["process.version"],
              },
              network: {
                level: "none",
                summary: "No external network access expected unless the tool fetches dependencies implicitly.",
                targets: [],
              },
              processes: {
                level: "expected",
                summary: "A runtime or script process is expected to start.",
                targets: ["node -p", "process.version"],
              },
              notes: ["Targets the primary repository checkout on the host."],
            },
          },
          session: {
            id: "jarvis-session-e2e",
            userId: workspace.userId,
            title: "Approve process launch in Approval Replay Runtime",
            prompt: "node -p process.version",
            source: "workspace_runtime",
            intent: "code",
            status: "needs_approval",
            workspacePreset: "execution",
            primaryTarget: "execution",
            taskId: null,
            missionId: null,
            assistantContextId: null,
            councilRunId: null,
            executionRunId: null,
            briefingId: null,
            dossierId: null,
            lastEventAt: "2026-03-06T00:01:00.000Z",
            createdAt: "2026-03-06T00:01:00.000Z",
            updatedAt: "2026-03-06T00:01:00.000Z",
          },
          action: {
            id: "action-e2e",
            userId: workspace.userId,
            sessionId: "jarvis-session-e2e",
            kind: "workspace_prepare",
            title: "Approve process launch in Approval Replay Runtime",
            summary: "A runtime or script process is expected to start.",
            status: "pending",
            payload: {},
            decidedAt: null,
            decidedBy: null,
            createdAt: "2026-03-06T00:01:00.000Z",
            updatedAt: "2026-03-06T00:01:00.000Z",
          },
        })
      ),
    });
  });

  await page.goto("/studio/code");
  await expect(page).not.toHaveURL(/\/studio\//);
  await expect(page.getByTestId("glass-widget-workbench")).toBeVisible();
  const dock = page.getByTestId("context-dock");
  await expect(dock).toBeVisible();
  const runCommandButton = page.getByTestId("workbench-run-command");
  await runCommandButton.scrollIntoViewIfNeeded();
  const [runButtonBox, dockBox] = await Promise.all([runCommandButton.boundingBox(), dock.boundingBox()]);
  expect(runButtonBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  const runButtonBottom = (runButtonBox?.y ?? 0) + (runButtonBox?.height ?? 0);
  expect(runButtonBottom < (dockBox?.y ?? Number.POSITIVE_INFINITY) - 4).toBe(true);
  const workspaceRuntimePanel = page.getByTestId("workbench-run-command").locator('xpath=ancestor::div[contains(@class,"space-y-3")][1]');
  const workspaceTranscript = page.getByTestId("workbench-workspace-transcript");

  await expect(workspaceTranscript).toContainText("PREVIOUS-OUTPUT");

  await page.getByTestId("workbench-workspace-command").fill("node -p process.version");
  await runCommandButton.click();

  await expect(workspaceRuntimePanel).toContainText(
    "Approve process launch in Approval Replay Runtime queued for approval review (risk=build)."
  );
  await expect(workspaceTranscript).toContainText(
    "Approval pending. The command will not run until an approved action resumes this workspace."
  );
  await expect(workspaceTranscript).not.toContainText("PREVIOUS-OUTPUT");
});

test("member current-runtime write commands show policy guidance without creating a fake session", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "member");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
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

  await installAppApiMocks(page);

  const workspace = {
    id: "workspace-role-e2e",
    userId: "00000000-0000-4000-8000-000000000000",
    name: "Member Current Runtime",
    cwd: "/workspace",
    kind: "current",
    baseRef: null,
    sourceWorkspaceId: null,
    containerName: null,
    containerImage: null,
    containerSource: null,
    containerImageManaged: false,
    containerBuildContext: null,
    containerDockerfile: null,
    containerFeatures: [],
    containerAppliedFeatures: [],
    containerWorkdir: null,
    containerConfigPath: null,
    containerRunArgs: [],
    containerWarnings: [],
    status: "stopped",
    approvalRequired: true,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    sessionId: null,
    activeCommand: null,
    exitCode: 0,
    lastError: null,
  };

  await page.route(`${API_BASE}/api/v1/workspaces`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ workspaces: [workspace] })),
    });
  });

  await page.route(`${API_BASE}/api/v1/workspaces/${workspace.id}/pty/read**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ workspace, chunks: [], nextSequence: 0 })),
    });
  });

  await page.route(`${API_BASE}/api/v1/workspaces/${workspace.id}/pty/spawn`, async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        request_id: "req-e2e",
        error: {
          code: "FORBIDDEN",
          message: "workspace command requires operator or admin role: current host runtime writes require elevated role review",
          details: {
            workspace_id: workspace.id,
            workspace_kind: "current",
            risk_level: "write",
            policy_reason: "current host runtime writes require elevated role review",
            required_roles: ["operator", "admin"],
          },
        },
      }),
    });
  });

  await page.goto("/?widget=workbench");
  await expect(page.getByTestId("glass-widget-workbench")).toBeVisible();

  await page.getByTestId("workbench-workspace-command").fill("echo hi > /tmp/jarvis-e2e");
  await page.getByTestId("workbench-run-command").click();

  await expect(page.getByText("Current repository write or runtime commands require operator/admin access. Use an isolated worktree or devcontainer instead.")).toBeVisible();
  await expect(page.getByText("Try the isolated Git worktree or Docker devcontainer mode for member-safe write commands.")).toBeVisible();
  await expect(page.getByText("New Session")).toHaveCount(0);
});

test("mission dock supports focus switch and recommendation controls", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
    window.localStorage.setItem("jarvis.app.locale", "en");
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

  await installMissionDockMocks(page);

  await page.goto("/?mission=mission-1");

  const dock = page.getByRole("region", { name: "Context Dock" });
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("dock-step-status")).toHaveText("RUNNING");
  await expect(dock.getByTestId("dock-step-timeline")).toBeVisible();
  await expect(dock.getByTestId("dock-step-1")).toContainText("RUNNING");
  await expect(dock.getByTestId("dock-step-2")).toContainText("QUEUED");
  await expect(page.getByTestId("glass-widget-workbench")).toBeVisible();

  await dock.getByTestId("dock-widget-tasks").click();
  await expect(page.getByTestId("glass-widget-tasks")).toBeVisible();
  await expect(dock.getByTestId("dock-recommended-widget")).toBeVisible();
  await expect(dock.getByTestId("dock-auto-focus-hold")).toContainText(/manual hold/i);

  const autoFocusToggle = dock.getByTestId("dock-auto-focus-toggle");
  await autoFocusToggle.click();
  await expect(autoFocusToggle).toContainText(/auto focus off/i);
  await expect
    .poll(() =>
      page.evaluate(() => {
        return window.localStorage.getItem("jarvis.hud.mission.auto_focus");
      })
    )
    .toBe("0");

  await dock.getByTestId("dock-recommended-widget").click();
  await expect(page.getByTestId("glass-widget-workbench")).toBeVisible();
});

test("right panel prefers server jarvis sessions over browser-local hud sessions", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jarvis.auth.role", "admin");
    window.localStorage.setItem("jarvis.app.locale", "en");
    window.localStorage.setItem(
      "hud-sessions",
      JSON.stringify([
        {
          id: "local-session-only",
          prompt: "Local only HUD session",
          createdAt: "2026-03-07T00:00:00.000Z",
          activeWidgets: ["assistant"],
          mountedWidgets: ["assistant", "tasks"],
          focusedWidget: "assistant",
          workspacePreset: null,
          restoreMode: "full",
          lastWorkspacePreset: null,
          status: "active",
        },
      ]),
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

  await installAppApiMocks(page);
  await page.route(`${API_BASE}/api/v1/jarvis/sessions**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        envelope({
          sessions: [
            {
              id: "server-session-1",
              userId: "00000000-0000-4000-8000-000000000000",
              title: "Server-backed Jarvis Session",
              prompt: "Server-backed Jarvis Session",
              source: "jarvis_request",
              intent: "general",
              status: "running",
              workspacePreset: "jarvis",
              primaryTarget: "assistant",
              taskId: null,
              missionId: null,
              assistantContextId: null,
              councilRunId: null,
              executionRunId: null,
              briefingId: null,
              dossierId: null,
              createdAt: "2026-03-07T00:00:00.000Z",
              updatedAt: "2026-03-07T00:01:00.000Z",
              lastEventAt: "2026-03-07T00:01:00.000Z",
            },
          ],
        }),
      ),
    });
  });

  await page.goto("/");

  const sessionCards = page.locator('[data-testid^="session-card-"]');
  await expect(sessionCards).toHaveCount(1);
  await expect(sessionCards.first()).toContainText("Server-backed Jarvis Session");
  await expect(page.getByText("Local only HUD session")).toHaveCount(0);
});
