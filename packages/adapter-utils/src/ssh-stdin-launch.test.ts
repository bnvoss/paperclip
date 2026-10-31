import { execFile, spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runChildProcess } from "./server-utils.js";
import {
  buildSshSpawnTarget,
  createSshCommandManagedRuntimeRunner,
  runSshCommand,
  shellQuote,
  type SshRemoteExecutionSpec,
} from "./ssh.js";

// No sshd, listener, credentials, provider, or network. The fake SSH executable
// records its argv and passes its real stdin fd to a real remote /bin/sh. The
// remote program records its own/parent process argv, env, and exact input to a
// private fixture file rather than emitting the synthetic secrets to run logs.
const roots: string[] = [];
const marker = "synthetic-secret-'\"-$(must-not-run)-λ\nsecond line\n\n";
const launchEnv = {
  PAPERCLIP_API_KEY: marker,
  PAPERCLIP_BRIDGE_TOKEN: `${marker}bridge`,
  EMPTY_VALUE: "",
};

afterEach(async () => {
  vi.unstubAllEnvs();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function fixture({ traceProfile = true, ambientEnvironment = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-ssh-stdin-"));
  roots.push(root);
  const record = path.join(root, "ssh.json");
  const outcome = path.join(root, "outcome.json");
  const inspector = path.join(root, "inspect.cjs");
  const systemPath = process.env.PATH ?? "/usr/bin:/bin";
  await writeFile(
    path.join(root, ".profile"),
    [
      "export PAPERCLIP_SYNTHETIC_PROFILE_READ=yes",
      // Profiles cannot consume the confidential header or the program's input.
      "read -r unused_profile_input || true",
      traceProfile ? "set -xv" : "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(root, "ssh"),
    `#!${process.execPath}
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const args = process.argv.slice(2);
const keyIndex = args.indexOf('-i');
const hosts = args.find(arg => arg.startsWith('UserKnownHostsFile='));
const files = [keyIndex < 0 ? null : args[keyIndex + 1], hosts?.split('=')[1]].filter(p => p && p !== '/dev/null');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({args,files:files.map(p => ({path:p,mode:fs.statSync(p).mode & 0o777,dirMode:fs.statSync(require('node:path').dirname(p)).mode & 0o777}))}),{mode:0o600});
if (process.env.PAPERCLIP_SYNTHETIC_SSH_FAIL === 'yes') process.exit(255);
${ambientEnvironment ? `fs.writeFileSync(${JSON.stringify(path.join(root, "outer-shell-started"))}, 'trusted account initialization happened before the controlled bootstrap');` : ""}
const child = spawn('/bin/sh', ['-c', args.at(-1)], {
  env:{PATH:${JSON.stringify(systemPath)},HOME:${JSON.stringify(root)},...${JSON.stringify(ambientEnvironment ? { OPENAI_API_KEY: "synthetic-ambient-openai", CODEX_API_KEY: "synthetic-ambient-codex", CODEX_HOME: root, PAPERCLIP_OUTER_SHELL_MARKER: "allowed-before-controlled-bootstrap" } : {})}},
  stdio:'inherit',
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', () => process.exit(254));
child.on('close', (code,signal) => {if(signal) {process.removeAllListeners('SIGTERM');process.kill(process.pid,signal);} else process.exit(code ?? 254);});
`,
    { mode: 0o700 },
  );
  await writeFile(
    inspector,
    `
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
let input = [];
const snapshot = () => ({
  pid:process.pid,
  argv:process.argv,
  processArgv:execFileSync('ps',['-o','pid=,ppid=,args=','-p',[process.pid,process.ppid].join(',')],{encoding:'utf8'}),
  env:Object.fromEntries(${JSON.stringify(["PAPERCLIP_API_KEY", "PAPERCLIP_BRIDGE_TOKEN", "EMPTY_VALUE", "PAPERCLIP_SYNTHETIC_PROFILE_READ", ...(ambientEnvironment ? ["HOME", "CODEX_HOME", "OPENAI_API_KEY", "CODEX_API_KEY", "PAPERCLIP_OUTER_SHELL_MARKER", "SSL_CERT_FILE"] : [])])}.map(k=>[k,process.env[k]])),
  input:Buffer.concat(input).toString('base64'),
});
process.stdin.on('data', chunk => input.push(chunk));
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(outcome)},JSON.stringify(snapshot()),{mode:0o600});
  if (process.argv[2] === 'split' || process.argv[2] === 'split-fail' || process.argv[2] === 'partial') {
    process.stdout.write(Buffer.from([0xce]));
    process.stderr.write(Buffer.from([0xe2]));
    if (process.argv[2] !== 'partial') {
      setTimeout(() => {
        process.stdout.write(Buffer.from([0xbb]));
        process.stderr.write(Buffer.from([0x82]));
        setTimeout(() => {
          process.stderr.write(Buffer.from([0xac]));
          process.exitCode = process.argv[2] === 'split-fail' ? 23 : 0;
        }, 30);
      }, 30);
    } else {
      process.stderr.write(Buffer.from([0x82]));
    }
    return;
  }
  process.stdout.write('ready\\n');
  process.stderr.write('diagnostic\\n');
  if(process.argv[2] === 'flood') process.stdout.write('x'.repeat(12000));
  if(process.argv[2] === 'hang') setInterval(()=>{},1000);
  else process.exitCode = Number(process.argv[2] ?? 0);
});
`,
    { mode: 0o600 },
  );
  vi.stubEnv("PATH", `${root}${path.delimiter}${systemPath}`);
  const spec: SshRemoteExecutionSpec = {
    host: "synthetic.invalid",
    port: 22,
    username: "synthetic-user",
    remoteWorkspacePath: root,
    remoteCwd: root,
    privateKey: "synthetic-private-key-not-a-real-key",
    knownHosts: "synthetic-host-key",
    strictHostKeyChecking: true,
  };
  return { root, record, outcome, inspector, spec };
}

async function executeTarget(
  target: Awaited<ReturnType<typeof buildSshSpawnTarget>>,
  stdin = target.transportStdin,
) {
  return await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(target.command, target.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.stdin.on("error", () => undefined);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

async function verify(
  f: Awaited<ReturnType<typeof fixture>>,
  input: string | undefined,
  logs: string,
) {
  const transport = JSON.parse(await readFile(f.record, "utf8"));
  const observed = JSON.parse(await readFile(f.outcome, "utf8"));
  expect(observed.env).toEqual({
    ...launchEnv,
    PAPERCLIP_SYNTHETIC_PROFILE_READ: "yes",
  });
  expect(observed.input).toBe(
    Buffer.from(input ?? "", "utf8").toString("base64"),
  );
  for (const projection of [
    JSON.stringify(transport.args),
    JSON.stringify(observed.argv),
    observed.processArgv,
    logs,
  ]) {
    expect(projection).not.toContain("synthetic-secret");
    expect(projection).not.toContain(Buffer.from(marker).toString("base64"));
  }
  expect(observed.processArgv).not.toContain("exec env ");
  expect((await readdir(f.root)).sort()).toEqual([
    ".profile",
    "inspect.cjs",
    "outcome.json",
    "ssh",
    "ssh.json",
  ]);
  return { transport, observed };
}

describe.skipIf(process.platform === "win32")(
  "SSH confidential environment stdin transport",
  () => {
    it.each(["spawn", "command"])("isolates the controlled trusted bootstrap through %s without claiming outer-shell isolation", async lane => {
      const f = await fixture({ ambientEnvironment: true });
      const env = { ...launchEnv, HOME: path.join(f.root, "role-home"), CODEX_HOME: path.join(f.root, "role-codex-home"), SSL_CERT_FILE: "/synthetic/projected-ca" };
      const spec = { ...f.spec, isolateEnvironment: true };
      const input = "trusted input\nwith exact EOF";
      const target = lane === "spawn" ? await buildSshSpawnTarget({ spec, command: process.execPath, args: [f.inspector], env, stdin: input }) : null;
      try {
        const result = target ? await executeTarget(target) : await runSshCommand(spec,
          `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)}`, { env, stdin: input });
        expect(result.stdout).toBe("ready\n");
        const observed = JSON.parse(await readFile(f.outcome, "utf8"));
        expect(observed.env).toEqual(env);
        expect(observed.input).toBe(Buffer.from(input).toString("base64"));
        expect(await readFile(path.join(f.root, "outer-shell-started"), "utf8")).toContain("before the controlled bootstrap");
        const transport = JSON.parse(await readFile(f.record, "utf8"));
        expect(transport.args.at(-1)).not.toContain("/etc/profile");
        expect(transport.args.at(-1)).not.toContain(".bashrc");
        for (const text of [JSON.stringify(transport.args), observed.processArgv, result.stdout + result.stderr]) {
          expect(text).not.toContain("synthetic-secret");
          expect(text).not.toContain(Buffer.from(marker).toString("base64"));
        }
      } finally { await target?.cleanup(); }
      for (const file of JSON.parse(await readFile(f.record, "utf8")).files) await expect(stat(file.path)).rejects.toThrow();
    });

    it("preserves an explicitly projected provider key in the isolated stdin channel", async () => {
      const f = await fixture({ ambientEnvironment: true });
      const projected = "synthetic-projected-provider-key";
      await runSshCommand({ ...f.spec, isolateEnvironment: true }, `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)}`,
        { env: { OPENAI_API_KEY: projected, HOME: "/synthetic/role-home", CODEX_HOME: "/synthetic/role-codex-home" } });
      const observed = JSON.parse(await readFile(f.outcome, "utf8"));
      expect(observed.env).toEqual({ OPENAI_API_KEY: projected, HOME: "/synthetic/role-home", CODEX_HOME: "/synthetic/role-codex-home" });
      expect(JSON.stringify(JSON.parse(await readFile(f.record, "utf8")).args)).not.toContain(projected);
    });

    it.each([
      undefined,
      "",
      "quotes '\"\nλ\0no final newline",
      "PAPERCLIP_SSH_ENV_END\n" + "long λ input\n".repeat(40_000),
    ])(
      "preserves program stdin and EOF through the actual shell (%#)",
      async (input) => {
        const f = await fixture();
        const target = await buildSshSpawnTarget({
          spec: f.spec,
          command: process.execPath,
          args: [f.inspector],
          env: launchEnv,
          stdin: input,
        });
        try {
          const result = await executeTarget(target);
          expect(result.code).toBe(0);
          expect(result.stdout).toBe("ready\n");
          const { transport } = await verify(
            f,
            input,
            result.stdout + result.stderr,
          );
          expect(JSON.stringify(transport.args)).not.toContain(
            target.transportStdin.split("\n")[0],
          );
          expect(transport.args).toEqual(
            expect.arrayContaining([
              "-F",
              "/dev/null",
              "IdentitiesOnly=yes",
              "IdentityAgent=none",
              "PreferredAuthentications=publickey",
              "ForwardAgent=no",
              "ForwardX11=no",
              "ClearAllForwardings=yes",
            ]),
          );
          for (const file of transport.files) {
            expect(file.mode).toBe(0o600);
            expect(file.dirMode).toBe(0o700);
          }
        } finally {
          await target.cleanup();
        }
        const { files } = JSON.parse(await readFile(f.record, "utf8"));
        for (const file of files)
          await expect(stat(file.path)).rejects.toThrow();
      },
    );

    it("uses the same safe channel for runSshCommand", async () => {
      const f = await fixture();
      const input = "command input\nwithout final newline";
      const result = await runSshCommand(
        f.spec,
        `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)}`,
        { env: launchEnv, stdin: input },
      );
      await verify(f, input, result.stdout + result.stderr);
      for (const file of JSON.parse(await readFile(f.record, "utf8")).files)
        await expect(stat(file.path)).rejects.toThrow();
    });

    it.each([undefined, 3])(
      "decodes split UTF-8 stdout/stderr while counting original bytes (limit: %s)",
      async (maxBuffer) => {
        const f = await fixture({ traceProfile: false });
        const result = await runSshCommand(
          f.spec,
          `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)} split`,
          { env: launchEnv, maxBuffer },
        );
        expect(result.stdout).toBe("λ");
        expect(result.stderr).toBe("€");
        await verify(f, undefined, result.stdout + result.stderr);
      },
    );

    it("flushes incomplete UTF-8 sequences on each stream at EOF", async () => {
      const f = await fixture({ traceProfile: false });
      const result = await runSshCommand(
        f.spec,
        `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)} partial`,
        { env: launchEnv, maxBuffer: 2 },
      );
      expect(result.stdout).toBe("�");
      expect(result.stderr).toBe("�");
    });

    it("retains decoded UTF-8 output on nonzero exit", async () => {
      const f = await fixture({ traceProfile: false });
      await expect(
        runSshCommand(
          f.spec,
          `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)} split-fail`,
          { env: launchEnv },
        ),
      ).rejects.toMatchObject({ code: 23, stdout: "λ", stderr: "€" });
    });

    it("rejects output when original stream bytes exceed the limit", async () => {
      const f = await fixture({ traceProfile: false });
      await expect(
        runSshCommand(
          f.spec,
          `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)} split`,
          { env: launchEnv, maxBuffer: 2 },
        ),
      ).rejects.toThrow("maxBuffer of 2 bytes");
      for (const file of JSON.parse(await readFile(f.record, "utf8")).files)
        await expect(stat(file.path)).rejects.toThrow();
    });

    it("delivers bridge control env through the command runner and preserves failure output/exit", async () => {
      const f = await fixture();
      const logs: string[] = [];
      const runner = createSshCommandManagedRuntimeRunner({ spec: f.spec });
      const result = await runner.execute({
        command: "sh",
        args: [
          "-c",
          `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)} 23`,
        ],
        env: launchEnv,
        stdin: "bridge input",
        onLog: async (_stream, line) => {
          logs.push(line);
        },
      });
      expect(result.exitCode).toBe(23);
      expect(result.timedOut).toBe(false);
      expect(result.stdout).toBe("ready\n");
      expect(result.stderr).toContain("diagnostic\n");
      await verify(f, "bridge input", logs.join(""));
    });

    it("preserves shell positional arguments used by remote runner launch and identity controls", async () => {
      const f = await fixture();
      const runner = createSshCommandManagedRuntimeRunner({ spec: f.spec });
      const result = await runner.execute({
        command: "sh",
        args: [
          "-c",
          'exec "$1" "$2" "$3"',
          "paperclip-runner-monitor",
          process.execPath,
          f.inspector,
          "23",
        ],
        env: launchEnv,
        stdin: "native control input",
      });
      expect(result.exitCode).toBe(23);
      await verify(f, "native control input", result.stdout + result.stderr);
    });

    it.each([undefined, "the original prompt\n"])(
      "keeps runChildProcess prompt metadata separate and streams normal program output (%#)",
      async (input) => {
        const f = await fixture();
        const logs: string[] = [];
        const options = {
          cwd: f.root,
          env: launchEnv,
          stdin: input,
          remoteExecution: f.spec,
          timeoutSec: 5,
          graceSec: 1,
          onLog: async (_stream: string, line: string) => {
            logs.push(line);
          },
        };
        const result = await runChildProcess(
          "synthetic-ssh-stdin",
          process.execPath,
          [f.inspector],
          options,
        );
        expect(result.exitCode).toBe(0);
        expect(options.stdin).toBe(input);
        await verify(f, options.stdin, logs.join(""));
      },
    );

    it("cleans explicit-key staging on SSH launch failure, including early stdin close", async () => {
      const f = await fixture();
      vi.stubEnv("PAPERCLIP_SYNTHETIC_SSH_FAIL", "yes");
      await expect(
        runSshCommand(f.spec, "exit 0", {
          env: launchEnv,
          stdin: "x".repeat(1024 * 1024),
        }),
      ).rejects.toMatchObject({ code: 255 });
      const record = JSON.parse(await readFile(f.record, "utf8"));
      for (const file of record.files)
        await expect(stat(file.path)).rejects.toThrow();
      await expect(stat(f.outcome)).rejects.toThrow();
    });

    it("fails closed on missing or invalid transport headers without launching the program", async () => {
      const f = await fixture();
      const target = await buildSshSpawnTarget({
        spec: f.spec,
        command: process.execPath,
        args: [f.inspector],
        env: launchEnv,
      });
      try {
        for (const stdin of ["", "invalid-base64!\n"]) {
          const result = await executeTarget(target, stdin);
          expect(result.code).toBe(125);
          expect(result.stderr).not.toContain("synthetic-secret");
          await expect(stat(f.outcome)).rejects.toThrow();
        }
      } finally {
        await target.cleanup();
      }
    });

    it("does not disable the declared ambient authentication mode when no key is configured", async () => {
      const f = await fixture();
      const target = await buildSshSpawnTarget({
        spec: { ...f.spec, privateKey: null },
        command: "true",
        args: [],
        env: {},
      });
      try {
        expect(target.args).not.toContain("IdentityAgent=none");
        expect(target.args).not.toContain("IdentitiesOnly=yes");
        expect(target.args).not.toContain("-F");
        expect(target.args).not.toContain("-i");
      } finally {
        await target.cleanup();
      }
    });

    it("resolves the explicit key and isolation settings with the real SSH client without connecting", async () => {
      const f = await fixture();
      const target = await buildSshSpawnTarget({
        spec: f.spec,
        command: "true",
        args: [],
        env: {},
      });
      try {
        const config = await new Promise<string>((resolve, reject) => {
          execFile("/usr/bin/ssh", ["-G", ...target.args], (error, stdout) =>
            error ? reject(error) : resolve(stdout),
          );
        });
        const settings = Object.fromEntries(
          config
            .trim()
            .split("\n")
            .map((line) => {
              const at = line.indexOf(" ");
              return [line.slice(0, at), line.slice(at + 1)];
            }),
        );
        const keyPath = target.args[target.args.indexOf("-i") + 1];
        expect(
          config.split("\n").filter((line) => line.startsWith("identityfile ")),
        ).toEqual([`identityfile ${keyPath}`]);
        expect(settings).toMatchObject({
          identitiesonly: "yes",
          identityagent: "none",
          preferredauthentications: "publickey",
          forwardagent: "no",
          forwardx11: "no",
          clearallforwardings: "yes",
        });
      } finally {
        await target.cleanup();
      }
    });

    it("rejects invalid env names and NUL values before creating authentication staging", async () => {
      const f = await fixture();
      const invalidEnvs: Record<string, string>[] = [
        { "BAD KEY": marker },
        { SAFE: `${marker}\0` },
      ];
      for (const env of invalidEnvs) {
        await expect(
          buildSshSpawnTarget({ spec: f.spec, command: "true", args: [], env }),
        ).rejects.toThrow(/SSH environment/);
        await expect(runSshCommand(f.spec, "true", { env })).rejects.toThrow(
          /SSH environment/,
        );
      }
      await expect(stat(f.record)).rejects.toThrow();
    });

    it("preserves timeout reporting and removes staged auth after the exercised child exits", async () => {
      const f = await fixture();
      await expect(
        runSshCommand(
          f.spec,
          `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)} hang`,
          { env: launchEnv, timeoutMs: 700 },
        ),
      ).rejects.toMatchObject({ killed: true });
      const observed = JSON.parse(await readFile(f.outcome, "utf8"));
      expect(() => process.kill(observed.pid, 0)).toThrow();
      for (const file of JSON.parse(await readFile(f.record, "utf8")).files)
        await expect(stat(file.path)).rejects.toThrow();
    });

    it("retains output-limit failure and cleans staging after the SSH child closes", async () => {
      const f = await fixture();
      await expect(
        runSshCommand(
          f.spec,
          `exec ${shellQuote(process.execPath)} ${shellQuote(f.inspector)} flood`,
          { env: launchEnv, maxBuffer: 10_000 },
        ),
      ).rejects.toThrow("maxBuffer");
      const observed = JSON.parse(await readFile(f.outcome, "utf8"));
      expect(() => process.kill(observed.pid, 0)).toThrow();
      for (const file of JSON.parse(await readFile(f.record, "utf8")).files)
        await expect(stat(file.path)).rejects.toThrow();
    });
  },
);
