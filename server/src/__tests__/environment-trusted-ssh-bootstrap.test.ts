import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Environment } from "@paperclipai/shared";

const ssh = vi.hoisted(() => vi.fn(async () => ({ remoteCwd: "/synthetic/work" })));
const acquire = vi.hoisted(() => vi.fn(async () => ({ id: "synthetic-lease" })));
vi.mock("@paperclipai/adapter-utils/ssh", () => ({ ensureSshWorkspaceReady: ssh }));
vi.mock("../services/environments.js", () => ({ environmentService: () => ({ acquireLease: acquire }) }));

import { environmentRuntimeService } from "../services/environment-runtime.js";
import { probeEnvironment } from "../services/environment-probe.js";

beforeEach(() => { ssh.mockClear(); acquire.mockClear(); });

it.each([
  ["acquire", false], ["acquire", true], ["probe", false], ["probe", true],
] as const)("projects the saved trusted SSH flag before %s bootstrap (trusted=%s)", async (lane, trustedManagement) => {
  const environment: Environment = { id: "synthetic-environment", name: "Synthetic SSH", description: null,
    driver: "ssh", status: "active", envVars: {}, metadata: null, createdAt: new Date(), updatedAt: new Date(),
    config: { host: "synthetic.invalid", port: 22, username: "synthetic", remoteWorkspacePath: "/synthetic/work",
      privateKey: null, privateKeySecretRef: null, knownHosts: null, strictHostKeyChecking: true, trustedManagement } };
  const db = {} as Db;
  if (lane === "probe") {
    await expect(probeEnvironment(db, environment)).resolves.toMatchObject({ ok: true, driver: "ssh" });
    expect(acquire).not.toHaveBeenCalled();
  } else {
    const driver = environmentRuntimeService(db).getDriver("ssh")!;
    await expect(driver.acquireRunLease({ companyId: "synthetic-company", environment, agentId: null,
      issueId: null, heartbeatRunId: "synthetic-run", executionWorkspaceId: null, executionWorkspaceMode: null,
      executionWorkspaceSettings: null, adapterType: "paperclip_runner" })).resolves.toMatchObject({ id: "synthetic-lease" });
    expect(acquire).toHaveBeenCalledOnce();
  }
  expect(ssh).toHaveBeenCalledOnce();
  expect(ssh).toHaveBeenCalledWith(expect.objectContaining({ host: "synthetic.invalid", trustedManagement,
    isolateEnvironment: trustedManagement, privateKey: null }));
});
