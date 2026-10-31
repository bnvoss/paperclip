import { createHash } from "node:crypto";
import { environments, type Db } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import { normalizeEnvironmentConfig } from "../environment-config.js";
import { CODEX_TRUSTED_SSH_MANAGEMENT_PERMISSION_PROFILE } from "../../vendor/paperclip-runner/index.js";

export { CODEX_TRUSTED_SSH_MANAGEMENT_PERMISSION_PROFILE };

/** Non-secret identity of the execution boundary, including its versioned policy. */
export function nativeExecutionTargetFingerprint(target?: AdapterExecutionTarget | null): string | null {
  if (!target || target.kind === "local" || target.transport !== "ssh") return null;
  const identity = {
    transport: "ssh",
    environmentId: target.environmentId ?? null,
    host: target.spec.host,
    port: target.spec.port ?? 22,
    username: target.spec.username,
    workspace: target.spec.remoteWorkspacePath,
    cwd: target.remoteCwd,
    strictHostKeyChecking: target.spec.strictHostKeyChecking !== false,
    // Bind the host pin without persisting its literal content or any key material.
    knownHostsDigest: createHash("sha256").update(target.spec.knownHosts ?? "").digest("hex"),
    permissionProfile: target.trustedManagement === true
      ? CODEX_TRUSTED_SSH_MANAGEMENT_PERMISSION_PROFILE : "paperclip-runner-workspace-only-v1",

  };
  return `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

/**
 * A serialized adapter/config flag is not authority. Only the saved selected
 * instance-admin SSH row can admit this native profile. Recheck before warm
 * reuse and again before constructing a backend; revocation fails closed.
 * This is launch authority, not cancellation of an already running process.
 */
export async function assertTrustedSshManagementAuthority(input: {
  db: Db;
  target?: AdapterExecutionTarget | null;
  nativeRunner: boolean;
  provider: string;
}): Promise<void> {
  const target = input.target;
  if (!target || target.kind !== "remote" || target.transport !== "ssh" || target.trustedManagement !== true) return;
  if (!input.nativeRunner || input.provider !== "codex" || !target.environmentId) {
    throw new Error("trusted_ssh_management_requires_native_codex_runner");
  }
  const saved = await input.db.select({ driver: environments.driver, status: environments.status, config: environments.config })
    .from(environments).where(eq(environments.id, target.environmentId)).limit(1).then(rows => rows[0]);
  if (!saved || saved.driver !== "ssh" || saved.status !== "active") {
    throw new Error("trusted_ssh_management_environment_unavailable");
  }
  const config = normalizeEnvironmentConfig({ driver: "ssh", config: saved.config });
  if (config.trustedManagement !== true) throw new Error("trusted_ssh_management_revoked");
  if (config.host !== target.spec.host || config.port !== (target.spec.port ?? 22)
    || config.username !== target.spec.username || config.remoteWorkspacePath !== target.spec.remoteWorkspacePath
    || config.knownHosts !== (target.spec.knownHosts ?? null)
    || config.strictHostKeyChecking !== (target.spec.strictHostKeyChecking !== false)) {
    throw new Error("trusted_ssh_management_environment_changed");
  }
}
