import { useEffect, useMemo, useState } from 'react';
import type { CredentialDto } from '@shared/ipc-contract';
import type { Host, Protocol } from '@shared/types';
import { defaultPort } from '@shared/types';
import { makeHost, useApp } from '../../store';
import Modal from './Modal';

const PROTOCOLS: { value: Protocol; label: string }[] = [
  { value: 'ssh', label: 'SSH' },
  { value: 'telnet', label: 'Telnet' },
  { value: 'rdp', label: 'RDP' },
  { value: 'vnc', label: 'VNC' }
];

interface FormState {
  name: string;
  protocol: Protocol;
  host: string;
  port: string;
  username: string;
  credentialId: string;
  tags: string;
  notes: string;
  keepalive: string;
  agent: boolean;
  timeout: string;
  domain: string;
  screenMode: 'window' | 'fullscreen';
  width: string;
  height: string;
  multiMonitor: boolean;
  promptForCreds: boolean;
  scale: 'scale' | 'noscaled' | 'local';
  quality: string;
}

function toForm(h: Host | null): FormState {
  return {
    name: h?.name ?? '',
    protocol: h?.protocol ?? 'ssh',
    host: h?.host ?? '',
    port: String(h?.port ?? defaultPort(h?.protocol ?? 'ssh')),
    username: h?.username ?? '',
    credentialId: h?.credentialId ?? '',
    tags: h?.tags.join(', ') ?? '',
    notes: h?.notes ?? '',
    keepalive: String(h?.ssh.keepalive ?? 30),
    agent: h?.ssh.agent ?? false,
    timeout: String(h?.ssh.timeout ?? 10),
    domain: h?.rdp.domain ?? '',
    screenMode: h?.rdp.screenMode ?? 'window',
    width: String(h?.rdp.width ?? 1280),
    height: String(h?.rdp.height ?? 800),
    multiMonitor: h?.rdp.multiMonitor ?? false,
    promptForCreds: h?.rdp.promptForCreds ?? false,
    scale: h?.vnc.scale ?? 'scale',
    quality: String(h?.vnc.quality ?? 6)
  };
}

export default function HostDialog({
  host,
  parentId,
  onClose
}: {
  host: Host | null;
  parentId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const upsertHost = useApp((s) => s.upsertHost);
  const pushToast = useApp((s) => s.pushToast);
  const [form, setForm] = useState<FormState>(() => toForm(host));
  const [error, setError] = useState<string | null>(null);
  const [credentialSets, setCredentialSets] = useState<CredentialDto[]>([]);

  useEffect(() => {
    void window.api.getCredentials().then((res) => setCredentialSets(res.sets));
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const switchProtocol = (protocol: Protocol): void => {
    setForm((f) => ({ ...f, protocol, port: String(defaultPort(protocol)) }));
  };

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!form.name.trim()) errs.push('Укажите имя');
    if (!form.host.trim()) errs.push('Укажите адрес хоста');
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errs.push('Порт — целое число от 1 до 65535');
    if (form.protocol === 'rdp' && form.screenMode === 'window') {
      const w = Number(form.width);
      const h = Number(form.height);
      if (!Number.isInteger(w) || w < 320 || !Number.isInteger(h) || h < 200) {
        errs.push('Разрешение — целые числа (мин. 320×200)');
      }
    }
    return errs;
  }, [form]);

  const save = (): void => {
    if (errors.length > 0) {
      setError(errors.join('. '));
      return;
    }
    const hostData = makeHost({
      id: host?.id,
      name: form.name.trim(),
      protocol: form.protocol,
      host: form.host.trim(),
      port: Number(form.port),
      username: form.username.trim(),
      credentialId: form.credentialId === '' ? null : form.credentialId,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      notes: form.notes.trim(),
      ssh: {
        keepalive: Number(form.keepalive) || 0,
        agent: form.agent,
        timeout: Number(form.timeout) || 10
      },
      rdp: {
        domain: form.domain.trim(),
        screenMode: form.screenMode,
        width: Number(form.width),
        height: Number(form.height),
        multiMonitor: form.multiMonitor,
        promptForCreds: form.promptForCreds
      },
      vnc: { scale: form.scale, quality: Math.min(9, Math.max(0, Number(form.quality) || 6)) }
    });
    void upsertHost(hostData, parentId).then(() => {
      pushToast(host ? `Хост «${hostData.name}» обновлён` : `Хост «${hostData.name}» добавлен`);
      onClose();
    });
  };

  return (
    <Modal title={host ? `Хост: ${host.name}` : 'Новый хост'} onClose={onClose} width={520}>
      <div className="form">
        <div className="form-row">
          <label className="form-label">Имя</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Например: Prod-сервер"
            autoFocus
          />
        </div>

        <div className="form-row">
          <label className="form-label">Протокол</label>
          <div className="seg">
            {PROTOCOLS.map((p) => (
              <button
                key={p.value}
                className={`seg-btn${form.protocol === p.value ? ' seg-btn--active' : ''}`}
                onClick={() => switchProtocol(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row form-row--cols">
          <div className="form-col">
            <label className="form-label">Адрес</label>
            <input
              className="input"
              value={form.host}
              onChange={(e) => set('host', e.target.value)}
              placeholder="example.com или 10.0.0.5"
            />
          </div>
          <div className="form-col form-col--port">
            <label className="form-label">Порт</label>
            <input
              className="input"
              value={form.port}
              onChange={(e) => set('port', e.target.value.replace(/[^\d]/g, ''))}
            />
          </div>
        </div>

        <div className="form-row form-row--cols">
          <div className="form-col">
            <label className="form-label">Пользователь</label>
            <input
              className="input"
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              placeholder="root, admin…"
            />
          </div>
          <div className="form-col">
            <label className="form-label">Учётные данные</label>
            <select
              className="input"
              value={form.credentialId}
              onChange={(e) => set('credentialId', e.target.value)}
            >
              <option value="">— без учётных данных —</option>
              {credentialSets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.username ? ` (${c.username})` : ''}
                  {c.hasPassword ? ' 🔒' : c.keyFile ? ' 🔑' : ''}
                </option>
              ))}
            </select>
            {credentialSets.length > 0 && form.credentialId && (
              <div className="form-hint">
                {(() => {
                  const c = credentialSets.find((s) => s.id === form.credentialId);
                  if (!c) return null;
                  return c.hasPassword
                    ? 'Пароль сохранён в хранилище (DPAPI)'
                    : c.keyFile
                      ? `Ключ: ${c.keyFile}`
                      : c.passwordMode === 'ask'
                        ? 'Пароль будет запрошен при подключении'
                        : null;
                })()}
              </div>
            )}
          </div>
        </div>

        {form.protocol === 'ssh' && (
          <div className="form-section">
            <div className="form-row form-row--cols">
              <div className="form-col">
                <label className="form-label">Keep-alive, сек (0 — выкл.)</label>
                <input
                  className="input"
                  value={form.keepalive}
                  onChange={(e) => set('keepalive', e.target.value.replace(/[^\d]/g, ''))}
                />
              </div>
              <div className="form-col">
                <label className="form-label">Таймаут подключения, сек</label>
                <input
                  className="input"
                  value={form.timeout}
                  onChange={(e) => set('timeout', e.target.value.replace(/[^\d]/g, ''))}
                />
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.agent} onChange={(e) => set('agent', e.target.checked)} />
              Использовать SSH-агент
            </label>
          </div>
        )}

        {form.protocol === 'rdp' && (
          <div className="form-section">
            <div className="form-row form-row--cols">
              <div className="form-col">
                <label className="form-label">Домен</label>
                <input className="input" value={form.domain} onChange={(e) => set('domain', e.target.value)} />
              </div>
              <div className="form-col">
                <label className="form-label">Режим экрана</label>
                <select
                  className="input"
                  value={form.screenMode}
                  onChange={(e) => set('screenMode', e.target.value as 'window' | 'fullscreen')}
                >
                  <option value="window">Окно</option>
                  <option value="fullscreen">Полный экран</option>
                </select>
              </div>
            </div>
            {form.screenMode === 'window' && (
              <div className="form-row form-row--cols">
                <div className="form-col">
                  <label className="form-label">Ширина</label>
                  <input
                    className="input"
                    value={form.width}
                    onChange={(e) => set('width', e.target.value.replace(/[^\d]/g, ''))}
                  />
                </div>
                <div className="form-col">
                  <label className="form-label">Высота</label>
                  <input
                    className="input"
                    value={form.height}
                    onChange={(e) => set('height', e.target.value.replace(/[^\d]/g, ''))}
                  />
                </div>
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={form.multiMonitor} onChange={(e) => set('multiMonitor', e.target.checked)} />
              Использовать все мониторы
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.promptForCreds}
                onChange={(e) => set('promptForCreds', e.target.checked)}
              />
              Всегда спрашивать учётные данные
            </label>
          </div>
        )}

        {form.protocol === 'vnc' && (
          <div className="form-section">
            <div className="form-row form-row--cols">
              <div className="form-col">
                <label className="form-label">Масштаб</label>
                <select
                  className="input"
                  value={form.scale}
                  onChange={(e) => set('scale', e.target.value as 'scale' | 'noscaled' | 'local')}
                >
                  <option value="scale">Вписать в окно</option>
                  <option value="noscaled">Без масштабирования</option>
                  <option value="local">Локальный масштаб</option>
                </select>
              </div>
              <div className="form-col">
                <label className="form-label">Качество (0–9)</label>
                <input
                  className="input"
                  value={form.quality}
                  onChange={(e) => set('quality', e.target.value.replace(/[^\d]/g, ''))}
                />
              </div>
            </div>
          </div>
        )}

        <div className="form-row">
          <label className="form-label">Теги (через запятую)</label>
          <input
            className="input"
            value={form.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="prod, linux, web"
          />
        </div>

        <div className="form-row">
          <label className="form-label">Заметки</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn--primary" onClick={save}>
            {host ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
