import { useState } from 'react';
import { parseHostKeyDetail, useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

const fpStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  wordBreak: 'break-all'
};

export default function PasswordDialog({
  sessionId,
  title,
  detail
}: {
  sessionId: string;
  title: string;
  detail: string;
}): React.JSX.Element {
  const submitPassword = useApp((s) => s.submitPassword);
  const submitHostKeyDecision = useApp((s) => s.submitHostKeyDecision);
  const closeDialog = useApp((s) => s.closeDialog);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    if (!password || busy) return;
    setBusy(true);
    void submitPassword(sessionId, password).then(() => {
      setBusy(false);
      closeDialog();
    });
  };

  const hostKey = parseHostKeyDetail(detail);
  if (hostKey) {
    const changed = hostKey.kind === 'changed';

    const decide = (accept: boolean): void => {
      if (busy) return;
      setBusy(true);
      void submitHostKeyDecision(sessionId, accept).then(() => {
        setBusy(false);
        closeDialog();
      });
    };

    return (
      <Modal title={title} onClose={() => decide(false)} width={changed ? 460 : 400}>
        <div className="form">
          {changed ? (
            <div className="form-error">
              Отпечаток ключа сервера {hostKey.host}:{hostKey.port} изменился с момента последнего подключения. Это
              может значить, что сервер переустановили — либо что кто-то подменяет соединение (атака «человек
              посередине»). Подключайтесь, только если точно знаете причину изменения.
            </div>
          ) : (
            <div className="form-row">
              <label className="form-label">
                Сервер {hostKey.host}:{hostKey.port} подключается впервые. Сверьте отпечаток ключа с тем, что вам
                прислал администратор сервера, прежде чем продолжить.
              </label>
            </div>
          )}
          {changed && (
            <div className="form-row">
              <label className="form-label">Прежний отпечаток ({hostKey.algo})</label>
              <code className="input" style={fpStyle}>
                SHA256:{hostKey.oldFingerprint}
              </code>
            </div>
          )}
          <div className="form-row">
            <label className="form-label">
              {changed ? 'Новый отпечаток' : 'Отпечаток ключа'} ({hostKey.algo})
            </label>
            <code className="input" style={fpStyle}>
              SHA256:{hostKey.fingerprint}
            </code>
          </div>
          <div className="modal-actions">
            <button
              className={changed ? 'btn btn--danger' : 'btn'}
              disabled={busy}
              autoFocus={changed}
              onClick={() => decide(false)}
            >
              <Icon name="close" size={13} /> Отклонить
            </button>
            <button
              className={changed ? 'btn' : 'btn btn--primary'}
              disabled={busy}
              autoFocus={!changed}
              onClick={() => decide(true)}
            >
              <Icon name="check" size={13} /> {changed ? 'Всё равно подключиться' : 'Доверять и подключиться'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={closeDialog} width={380}>
      <div className="form">
        <div className="form-row">
          <label className="form-label">{detail}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={closeDialog}>
            <Icon name="close" size={13} /> Отмена
          </button>
          <button className="btn btn--primary" disabled={busy || !password} onClick={submit}>
            <Icon name="play" size={13} /> Подключиться
          </button>
        </div>
      </div>
    </Modal>
  );
}
