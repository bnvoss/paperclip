import { describe, expect, it, vi } from "vitest";
import { parseAdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import { assertTrustedSshManagementAuthority, nativeExecutionTargetFingerprint } from "./trusted-ssh-management.js";

const config = { host: "ssh.example.test", port: 22, username: "operator", remoteWorkspacePath: "/srv/workspace", knownHosts: "ssh.example.test ssh-ed25519 SYNTHETIC", strictHostKeyChecking: true, trustedManagement: true };
const target = { kind: "remote" as const, transport: "ssh" as const, environmentId: "env-1", trustedManagement: true,
  remoteCwd: "/srv/workspace", spec: { ...config, privateKey: null, remoteCwd: "/srv/workspace" } };
function database(saved: unknown) {
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => saved ? [saved] : [] }) }) }));
  return { db: { select } as never, select };
}

describe("trusted SSH authority", () => {
  it("requires the current saved active SSH row and matching transport identity", async () => {
    const { db, select } = database({ driver: "ssh", status: "active", config });
    await expect(assertTrustedSshManagementAuthority({ db, target, nativeRunner: true, provider: "codex" })).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledOnce();
  });
  it.each<[unknown, string]>([
    [null, "unavailable"],
    [{ driver: "local", status: "active", config }, "unavailable"],
    [{ driver: "ssh", status: "archived", config }, "unavailable"],
    [{ driver: "ssh", status: "active", config: { ...config, trustedManagement: false } }, "revoked"],
    ...["host", "port", "username", "remoteWorkspacePath", "knownHosts", "strictHostKeyChecking"].map((key): [unknown, string] => [{ driver: "ssh", status: "active", config: { ...config, [key]: key === "port" ? 2222 : key === "strictHostKeyChecking" ? false : "changed" } }, key === "remoteWorkspacePath" ? "absolute" : "changed"]),
  ])("fails before launch for a revoked or changed row (%j)", async (saved, error) => {
    const { db } = database(saved);
    await expect(assertTrustedSshManagementAuthority({ db, target, nativeRunner: true, provider: "codex" })).rejects.toThrow(String(error));
  });
  it.each([[false, "codex"], [true, "opencode"], [true, "acpx"]])("rejects unsupported native/provider combinations", async (nativeRunner, provider) => {
    const { db, select } = database(null);
    await expect(assertTrustedSshManagementAuthority({ db, target, nativeRunner: Boolean(nativeRunner), provider: String(provider) })).rejects.toThrow("requires_native_codex");
    expect(select).not.toHaveBeenCalled();
  });
  it("discards authority in generic target parsing and keeps ordinary paths confined", async () => {
    const parsed = parseAdapterExecutionTarget(target);
    expect(parsed).not.toHaveProperty("trustedManagement");
    const { db, select } = database(null);
    await assertTrustedSshManagementAuthority({ db, target: parsed, nativeRunner: true, provider: "codex" });
    await assertTrustedSshManagementAuthority({ db, target: { kind: "local" }, nativeRunner: true, provider: "codex" });
    expect(select).not.toHaveBeenCalled();
  });
  it("binds target and permission changes but excludes secret material and lease rotation", () => {
    const fingerprint = nativeExecutionTargetFingerprint(target);
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const changed of [
      { ...target, trustedManagement: false }, { ...target, environmentId: "env-2" },
      { ...target, remoteCwd: "/elsewhere" }, { ...target, spec: { ...target.spec, host: "elsewhere" } },
      { kind: "remote" as const, transport: "sandbox" as const, remoteCwd: target.remoteCwd },
      { kind: "local" as const },
    ]) expect(nativeExecutionTargetFingerprint(changed)).not.toBe(fingerprint);
    expect(nativeExecutionTargetFingerprint({ ...target, leaseId: "new-lease", spec: { ...target.spec, privateKey: "synthetic-secret" } })).toBe(fingerprint);
  });

});
