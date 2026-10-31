import { describe, expect, it, vi } from "vitest";
import { environments, type Db } from "@paperclipai/db";
import { environmentService } from "../services/environments.js";
import { resolveExecutionWorkspaceEnvironmentId } from "../services/execution-workspace-policy.js";

describe("environment creation and execution defaults", () => {
  it.each(["local-environment", null])("creating SSH preserves the Local row and instance default (%s)", async (instanceDefaultEnvironmentId) => {
    const local = { id: "local-environment", name: "Local", driver: "local", config: {} };
    const rows: Array<Record<string, unknown>> = [local];
    const update = vi.fn(() => { throw new Error("Environment creation must not change an existing default or row"); });
    const insert = vi.fn((table) => ({
      values: (input: Record<string, unknown>) => ({
        returning: async () => {
          expect(table).toBe(environments);
          const row = { ...input, id: "new-ssh-environment" };
          rows.push(row);
          return [row];
        },
      }),
    }));
    const service = environmentService({ insert, update } as unknown as Db);
    const created = await service.create({ name: "Synthetic SSH", driver: "ssh", config: {} });
    expect(created.id).toBe("new-ssh-environment");
    expect(update).not.toHaveBeenCalled();
    expect(rows[0]).toEqual(local);
    expect(rows).toHaveLength(2);
    expect(resolveExecutionWorkspaceEnvironmentId({
      agentDefaultEnvironmentId: null,
      instanceDefaultEnvironmentId,
      localDefaultEnvironmentId: local.id,
    })).toEqual({ environmentId: local.id, source: instanceDefaultEnvironmentId ? "instance" : "default" });
  });
});
