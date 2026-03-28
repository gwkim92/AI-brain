import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext, type BrowserContext, type Download, type Page, type TestInfo } from "@playwright/test";

const BACKEND_BASE_URL = process.env.PLAYWRIGHT_BACKEND_BASE_URL ?? "http://127.0.0.1:4100";
const FRONTEND_HOST = "127.0.0.1";
const REVIEW_PACKET_DIR = process.env.HYPERAGENT_REVIEW_PACKET_DIR ?? null;

type LoginResponse = {
  data: {
    user: {
      id: string;
      role: string;
      email: string;
    };
    token: string;
  };
};

async function installAuthenticatedOperator(
  request: APIRequestContext,
  context: BrowserContext,
  page: Page,
): Promise<void> {
  const loginResponse = await request.post(`${BACKEND_BASE_URL}/api/v1/auth/login`, {
    data: {
      email: "admin@jarvis.local",
      password: "Admin!234567",
    },
  });
  expect(loginResponse.ok()).toBeTruthy();

  const loginBody = (await loginResponse.json()) as LoginResponse;
  const { token, user } = loginBody.data;

  await context.addCookies([
    {
      name: "jarvis_auth_token",
      value: token,
      domain: FRONTEND_HOST,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript(
    ({ role, userId, email }) => {
      window.localStorage.setItem("jarvis.auth.role", role);
      window.localStorage.setItem("jarvis.auth.user_id", userId);
      window.localStorage.setItem("jarvis.auth.email", email);
    },
    {
      role: user.role,
      userId: user.id,
      email: user.email,
    },
  );
}

async function persistReviewPacket(download: Download, testInfo: TestInfo): Promise<string> {
  const suggestedFilename = download.suggestedFilename();
  const attachmentPath = testInfo.outputPath(suggestedFilename);
  await download.saveAs(attachmentPath);
  await testInfo.attach("hyperagent-review-packet", {
    path: attachmentPath,
    contentType: "application/json",
  });
  if (REVIEW_PACKET_DIR) {
    await mkdir(REVIEW_PACKET_DIR, { recursive: true });
    await copyFile(attachmentPath, path.join(REVIEW_PACKET_DIR, suggestedFilename));
  }
  return suggestedFilename;
}

async function persistRuntimeState(runtimeBody: unknown, testInfo: TestInfo): Promise<void> {
  const serialized = JSON.stringify(runtimeBody, null, 2);
  await testInfo.attach("hyperagent-runtime-state", {
    body: Buffer.from(serialized, "utf8"),
    contentType: "application/json",
  });
  if (REVIEW_PACKET_DIR) {
    await mkdir(REVIEW_PACKET_DIR, { recursive: true });
    await writeFile(path.join(REVIEW_PACKET_DIR, "hyperagent-runtime-state.json"), serialized, "utf8");
  }
}

test("runs the live HyperAgent operator flow against the real backend", async ({ page, context, request }, testInfo) => {
  await installAuthenticatedOperator(request, context, page);

  await page.goto("/system/hyperagents");

  await expect(page.getByRole("heading", { name: "HyperAgents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate Candidate" })).toBeVisible();

  await page.getByRole("button", { name: "Generate Candidate" }).click();

  await expect(page.getByText(/candidate .* promotion 1\.000/u)).toBeVisible();

  const operatorNote = page.getByRole("textbox", { name: "Operator Note" });
  await operatorNote.fill("live integration e2e against the real backend");

  await page.getByRole("button", { name: "Accept", exact: true }).click();

  const applyButton = page.getByRole("button", { name: "Apply" });
  await expect(applyButton).toBeEnabled();

  await applyButton.click();

  await expect(page.getByRole("button", { name: /^Applied$/ })).toBeDisabled();
  await expect(
    page.getByText(/선택한 HyperAgent override를 runtime에 적용했다\.|Applied the selected HyperAgent override to runtime\./u),
  ).toBeVisible();
  await expect(
    page.getByText(/현재 runtime override로 적용 중|Currently applied as the runtime override/u),
  ).toBeVisible();
  await expect(page.getByText("Applied Payload JSON", { exact: true })).toBeVisible();
  await expect(page.getByText("Review Packet JSON", { exact: true })).toBeVisible();
  await expect(page.getByText("Lineage JSON", { exact: true })).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: '"artifactKey": "world_model_dossier_config"' }).first(),
  ).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: '"edgeType": "applied"' }).first(),
  ).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: '"operator_note": "live integration e2e against the real backend"' }).first(),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Review Packet" }).click();
  const download = await downloadPromise;
  const reviewPacketFilename = await persistReviewPacket(download, testInfo);
  expect(reviewPacketFilename).toMatch(/^hyperagent-review-packet-.*-applied\.json$/);

  const runtimeResponse = await request.get(`${BACKEND_BASE_URL}/api/v2/hyperagents/runtime`, {
    headers: {
      Authorization: `Bearer ${(await context.cookies()).find((cookie) => cookie.name === "jarvis_auth_token")?.value ?? ""}`,
    },
  });
  expect(runtimeResponse.ok()).toBeTruthy();
  const runtimeBody = (await runtimeResponse.json()) as {
    data: {
      applied_overrides: Array<{ artifactKey: string }>;
    };
  };
  expect(runtimeBody.data.applied_overrides).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        artifactKey: "world_model_dossier_config",
      }),
    ]),
  );
  await persistRuntimeState(runtimeBody, testInfo);
});
