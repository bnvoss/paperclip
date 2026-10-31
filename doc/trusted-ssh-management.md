# Trusted SSH management

An instance administrator can enable **Trusted host management** on an SSH
environment, or save `config.trustedManagement: true` through the existing
environment API. The default is `false`. The option is supported by
`paperclip_runner` with the native Codex app-server provider and approval policy
`never`. An unsupported adapter/provider fails before its provider is admitted.

The enabled environment grants host management to every role already bound to
it. Review the actual roles, instructions and task context when admitting that
environment. Codex uses the SSH account's filesystem and command privileges. An
account with unrestricted sudo or Docker control can manage the whole host.
This profile is a trust decision, not OS containment or isolation from peers.

## Authority and owner changes

The server resolves the selected saved environment, then re-reads its active SSH
row before trusted session reuse/backend construction and immediately before
launch. Host, port, username, workspace and host-key policy must still match.
Generic or legacy target parsing discards the trusted flag. Adapter configuration,
user environment variables, `externalSandbox`, and an expanded working directory
do not select the trusted profile. These reads are admission checks, not a
transactional revocation guarantee across concurrent operator edits.

Ordinary owner and consent methods remain available for instructions, methods,
skill selection, model/reasoning effort, normal runtime settings, and task
improvements. Tasks, comments, skills and instructions remain company-trusted
inputs that can influence what the privileged role does. This feature does not
establish actor or prompt isolation.

Instance-admin authority protects the SSH binding and environment configuration.
For an already trusted role, the extra guard compares effective changes to:

- `adapterType`, which selects the native or alternate execution adapter;
- `adapterConfig.provider`, which selects the actual native provider/driver;
- `adapterConfig.codexPermissionMode`, which selects the Codex approval policy;
- executable workspace hooks: `provisionCommand`, `runtimeProvisionCommand`,
  and `teardownCommand` in `adapterConfig.workspaceStrategy`.

The task API compares the same effective selectors after merging assignee
adapter overrides with the saved role configuration. It also protects changed
issue workspace hooks and command values in workspace runtime commands, services
and jobs. Merge, replacement, rollback and task assignment use the resulting
values; resubmitting unchanged selectors does not require a new grant. Existing
host-command and consent checks continue to apply. This is a protected-effect
comparison, not an allowlist for every harmless option.

## Profile and recovery

The distinct named profile is
`paperclip-runner-trusted-ssh-management-v1`. The controller passes a structured
trusted option to the TypeScript driver and Rust Runner; SSH does not claim to
be an external sandbox. Default Local and unadmitted SSH profiles remain the
workspace profile. The legacy external-sandbox environment marker is explicitly
`0` for Local/SSH and `1` only for an actual sandbox target, including when an
older compatible Runner is used for an ordinary confined run.

For SSH targets, a non-secret fingerprint binds the environment, transport identity, working
path, host-key policy and versioned effective profile into the warm checkpoint,
harness backup and immutable provider configuration. The controller overwrites
the Runner's launch fingerprint projection from its resolved target. Rust checks
that launch binding before a cold restore can reopen the old provider; the
TypeScript transport checks saved attachment templates before connecting to a
retained owner. The fingerprint is a compatibility fence, not a privilege grant.

A changed target, profile downgrade, revocation, or missing old fingerprint
cannot reuse the broader provider. Older SSH checkpoints/backups without the
binding are ineligible for reuse; preserve them for recovery and start a fresh
controlled session. Local and Sandbox checkpoint/backup digests retain their prior shapes. Legacy
confined Local provider state does not need the new optional fields.
The existing separately authorized cleanup path binds the exact retained
profile when stopping its owned work; it does not authorize a new task.

Revocation affects new admission and reuse. It does not stop already running
remote work. Use the existing owned Stop/cancellation path, then verify the
identified process and owned children exited. An SSH disconnect or client exit
alone is not that evidence.

## Build and configuration

Trusted admission requires Runner build metadata to advertise
`codexPermissionProfiles: ["paperclip-runner-trusted-ssh-management-v1"]`.
An old Runner missing this capability fails before provider admission. The
capability requirement is conditional: unchanged confined execution retains its
existing binary-contract compatibility.

Deploy the reviewed controller/server, embedded TypeScript driver and rebuilt
Rust `paperclip-runnerd` together. Rebuild the UI to expose/preserve the visible
setting. Build the Runner for the target operating system and architecture.
A local macOS synthetic fixture does not qualify a Linux deployment. This change
does not require a Codex CLI version upgrade; retain the existing supported and
separately qualified executable.

Runner URL, CA and artifact settings are controller service/process configuration,
not `actor.adapterConfig.env` settings:

- `PAPERCLIP_RUNNER_PUBLIC_URL` and `PAPERCLIP_RUNNER_CA_BUNDLE_PATH` affect remote
  transport selection. Local returns through its loopback branch; a provider's
  admitted ingress can take precedence for a sandbox.
- `PAPERCLIP_RUNNER_REMOTE_BINARY_PATH`, when set, is the **controller-local source
  file** whose exact bytes are staged to remote Runner targets, including
  sandboxes. Without it the existing build-owned locator/discovery path applies.
- `PAPERCLIP_RUNNER_REMOTE_CODEX_PATH` is likewise a controller-local source
  executable staged for remote Codex targets. It is not an account-local remote
  command path. It conflicts with `PAPERCLIP_RUNNER_REMOTE_CODEX_NPM_SPEC`.

These settings can affect other remote consumers. Any adoption must identify
those consumers, capture the actual prior values and artifacts, and retain their
rollback. Saving a source candidate, a schema pass, or a synthetic provider test
does not establish live SSH, TLS, credential, model, host-operation or recovery
success. Source delivery performs none of those live actions.

## Code rollback

An older controller does not enforce these new binding/profile guards. Before a
code downgrade, stop new admission to the added SSH environment, reconcile the
exact owned work and persistent host effects, deactivate its added bindings,
and revoke its dedicated host/bridge credentials. Pausing an actor or stopping
TLS alone is insufficient; credential revocation alone is not process-exit
proof. Preserve unrelated existing accounts, grants, recipients, Local defaults
and current data. Restore only the reviewed prior code/artifacts after those
new host authorities are removed; do not rely on new guards after downgrade or
overlay an older database to simulate rollback.
