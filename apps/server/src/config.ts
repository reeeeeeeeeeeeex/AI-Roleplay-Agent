import { AppError } from '@new-ai-chat/contracts';
import { resolve } from 'node:path';
export interface AppConfig {
  host: string; port: number; databasePath: string; assetDir: string; webDist: string;
  pairingToken: string | null; defaultImportPath: string; fakeModel: boolean;
}
export function loadConfig(): AppConfig {
  const host = process.env.HOST ?? '127.0.0.1';
  const pairingToken = process.env.PAIRING_TOKEN?.trim() || null;
  if (pairingToken && !/^[A-Za-z0-9_-]{24,256}$/u.test(pairingToken)) throw new AppError("PAIRING_TOKEN must be 24–256 URL-safe letters, numbers, underscores or hyphens.");
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (!pairingToken || pairingToken.length < 24)) throw new AppError("LAN mode requires PAIRING_TOKEN with at least 24 characters.");
  return {
    host, port: Number(process.env.PORT ?? 4310), pairingToken,
    databasePath: resolve(process.env.DATABASE_PATH ?? './data/new-ai-chat.db'),
    assetDir: resolve(process.env.ASSET_DIR ?? './data/assets'), webDist: resolve(process.env.WEB_DIST ?? '../web/dist'),
    defaultImportPath: process.env.SILLYTAVERN_DATA_PATH ?? '', fakeModel: process.env.FAKE_MODEL === '1',
  };
}
