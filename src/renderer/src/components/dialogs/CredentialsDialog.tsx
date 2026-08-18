import { useEffect, useState } from 'react';
import type { CredentialDto } from '@shared/ipc-contract';
import { useApp } from '../../store';
import Modal from './Modal';

type View = { mode: 'list' } | { mode: 'edit'; set: CredentialDto | null };

interface EditForm {
  name: string;
  username: string;
  passwordMode: 'stored' | 'ask';
  password: string;
  keyFile: string | null;
  keyPassphrase: string;
  useAgent: boolean;
}

export default function CredentialsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const pushToast = useApp((s) => s.pushToast);
  const setTree = useApp((s) => s.setTree);
  const [sets, setSets] = useState<CredentialDto[]>([]);
  const [view, setView] = useState<View>({ mode: 'list' });

  const refresh = (): void => {
    void window.api.getCredentials().then((res) => setSets(res.sets));
  };

  useEffect(refresh, []);

  const remove = (set: CredentialDto): void => {
    void window.api.deleteCredential(set.id).then((res) => {
      if (res.tree) setTree(res.tree);
      pushToast(`Набор «${set.name}» удалён`);
      refresh();
    });
  };

  return (
    <Modal title="Учётные данные" onClose={onClose} width={520}>
      {view.mode === 'list' ? (
        <div className="form">
          {sets.length === 0 ? (
            <div className="confirm-text">
              Пока нет ни одного набора. Создайте набор — и привяжите его к любому числу хостов: правка набора
              применится ко всем сразу.
            </div>
          ) : (
            <div className="cred-list">
              {sets.map((c) => (
                <div key={c.id} className="cred-item">
                  <div className="cred-item-main">
                    <div className="cred-item-name">{c.name}</div>
                    <div className="cred-item-sub">
                      {c.username || 'без пользователя'}
                      {c.hasPassword ? ' · пароль сохранён' : ''}
                      {c.keyFile ? ` · ключ: ${c.keyFile}` : ''}
                      {c.useAgent ? ' · SSH-агент' : ''}
                      {c.passwordMode === 'ask' ? ' · спрашивать пароль' : ''}
                    </div>
                  </div>
                  <div className="cred-item-actions">
                    <button className="btn btn--sm" onClick={() => setView({ mode: 'edit', set: c })}>
                      Изменить
                    </button>
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={() => {
                        if (window.confirm(`Удалить набор «${c.name}»? Ссылки на него будут сняты с хостов.`)) {
                          remove(c);
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Закрыть
            </button>
            <button className="btn btn--primary" onClick={() => setView({ mode: 'edit', set: null })}>
              Добавить набор
            </button>
          </div>
        </div>
      ) : (
        <CredentialEditor
          initial={view.set}
          onDone={() => {
            refresh();
            setView({ mode: 'list' });
          }}
          onCancel={() => setView({ mode: 'list' })}
        />
      )}
    </Modal>
  );
}

function CredentialEditor({
  initial,
  onDone,
  onCancel
}: {
  initial: CredentialDto | null;
  onDone: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const pushToast = useApp((s) => s.pushToast);
  const [form, setForm] = useState<EditForm>({
    name: initial?.name ?? '',
    username: initial?.username ?? '',
    passwordMode: initial?.passwordMode ?? 'stored',
    password: '',
    keyFile: initial?.keyFile ?? null,
    keyPassphrase: '',
    useAgent: initial?.useAgent ?? false
  });
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const pickKey = (): void => {
    void window.api.pickKeyFile().then((res) => {
      if (!res.canceled) set('keyFile', res.path);
    });
  };

  const save = (): void => {
    if (!form.name.trim()) {
      setError('Укажите имя набора');
      return;
    }
    void window.api
      .saveCredential({
        id: initial?.id,
        name: form.name,
        username: form.username,
        passwordMode: form.passwordMode,
        password: form.passwordMode === 'stored' && form.password ? form.password : undefined,
        clearPassword: form.passwordMode === 'stored' && form.password === '' ? initial?.hasPassword : undefined,
        keyFile: form.keyFile,
        keyPassphrase: form.keyPassphrase || undefined,
        clearPassphrase: form.keyPassphrase === '' && initial?.hasPassphrase ? true : undefined,
        useAgent: form.useAgent
      })
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'Не удалось сохранить');
          return;
        }
        pushToast(initial ? `Набор «${form.name.trim()}» обновлён` : `Набор «${form.name.trim()}» создан`);
        onDone();
      });
  };

  return (
    <div className="form">
      <div className="form-row">
        <label className="form-label">Имя набора</label>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </div>
      <div className="form-row">
        <label className="form-label">Пользователь</label>
        <input className="input" value={form.username} onChange={(e) => set('username', e.target.value)} />
      </div>

      <div className="form-row">
        <label className="form-label">Пароль</label>
        <div className="seg">
          <button
            className={`seg-btn${form.passwordMode === 'stored' ? ' seg-btn--active' : ''}`}
            onClick={() => set('passwordMode', 'stored')}
          >
            Сохранить
          </button>
          <button
            className={`seg-btn${form.passwordMode === 'ask' ? ' seg-btn--active' : ''}`}
            onClick={() => set('passwordMode', 'ask')}
          >
            Спрашивать при подключении
          </button>
        </div>
        {form.passwordMode === 'stored' && (
          <input
            className="input"
            type="password"
            placeholder={initial?.hasPassword ? 'Оставьте пустым, чтобы не менять' : 'Пароль'}
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
          />
        )}
      </div>

      <div className="form-row">
        <label className="form-label">SSH-ключ (необязательно)</label>
        <div className="form-row--cols" style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            value={form.keyFile ?? ''}
            onChange={(e) => set('keyFile', e.target.value || null)}
            placeholder="Путь к файлу ключа"
          />
          <button className="btn" onClick={pickKey}>
            Обзор…
          </button>
        </div>
        <input
          className="input"
          type="password"
          placeholder={initial?.hasPassphrase ? 'Парольная фраза (пусто — не менять)' : 'Парольная фраза ключа'}
          value={form.keyPassphrase}
          onChange={(e) => set('keyPassphrase', e.target.value)}
        />
      </div>

      <label className="check">
        <input type="checkbox" checked={form.useAgent} onChange={(e) => set('useAgent', e.target.checked)} />
        Использовать SSH-агент (Windows OpenSSH)
      </label>

      {error && <div className="form-error">{error}</div>}

      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          Назад
        </button>
        <button className="btn btn--primary" onClick={save}>
          Сохранить
        </button>
      </div>
    </div>
  );
}
