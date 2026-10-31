/** Actual native launch selectors, excluding model, methods and instruction content. */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function command(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function workspaceHooks(value: unknown) {
  const config = record(value);
  return { provisionCommand: command(config.provisionCommand),
    runtimeProvisionCommand: command(config.runtimeProvisionCommand),
    teardownCommand: command(config.teardownCommand) };
}
function runtimeHooks(value: unknown) {
  const config = record(value);
  return Object.fromEntries(["commands", "services", "jobs"].map(key => [key,
    Array.isArray(config[key]) ? config[key].map(entry => command(record(entry).command)).filter(value => value !== null) : []]));
}
export function trustedSshLaunchEffects(adapterType: string, adapterConfig: unknown) {
  const config = record(adapterConfig);
  const provider = adapterType === "paperclip_runner" ? config.provider ?? "codex" : null;
  return { adapterType, provider,
    permissionMode: provider === "codex" ? config.codexPermissionMode ?? "never" : null,
    workspaceHooks: workspaceHooks(config.workspaceStrategy) };
}
export function trustedSshLaunchEffectsChanged(beforeType: string, beforeConfig: unknown, afterType: string, afterConfig: unknown): boolean {
  return JSON.stringify(trustedSshLaunchEffects(beforeType, beforeConfig)) !== JSON.stringify(trustedSshLaunchEffects(afterType, afterConfig));
}
export function trustedSshTaskHasProtectedFields(issue: Record<string, unknown>): boolean {
  const config = record(record(issue.assigneeAdapterOverrides).adapterConfig);
  const settings = record(issue.executionWorkspaceSettings);
  return config.provider !== undefined || config.codexPermissionMode !== undefined
    || [config.workspaceStrategy, settings.workspaceStrategy].some(value => Object.values(workspaceHooks(value)).some(command => command !== null))
    || Object.values(runtimeHooks(settings.workspaceRuntime)).some(commands => (commands as unknown[]).some(command => command !== null));
}
export function trustedSshTaskLaunchEffects(adapterType: string, adapterConfig: unknown, issue: Record<string, unknown>) {
  const config = { ...record(adapterConfig), ...record(record(issue.assigneeAdapterOverrides).adapterConfig) };
  const settings = record(issue.executionWorkspaceSettings);
  return { launch: trustedSshLaunchEffects(adapterType, config),
    workspaceHooks: workspaceHooks(settings.workspaceStrategy), runtimeHooks: runtimeHooks(settings.workspaceRuntime) };
}
