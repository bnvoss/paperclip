import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QUALIFIED_ACPX_PROFILE_DATA } from "./generated-profiles.js";
import { isSupportedAcpxProfileVersion } from "./profile-compatibility.js";

describe("historical ACPX profile decoding", () => {
  it.each([
    ["copilot", "copilot-profile-v88-identity.json", "81e5fbccf057c04e012f638dc7a02c5758bf6ca67f7c4ed0045f3f61525401c2", "published cd5"],
    ["copilot", "copilot-profile-v88-cursor-cloud-qualification-historical-identity.json", "6010dc772d914afec7dd31f35f953ce74b65ab3a648ce54aaee559f908b492f9", "private Cloud qualification"],
    ["grok", "grok-profile-v15-identity.json", "54f7063c82dc5b135a9b5e2b0d8653b5c839a42bbc3a845dbcfb6cd225fa623f", "published cd5"],
    ["grok", "grok-profile-v15-cursor-cloud-qualification-historical-identity.json", "f5d4b41284d60413575f88371e66e940942c256d8b6d9619104deaee181054b2", "private Cloud qualification"],
    ["copilot", "copilot-profile-v86-identity.json", "6baeb98adc7132b2afdce8b1d2da1df2f00356677eb4497c49c05aa9def79138", "published a8"],
    ["copilot", "copilot-profile-v86-cursor-cloud-qualification-historical-identity.json", "118a4b0a782b56570e5530cca91255da8932c31f827c319b40a5810bd4d446e9", "private Cloud qualification"],
    ["copilot", "copilot-profile-v87-identity.json", "505bb72a933d11e3f5aa8a1700d239c06b4d34bb83d5187470483812df996501", "published a8"],
    ["copilot", "copilot-profile-v87-cursor-cloud-qualification-historical-identity.json", "ce9912c34ae9126e74061f7bc170b59589af7cb6ab26751e250da9e9dd9553c9", "private Cloud qualification"],
    ["copilot", "copilot-profile-v85-identity.json", "15d2790d94d7cc46ac728119ed9b4d07ed2b682be039b3debc716600708d8c1a", "published ed8"],
    ["copilot", "copilot-profile-v85-cursor-cloud-qualification-historical-identity.json", "977d68b327f3964e8337ef8ba00230eb1b1697017db21f8010f664fee3d3c70a", "private Cloud qualification"],
    ["grok", "grok-profile-v14-identity.json", "08294ec6bdcbdbe46c8c8b711d8b368558a05f0d84d25c9f5fd0c3b67b79cd17", "published ed8"],
    ["grok", "grok-profile-v14-cursor-cloud-qualification-historical-identity.json", "fa34ba395ff51affed7e7195dc44f4e33a3c6718ada1c80e8e36852cf7af40ac", "private Cloud qualification"],
  ] as const)("keeps %s identity %s immutable and decode-only", (agent, filename, checksum) => {
    const bytes = readFileSync(new URL(`../../../test/fixtures/${filename}`, import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(checksum);
    const identity = JSON.parse(bytes.toString("utf8"));
    expect(isSupportedAcpxProfileVersion(agent, identity.declaration.agentProfileVersion)).toBe(true);
    expect(identity.commandDigest).not.toBe(QUALIFIED_ACPX_PROFILE_DATA[agent].commandDigest);
  });

  it("retains each provider's existing revision boundary", () => {
    expect(isSupportedAcpxProfileVersion("grok", 7)).toBe(true);
    expect(isSupportedAcpxProfileVersion("pi", 30)).toBe(true);
    expect(isSupportedAcpxProfileVersion("copilot", 71)).toBe(true);
    expect(isSupportedAcpxProfileVersion("copilot", 17)).toBe(true);
    expect(isSupportedAcpxProfileVersion("pi", 17)).toBe(true);
    expect(isSupportedAcpxProfileVersion("pi", 18)).toBe(true);
    expect(isSupportedAcpxProfileVersion("pi", 23)).toBe(true);
    expect(isSupportedAcpxProfileVersion("cursor", 15)).toBe(true);
    expect(isSupportedAcpxProfileVersion("cursor", 16)).toBe(true);
    expect(isSupportedAcpxProfileVersion("cursor", 17)).toBe(false);
    for (const agent of ["pi", "copilot"]) {
      expect(isSupportedAcpxProfileVersion(agent, 16)).toBe(true);
      const current = QUALIFIED_ACPX_PROFILE_DATA[agent as "pi" | "copilot"].agentProfileVersion;
      expect(isSupportedAcpxProfileVersion(agent, current)).toBe(true);
      expect(isSupportedAcpxProfileVersion(agent, Math.max(16, current) + 1)).toBe(false);
    }
    for (const agent of ["claude", "codex"]) {
      expect(isSupportedAcpxProfileVersion(agent, 5)).toBe(true);
      expect(isSupportedAcpxProfileVersion(agent, 6)).toBe(false);
    }
    for (const version of [1, 2, 3, 4, 5, 6, 7, QUALIFIED_ACPX_PROFILE_DATA.grok.agentProfileVersion]) {
      expect(isSupportedAcpxProfileVersion("grok", version)).toBe(true);
    }
    expect(isSupportedAcpxProfileVersion("grok", QUALIFIED_ACPX_PROFILE_DATA.grok.agentProfileVersion + 1)).toBe(false);
  });
  it("decodes retained Copilot revisions and the current profile without widening other providers", () => {
    for (const version of [1, 5, 6, 12, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]) {
      expect(isSupportedAcpxProfileVersion("copilot", version)).toBe(true);
    }
    expect(isSupportedAcpxProfileVersion("copilot", QUALIFIED_ACPX_PROFILE_DATA.copilot.agentProfileVersion + 1)).toBe(false);
    // Preserve Pi history and its current mainline release without admitting the next profile.
    expect(isSupportedAcpxProfileVersion("pi", 23)).toBe(true);
    expect(isSupportedAcpxProfileVersion("pi", QUALIFIED_ACPX_PROFILE_DATA.pi.agentProfileVersion)).toBe(true);
    expect(isSupportedAcpxProfileVersion("pi", QUALIFIED_ACPX_PROFILE_DATA.pi.agentProfileVersion + 1)).toBe(false);
    for (const agent of ["cursor", "claude", "codex", "grok"]) {
      expect(isSupportedAcpxProfileVersion(agent, 23)).toBe(false);
      expect(isSupportedAcpxProfileVersion(agent, 24)).toBe(false);
      expect(isSupportedAcpxProfileVersion(agent, 25)).toBe(false);
      expect(isSupportedAcpxProfileVersion(agent, 26)).toBe(false);
      expect(isSupportedAcpxProfileVersion(agent, 27)).toBe(false);
    }
  });
  it("decodes every retained Copilot identity so saved runs can reach recovery", () => {
    const root = new URL("../../../test/fixtures/", import.meta.url);
    const files = readdirSync(root).filter(name => /^copilot-profile-v\d+.*-identity\.json$/u.test(name));
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const identity = JSON.parse(readFileSync(new URL(file, root), "utf8"));
      expect(isSupportedAcpxProfileVersion("copilot", identity.declaration.agentProfileVersion), file).toBe(true);
    }
  });
  it("decodes every retained Grok identity so saved runs can reach recovery", () => {
    const root = new URL("../../../test/fixtures/", import.meta.url);
    const files = readdirSync(root).filter(name => /^grok-profile-v\d+.*-identity\.json$/u.test(name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const identity = JSON.parse(readFileSync(new URL(file, root), "utf8"));
      expect(isSupportedAcpxProfileVersion("grok", identity.declaration.agentProfileVersion), file).toBe(true);
    }
  });
  it.each([0, 1.5, "11", null, undefined, NaN])("rejects invalid revisions: %s", version => {
    expect(isSupportedAcpxProfileVersion("cursor", version)).toBe(false);
  });
  it("decodes every current release while retaining exact launch admission separately", () => {
    for (const [agent, current] of Object.entries(QUALIFIED_ACPX_PROFILE_DATA)) {
      expect(isSupportedAcpxProfileVersion(agent, current.agentProfileVersion)).toBe(true);
    }
  });
  it.each(["unknown", "toString", "__proto__"])("rejects unregistered providers: %s", agent => {
    expect(isSupportedAcpxProfileVersion(agent, 1)).toBe(false);
  });
});
