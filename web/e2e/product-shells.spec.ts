import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";
const NOW = "2026-03-14T10:00:00.000Z";

function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    request_id: "req-product-shells",
    data,
    meta,
  };
}

async function installAuth(page: Page, context: BrowserContext, role: "member" | "operator" | "admin") {
  await page.addInitScript((seedRole) => {
    window.localStorage.setItem("jarvis.auth.role", seedRole);
    window.localStorage.setItem("jarvis.auth.token", "e2e-token");
  }, role);

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
}

async function installProductShellMocks(page: Page, role: "member" | "operator" | "admin") {
  let approvalDecision: "pending" | "approved" | "rejected" = "pending";

  await page.route(`${API_BASE}/api/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path === "/api/v1/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            id: "user-1",
            email: "user@example.com",
            role,
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/tasks" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope([
            {
              id: "task-running",
              title: "Review AI launch timeline",
              mode: "research",
              status: "running",
              input: { prompt: "Review AI launch timeline" },
              traceId: "trace-running",
              createdAt: NOW,
              updatedAt: NOW,
            },
            {
              id: "task-done",
              title: "Summarize policy memo",
              mode: "research",
              status: "done",
              input: { prompt: "Summarize policy memo" },
              traceId: "trace-done",
              createdAt: NOW,
              updatedAt: NOW,
            },
          ]),
        ),
      });
      return;
    }

    if (path === "/api/v1/tasks/task-new" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            id: "task-new",
            title: "Launch request task",
            mode: "research",
            status: "queued",
            input: { prompt: "Launch request task" },
            traceId: "trace-task-new",
            createdAt: NOW,
            updatedAt: NOW,
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/tasks/task-new/events") {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
        body: "event: stream.open\ndata: {}\n\nevent: stream.close\ndata: {}\n\n",
      });
      return;
    }

    if (path === "/api/v1/jarvis/sessions" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            sessions: [
              {
                id: "session-1",
                title: "Need approval for external run",
                status: approvalDecision === "pending" ? "needs_approval" : "queued",
                primaryTarget: "workspace_command",
                taskId: "task-running",
                workspacePreset: null,
                createdAt: NOW,
                updatedAt: NOW,
              },
              {
                id: "session-3",
                title: "Blocked research session needs review",
                status: "blocked",
                primaryTarget: "research",
                taskId: "task-running",
                workspacePreset: null,
                createdAt: NOW,
                updatedAt: NOW,
              },
              {
                id: "session-2",
                title: "Running research session",
                status: "running",
                primaryTarget: "research",
                taskId: "task-running",
                workspacePreset: null,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/jarvis/sessions/session-1" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: {
              id: "session-1",
              title: "Need approval for external run",
              prompt: "Run the approved external workflow",
              source: "user",
              intent: "general",
              status: approvalDecision === "pending" ? "needs_approval" : "queued",
              workspacePreset: null,
              primaryTarget: "workspace_command",
              taskId: "task-running",
              missionId: null,
              assistantContextId: null,
              councilRunId: null,
              executionRunId: null,
              briefingId: null,
              dossierId: null,
              createdAt: NOW,
              updatedAt: NOW,
              lastEventAt: NOW,
            },
            requested_capabilities: ["approve", "execute"],
            active_capabilities: approvalDecision === "pending" ? ["approve"] : ["execute"],
            completed_capabilities: [],
            stages: [],
            next_action: approvalDecision === "pending" ? { kind: "open_action_center", label: "Review approval" } : { kind: "open_workbench", label: "Open workbench" },
            research_profile: null,
            research_profile_reasons: [],
            quality_mode: null,
            warning_codes: [],
            format_hint: null,
            quality_dimensions: null,
            memory_context: null,
            memory_plan_signals: [],
            memory_plan_summary: [],
            memory_preference_summary: [],
            memory_preference_applied: [],
            memory_influences: [],
            execution_option: null,
            preferred_provider_applied: null,
            preferred_model_applied: null,
            project_context_refs: null,
            monitoring_preference_applied: null,
            events: [],
            actions:
              approvalDecision === "pending"
                ? [
                    {
                      id: "action-1",
                      userId: "user-1",
                      sessionId: "session-1",
                      kind: "workspace_prepare",
                      title: "Approve external run",
                      summary: "This run needs human approval before execution.",
                      status: "pending",
                      payload: {},
                      createdAt: NOW,
                      updatedAt: NOW,
                      decidedAt: null,
                      decidedBy: null,
                    },
                  ]
                : [],
            briefing: null,
            dossier: null,
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/jarvis/sessions/session-3" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: {
              id: "session-3",
              title: "Blocked research session needs review",
              prompt: "Review the blocked research output",
              source: "user",
              intent: "research",
              status: "blocked",
              workspacePreset: null,
              primaryTarget: "research",
              taskId: "task-running",
              missionId: null,
              assistantContextId: null,
              councilRunId: null,
              executionRunId: null,
              briefingId: null,
              dossierId: null,
              createdAt: NOW,
              updatedAt: NOW,
              lastEventAt: NOW,
            },
            requested_capabilities: ["research"],
            active_capabilities: [],
            completed_capabilities: ["research"],
            stages: [],
            next_action: { kind: "open_brief", label: "Open brief" },
            research_profile: null,
            research_profile_reasons: [],
            quality_mode: null,
            warning_codes: [],
            format_hint: null,
            quality_dimensions: null,
            memory_context: null,
            memory_plan_signals: [],
            memory_plan_summary: [],
            memory_preference_summary: [],
            memory_preference_applied: [],
            memory_influences: [],
            execution_option: null,
            preferred_provider_applied: null,
            preferred_model_applied: null,
            project_context_refs: null,
            monitoring_preference_applied: null,
            events: [],
            actions: [],
            briefing: null,
            dossier: null,
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/jarvis/sessions/session-1/actions/action-1/approve" && method === "POST") {
      approvalDecision = "approved";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: {
              id: "session-1",
              title: "Need approval for external run",
              status: "queued",
              primaryTarget: "workspace_command",
              taskId: "task-running",
              workspacePreset: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
            action: {
              id: "action-1",
              status: "approved",
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/jarvis/sessions/session-1/actions/action-1/reject" && method === "POST") {
      approvalDecision = "rejected";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: {
              id: "session-1",
              title: "Need approval for external run",
              status: "blocked",
              primaryTarget: "workspace_command",
              taskId: "task-running",
              workspacePreset: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
            action: {
              id: "action-1",
              status: "rejected",
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/jarvis/requests" && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            session: {
              id: "session-new",
              title: "Launch request session",
              status: "queued",
              primaryTarget: "research",
              taskId: "task-new",
              workspacePreset: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
            requested_capabilities: ["research"],
            active_capabilities: ["research"],
            completed_capabilities: [],
            stages: [],
            next_action: { type: "wait" },
            research_profile: null,
            research_profile_reasons: [],
            quality_mode: null,
            warning_codes: [],
            format_hint: null,
            quality_dimensions: null,
            memory_context: null,
            memory_plan_signals: [],
            memory_plan_summary: [],
            memory_preference_summary: [],
            memory_preference_applied: [],
            memory_influences: [],
            execution_option: null,
            preferred_provider_applied: null,
            preferred_model_applied: null,
            project_context_refs: null,
            monitoring_preference_applied: null,
            delegation: {
              intent: "research",
              complexity: "moderate",
              primary_target: "research",
              capabilities: ["research"],
              task_id: "task-new",
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/upgrades/proposals") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            proposals:
              role === "member"
                ? []
                : [
                    {
                      id: "proposal-1",
                      proposalTitle: "Promote critical operator workflow",
                      status: "proposed",
                      approvedAt: null,
                      createdAt: NOW,
                    },
                  ],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/memory/snapshot") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            generated_at: NOW,
            rows: [],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/sources") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            workspaces: [],
            sources: [
              {
                id: "source-1",
                workspaceId: "ws-1",
                name: "Official Feed",
                kind: "rss",
                url: "https://example.com/rss",
                sourceType: "policy",
                sourceTier: "tier_0",
                pollMinutes: 15,
                enabled: true,
                parserConfigJson: {},
                crawlConfigJson: {},
                crawlPolicy: {
                  allowDomains: [],
                  denyDomains: [],
                  respectRobots: true,
                  maxDepth: 1,
                  maxPagesPerRun: 20,
                  revisitCooldownMinutes: 60,
                  perDomainRateLimitPerMinute: 12,
                },
                health: {
                  lastStatus: "ok",
                  lastSuccessAt: NOW,
                  lastFailureAt: null,
                  consecutiveFailures: 0,
                  recentLatencyMs: 180,
                  status403Count: 0,
                  status429Count: 0,
                  robotsBlocked: false,
                  lastFailureReason: null,
                  updatedAt: NOW,
                },
                connectorCapability: null,
                entityHints: [],
                metricHints: [],
                lastFetchedAt: NOW,
                lastSuccessAt: NOW,
                lastError: null,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
            scanner_worker: {
              enabled: true,
              inflight: false,
              lastRun: null,
              history: [],
            },
            semantic_worker: {
              enabled: true,
              inflight: false,
              lastRun: null,
              history: [],
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/runs") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            runs: [
              {
                id: "run-1",
                workspaceId: "ws-1",
                sourceId: null,
                status: "ok",
                fetchedCount: 10,
                storedDocumentCount: 5,
                signalCount: 4,
                clusteredEventCount: 2,
                executionCount: 1,
                failedCount: 0,
                error: null,
                detailJson: {},
                startedAt: NOW,
                finishedAt: NOW,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
            scanner_worker: {
              enabled: true,
              inflight: false,
              lastRun: null,
              history: [],
            },
            semantic_worker: {
              enabled: true,
              inflight: false,
              lastRun: null,
              history: [],
            },
            stale_maintenance_worker: {
              enabled: true,
              inflight: false,
              lastRun: null,
              history: [],
            },
            model_sync_worker: {
              enabled: true,
              inflight: false,
              lastRun: null,
              history: [],
            },
            semantic_backlog: {
              pendingCount: 7,
              processingCount: 0,
              failedCount: 0,
              latestFailedSignalIds: [],
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/runtime/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            models: [
              {
                id: "model-1",
                provider: "openai",
                modelId: "gpt-5.4",
                availability: "active",
                contextWindow: 128000,
                supportsStructuredOutput: true,
                supportsToolUse: true,
                supportsLongContext: true,
                supportsReasoning: true,
                costClass: "premium",
                latencyClass: "balanced",
                lastSeenAt: NOW,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
            provider_health: [],
            sync_worker: {
              enabled: true,
              inflight: false,
              lastRun: null,
              history: [],
            },
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/fetch-failures") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            fetch_failures: [
              {
                id: "failure-1",
                workspaceId: "ws-1",
                sourceId: "source-1",
                url: "https://example.com/feed/item",
                reason: "HTTP_500",
                statusCode: 500,
                retryable: true,
                blockedByRobots: false,
                createdAt: NOW,
              },
            ],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/maintenance/stale-events") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            stale_events: [
              {
                eventId: "event-1",
                title: "Quarantine edge case event",
                topDomainId: "policy_regulation_platform_ai",
                staleScore: 13,
                reasons: ["generic_predicate_ratio"],
                linkedClaimCount: 1,
                genericPredicateRatio: 1,
                nonSocialCorroborationCount: 0,
                edgeCount: 0,
                graphSupportScore: 0,
                graphContradictionScore: 0,
                linkedClaimHealthScore: 0,
                updatedAt: NOW,
              },
            ],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/intelligence/quarantine") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            workspace_id: "ws-1",
            quarantined_signals: [
              {
                signal_id: "signal-1",
                document_id: "doc-1",
                title: "Forum post with weak evidence",
                url: "https://example.com/forum/1",
                source_type: "forum",
                source_tier: "tier_3",
                reasons: ["generic_claim_only"],
                created_at: NOW,
                processed_at: NOW,
              },
            ],
            provisional_events: [
              {
                event_id: "prov-1",
                title: "Search result needs corroboration",
                summary: "Needs non-social corroboration before promotion.",
                signal_count: 1,
                document_count: 1,
                non_social_corroboration_count: 0,
                reasons: ["non_social_corroboration_missing"],
                updated_at: NOW,
              },
            ],
            identity_collisions: [
              {
                document_identity_key: "canonical:https://example.com/x",
                count: 2,
                titles: ["Title A", "Title B"],
                canonical_urls: ["https://example.com/x"],
              },
            ],
          }),
        ),
      });
      return;
    }

    if (path === "/api/v1/providers" || path === "/api/v1/providers/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope({ providers: [] })),
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

test("root renders user home and composer routes deterministically to task detail", async ({ page, context }) => {
  await installAuth(page, context, "member");
  await installProductShellMocks(page, "member");

  await page.goto("/");

  await expect(page.getByText(/Start from what needs your attention now|지금 봐야 할 일부터 바로 시작한다/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Approvals" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Memory" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Action Center")).toHaveCount(0);
  await expect(page.getByText("Model Control")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);

  const input = page.getByPlaceholder(/Describe the work you want Jarvis to start|지금 필요한 작업을 한 줄로 적어라/);
  await input.fill("Launch request task");
  await page.getByRole("button", { name: /Start|시작/ }).click();

  await expect(page).toHaveURL(/\/tasks\/task-new$/);
  await expect(page.getByText("Launch request task", { exact: true }).first()).toBeVisible();
});

test("legacy root widget urls canonicalize into studio", async ({ page, context }) => {
  await installAuth(page, context, "admin");
  await installProductShellMocks(page, "admin");

  await page.goto("/?widget=inbox&focus=inbox");

  await expect(page).toHaveURL(/\/studio\?widget=inbox&focus=inbox$/);
});

test("system routes use the dedicated system shell and system-only navigation", async ({ page, context }) => {
  await installAuth(page, context, "admin");
  await installProductShellMocks(page, "admin");

  await page.goto("/system/runtime");

  await expect(page.locator("header").getByRole("heading", { name: "System Control" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Runtime" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sources & Failures" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Models & Controls" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Maintenance" })).toBeVisible();
  await expect(page.getByText(/Keep operator review and system control separate|운영자 검토와 시스템 관제를 분리한다/)).toBeVisible();
  await expect(page.getByText("Tasks")).toHaveCount(0);
  await expect(page.getByText("Approvals")).toHaveCount(0);
});

test("approvals separates actionable approvals from review-only blocked sessions", async ({ page, context }) => {
  await installAuth(page, context, "member");
  await installProductShellMocks(page, "member");

  await page.goto("/approvals");

  await expect(page.getByText(/바로 승인 가능한 세션|Ready-to-decide sessions/)).toBeVisible();
  await expect(page.getByText(/검토가 필요한 세션|Review-needed sessions/)).toBeVisible();
  await expect(page.getByText("Approve external run")).toBeVisible();
  await expect(page.getByRole("link", { name: /작업 상세 열기|Open task detail/ }).first()).toBeVisible();

  await page.getByRole("button", { name: /승인|Approve/ }).first().click();

  await expect(page.getByText("Approve external run")).toHaveCount(0);
  await expect(page.getByText("Need approval for external run")).toHaveCount(0);
  await expect(page.getByText("Blocked research session needs review")).toBeVisible();
});
