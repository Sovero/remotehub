import { safeStorage } from 'electron';
import type { Sealer } from './crypto-format';

/** Платформенный sealer: на Windows — DPAPI через safeStorage. */
export const dpapiSealer: Sealer = {
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  seal: (plain) => safeStorage.encryptString(plain),
  unseal: (data) => safeStorage.decryptString(data)
};
