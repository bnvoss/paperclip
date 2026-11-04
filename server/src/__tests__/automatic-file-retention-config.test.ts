import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.ts";

afterEach(() => vi.unstubAllEnvs());

describe("automatic file retention controls", () => {
  it("keeps the default enabled behavior", () => {
    vi.stubEnv("PAPERCLIP_RUNTIME_ASSET_RETENTION_ENABLED", undefined);
    vi.stubEnv("PAPERCLIP_PROVIDER_TRACE_RETENTION_WORKER_ENABLED", undefined);
    expect(loadConfig()).toMatchObject({
      runtimeAssetRetentionEnabled: true,
      providerTraceRetentionWorkerEnabled: true,
    });
  });

  it.each(["PAPERCLIP_RUNTIME_ASSET_RETENTION_ENABLED", "PAPERCLIP_PROVIDER_TRACE_RETENTION_WORKER_ENABLED"])(
    "disables only the requested worker with %s=false",
    (setting) => {
      vi.stubEnv("PAPERCLIP_RUNTIME_ASSET_RETENTION_ENABLED", undefined);
      vi.stubEnv("PAPERCLIP_PROVIDER_TRACE_RETENTION_WORKER_ENABLED", undefined);
      vi.stubEnv(setting, "false");
      vi.stubEnv("HEARTBEAT_SCHEDULER_ENABLED", "true");
      expect(loadConfig()).toMatchObject({
        runtimeAssetRetentionEnabled: setting !== "PAPERCLIP_RUNTIME_ASSET_RETENTION_ENABLED",
        providerTraceRetentionWorkerEnabled: setting !== "PAPERCLIP_PROVIDER_TRACE_RETENTION_WORKER_ENABLED",
        heartbeatSchedulerEnabled: true,
      });
    },
  );
});
