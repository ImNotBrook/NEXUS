import { describe, expect, it } from "vitest";
import { createLocalBackup, parseLocalBackup } from "./local-backup";

describe("local backup envelope", () => {
  it("creates and verifies a deterministic integrity-protected backup", async () => {
    const payload = { records: [{ id: "a", value: 1 }], events: [] };
    const backup = await createLocalBackup("decision-journal", payload, 1_800_000_000_000);
    const parsed = await parseLocalBackup(JSON.stringify(backup), "decision-journal");
    expect(parsed.payload).toEqual(payload);
    expect(parsed.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects payload tampering", async () => {
    const backup = await createLocalBackup("paper-account", { account: null }, 1_800_000_000_000);
    const tampered = { ...backup, payload: { account: { cash: 999999 } } };
    await expect(parseLocalBackup(JSON.stringify(tampered), "paper-account")).rejects.toThrow(/checksum/i);
  });

  it("rejects the wrong backup type and unsupported versions", async () => {
    const backup = await createLocalBackup("paper-account", { account: null }, 1_800_000_000_000);
    await expect(parseLocalBackup(JSON.stringify(backup), "decision-journal")).rejects.toThrow(/type/i);
    await expect(parseLocalBackup(JSON.stringify({ ...backup, schemaVersion: 99 }), "paper-account")).rejects.toThrow(/version/i);
  });

  it("creates and verifies a strategy library backup envelope", async () => {
    const payload = [{ id: "btc-sma@1.0.0", createdAt: 1000, definition: { id: "btc-sma", version: "1.0.0" } }];
    const backup = await createLocalBackup("strategy-library", payload, 1_800_000_000_000);
    const parsed = await parseLocalBackup(JSON.stringify(backup), "strategy-library");
    expect(parsed.kind).toBe("strategy-library");
    expect(parsed.payload).toEqual(payload);
  });

  it("rejects malformed JSON and non-object payloads", async () => {
    await expect(parseLocalBackup("{broken", "decision-journal")).rejects.toThrow(/JSON/i);
    await expect(createLocalBackup("decision-journal", null, 1_800_000_000_000)).rejects.toThrow(/object/i);
  });
});
