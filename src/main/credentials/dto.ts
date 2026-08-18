import type {
  CredentialDto,
  CredentialSetInput,
  CredentialsListResult
} from '../../shared/ipc-contract';
import type { CredentialSet, TreeNode } from '../../shared/types';
import { sealSecret, type Sealer } from '../store/crypto-format';

/** Набор для рендерера: без шифротекстов. */
export function toDto(set: CredentialSet): CredentialDto {
  return {
    id: set.id,
    name: set.name,
    username: set.username,
    passwordMode: set.passwordMode,
    hasPassword: Boolean(set.passwordCipher),
    keyFile: set.keyFile,
    hasPassphrase: Boolean(set.keyPassphraseCipher),
    useAgent: set.useAgent
  };
}

export function toDtoList(sets: CredentialSet[], recovered: boolean): CredentialsListResult {
  return { sets: sets.map(toDto), recovered };
}

/**
 * Применяет пользовательский ввод к набору. Пароль/фраза шифруются здесь,
 * в main; пустой пароль при редактировании сохраняет прежний шифротекст,
 * `clearPassword: true` — стирает.
 */
export function applyCredentialInput(
  existing: CredentialSet | null,
  input: CredentialSetInput,
  sealer: Sealer
): CredentialSet {
  const base: CredentialSet = existing ?? {
    id: input.id ?? '',
    name: input.name,
    username: input.username,
    passwordMode: input.passwordMode,
    passwordCipher: null,
    keyFile: null,
    keyPassphraseCipher: null,
    useAgent: false
  };

  let passwordCipher = base.passwordCipher;
  if (input.passwordMode === 'ask' || input.clearPassword) {
    passwordCipher = null;
  } else if (input.password !== undefined && input.password !== '') {
    passwordCipher = sealSecret(input.password, sealer);
  }

  let keyPassphraseCipher = base.keyPassphraseCipher;
  if (input.clearPassphrase) {
    keyPassphraseCipher = null;
  } else if (input.keyPassphrase !== undefined && input.keyPassphrase !== '') {
    keyPassphraseCipher = sealSecret(input.keyPassphrase, sealer);
  }

  return {
    ...base,
    id: input.id ?? base.id,
    name: input.name.trim(),
    username: input.username.trim(),
    passwordMode: input.passwordMode,
    passwordCipher,
    keyFile: input.keyFile === undefined ? base.keyFile : (input.keyFile || null),
    keyPassphraseCipher,
    useAgent: input.useAgent ?? base.useAgent
  };
}

/** Убирает ссылки на удалённый набор из всех хостов дерева. */
export function detachCredential(tree: TreeNode[], credentialId: string): TreeNode[] {
  return tree.map((node) => {
    if (node.kind === 'host') {
      return node.credentialId === credentialId ? { ...node, credentialId: null } : node;
    }
    return { ...node, children: detachCredential(node.children, credentialId) };
  });
}

export function validateCredentialInput(input: CredentialSetInput): string | null {
  if (!input.name.trim()) return 'Укажите имя набора';
  if (input.passwordMode !== 'stored' && input.passwordMode !== 'ask') {
    return 'Неизвестный режим пароля';
  }
  return null;
}
