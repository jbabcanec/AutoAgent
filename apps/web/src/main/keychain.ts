import { app, safeStorage } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface KeyStoreRecord {
  encryptedApiKeyBase64: string;
  updatedAt: string;
}

type KeyStore = Record<string, KeyStoreRecord>;

function getStorePath(): string {
  const userData = app.getPath("userData");
  mkdirSync(userData, { recursive: true });
  return path.join(userData, "secure-key-store.json");
}

function loadStore(): KeyStore {
  const storePath = getStorePath();
  try {
    const content = readFileSync(storePath, "utf8");
    return JSON.parse(content) as KeyStore;
  } catch {
    return {};
  }
}

function saveStore(store: KeyStore): void {
  const storePath = getStorePath();
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS encryption is not available for secure key storage.");
  }
}

export function storeApiKey(providerId: string, apiKey: string): boolean {
  assertEncryptionAvailable();
  const encrypted = safeStorage.encryptString(apiKey).toString("base64");
  const store = loadStore();
  store[providerId] = {
    encryptedApiKeyBase64: encrypted,
    updatedAt: new Date().toISOString()
  };
  saveStore(store);
  return true;
}

export function deleteApiKey(providerId: string): boolean {
  const store = loadStore();
  if (!store[providerId]) return false;
  delete store[providerId];
  saveStore(store);
  return true;
}

export function hasApiKey(providerId: string): boolean {
  const store = loadStore();
  return !!store[providerId];
}

export function getApiKey(providerId: string): string | undefined {
  assertEncryptionAvailable();
  const store = loadStore();
  const record = store[providerId];
  if (!record) return undefined;
  const buffer = Buffer.from(record.encryptedApiKeyBase64, "base64");
  return safeStorage.decryptString(buffer);
}
