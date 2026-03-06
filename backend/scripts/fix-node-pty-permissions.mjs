import { chmodSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(import.meta.dirname, "..");
const prebuildsDir = path.join(backendRoot, "node_modules", "node-pty", "prebuilds");

if (!existsSync(prebuildsDir)) {
  process.exit(0);
}

for (const entry of readdirSync(prebuildsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const helperPath = path.join(prebuildsDir, entry.name, "spawn-helper");
  if (!existsSync(helperPath)) continue;
  try {
    chmodSync(helperPath, 0o755);
    console.log(`[fix-node-pty-permissions] chmod +x ${helperPath}`);
  } catch (error) {
    console.warn(
      `[fix-node-pty-permissions] failed to chmod ${helperPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
