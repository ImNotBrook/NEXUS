export const LOCAL_BACKUP_SCHEMA_VERSION = 1 as const;
export type LocalBackupKind = "decision-journal" | "paper-account";

export interface LocalBackupEnvelope<T = Record<string, unknown>> {
  format: "nexus-local-backup";
  schemaVersion: typeof LOCAL_BACKUP_SCHEMA_VERSION;
  kind: LocalBackupKind;
  createdAt: number;
  checksum: string;
  payload: T;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Backup payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Backup payload must contain only JSON-safe values");
  }
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) => {
    if (object[key] === undefined) throw new TypeError("Backup payload cannot contain undefined values");
    return JSON.stringify(key) + ":" + canonicalJson(object[key]);
  }).join(",") + "}";
}

function checksumInput(kind: LocalBackupKind, createdAt: number, payload: unknown): string {
  return canonicalJson({
    format: "nexus-local-backup",
    schemaVersion: LOCAL_BACKUP_SCHEMA_VERSION,
    kind,
    createdAt,
    payload,
  });
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this browser");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return "sha256:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validatePayload(payload: unknown): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.getPrototypeOf(payload) !== Object.prototype) {
    throw new TypeError("Backup payload must be a JSON object");
  }
  canonicalJson(payload);
}

export async function createLocalBackup<T extends Record<string, unknown>>(
  kind: LocalBackupKind,
  payload: T,
  createdAt = Date.now(),
): Promise<LocalBackupEnvelope<T>> {
  if (kind !== "decision-journal" && kind !== "paper-account") throw new TypeError("Unsupported backup type");
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new RangeError("Backup timestamp is invalid");
  validatePayload(payload);
  const checksum = await sha256(checksumInput(kind, createdAt, payload));
  return {
    format: "nexus-local-backup",
    schemaVersion: LOCAL_BACKUP_SCHEMA_VERSION,
    kind,
    createdAt,
    checksum,
    payload: structuredClone(payload),
  };
}

export async function parseLocalBackup(
  source: string,
  expectedKind: LocalBackupKind,
): Promise<LocalBackupEnvelope> {
  if (typeof source !== "string" || source.length > 25_000_000) {
    throw new RangeError("Backup file is missing or exceeds the 25 MB safety limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new TypeError("Backup file is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Backup envelope must be an object");
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== "nexus-local-backup") throw new TypeError("File is not a NEXUS local backup");
  if (envelope.schemaVersion !== LOCAL_BACKUP_SCHEMA_VERSION) throw new TypeError("Unsupported backup schema version");
  if (envelope.kind !== expectedKind) throw new TypeError("Backup type does not match the selected restore operation");
  if (!Number.isSafeInteger(envelope.createdAt) || (envelope.createdAt as number) < 0) {
    throw new TypeError("Backup timestamp is invalid");
  }
  if (typeof envelope.checksum !== "string" || !/^sha256:[a-f0-9]{64}$/.test(envelope.checksum)) {
    throw new TypeError("Backup checksum is missing or malformed");
  }
  validatePayload(envelope.payload);
  const actual = await sha256(checksumInput(expectedKind, envelope.createdAt as number, envelope.payload));
  if (actual !== envelope.checksum) throw new Error("Backup checksum verification failed; file may be damaged or modified");
  return structuredClone(envelope) as unknown as LocalBackupEnvelope;
}
