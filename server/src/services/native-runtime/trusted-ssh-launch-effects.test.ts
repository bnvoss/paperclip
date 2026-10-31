import { describe, expect, it } from "vitest";
import { trustedSshLaunchEffectsChanged, trustedSshTaskLaunchEffects, trustedSshTaskHasProtectedFields } from "./trusted-ssh-launch-effects.js";
const config = { provider: "codex", codexPermissionMode: "never", model: "old" };
describe("trusted SSH effective launch changes", () => {
  it("preserves ordinary methods, model/effort, skills and runtime configuration", () => {
    for (const patch of [{ model: "new", modelReasoningEffort: "max" }, { instructionsFilePath: "/methods/AGENTS.md" }, { promptTemplate: "improved" }, { command: "/ignored-by-native-runner", args: ["ignored"] }, { env: { NORMAL_SETTING: "changed" } }]) {
      expect(trustedSshLaunchEffectsChanged("paperclip_runner", config, "paperclip_runner", { ...config, ...patch })).toBe(false);
    }
    expect(trustedSshLaunchEffectsChanged("paperclip_runner", {}, "paperclip_runner", config)).toBe(false);
  });
  it("detects only actual provider, permission, adapter and executable-hook effects", () => {
    expect(trustedSshLaunchEffectsChanged("paperclip_runner", config, "codex_local", config)).toBe(true);
    for (const patch of [{ provider: "opencode" }, { codexPermissionMode: "on-request" }, { workspaceStrategy: { type: "git_worktree", runtimeProvisionCommand: "printf changed" } }]) {
      expect(trustedSshLaunchEffectsChanged("paperclip_runner", config, "paperclip_runner", { ...config, ...patch })).toBe(true);
    }
    const hooks = { ...config, workspaceStrategy: { runtimeProvisionCommand: "printf retained" } };
    expect(trustedSshLaunchEffectsChanged("paperclip_runner", hooks, "paperclip_runner", { ...hooks, model: "new" })).toBe(false);
    expect(trustedSshLaunchEffectsChanged("paperclip_runner", hooks, "paperclip_runner", config)).toBe(true);
  });
  it("compares task overrides after merging them with the protected saved configuration", () => {
    const before = { assigneeAdapterOverrides: { adapterConfig: { provider: "codex", model: "old" } } };
    const ordinary = { assigneeAdapterOverrides: { adapterConfig: { model: "new", modelReasoningEffort: "max" } } };
    expect(trustedSshTaskHasProtectedFields(ordinary)).toBe(false);
    expect(trustedSshTaskLaunchEffects("paperclip_runner", config, before)).toEqual(trustedSshTaskLaunchEffects("paperclip_runner", config, ordinary));
    expect(trustedSshTaskLaunchEffects("paperclip_runner", config, { assigneeAdapterOverrides: { adapterConfig: { provider: "opencode" } } })).not.toEqual(trustedSshTaskLaunchEffects("paperclip_runner", config, before));
    const commands = { executionWorkspaceSettings: { workspaceRuntime: { jobs: [{ command: "printf changed" }] } } };
    expect(trustedSshTaskHasProtectedFields(commands)).toBe(true);
    expect(trustedSshTaskLaunchEffects("paperclip_runner", config, commands)).not.toEqual(trustedSshTaskLaunchEffects("paperclip_runner", config, before));
  });
});
