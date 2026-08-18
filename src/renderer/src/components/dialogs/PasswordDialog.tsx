import { useState } from 'react';
import { useApp } from '../../store';
import Modal from './Modal';

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
            Отмена
          </button>
          <button className="btn btn--primary" disabled={busy || !password} onClick={submit}>
            Подключиться
          </button>
        </div>
      </div>
    </Modal>
  );
}
