import { formatBytes } from '@shared/clipboard-policy';
import { copyTextToClipboard } from '../../lib/clipboard';
import { useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

/**
 * Подтверждение записи в буфер обмена текста из удалённой сессии (политика
 * «спрашивать»). Общий для SSH, RDP и VNC: запрос кладёт в стор `offerRemoteClipboard`.
 */
export default function ClipboardAskDialog(): React.JSX.Element | null {
  const request = useApp((s) => s.pendingClipboard);
  const setPendingClipboard = useApp((s) => s.setPendingClipboard);
  if (!request) return null;

  return (
    <Modal title="Скопировать в буфер обмена?" onClose={() => setPendingClipboard(null)} width={460}>
      <div className="form">
        <div className="form-row">
          <label className="form-label">
            {request.source} просит записать в буфер обмена {formatBytes(request.bytes)} текста.
          </label>
          <code className="input clip-preview">{request.preview}</code>
        </div>
        <div className="form-hint">
          Политику можно сменить в настройках: разрешить, спрашивать или запретить.
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setPendingClipboard(null)}>
            <Icon name="close" size={13} /> Не копировать
          </button>
          <button
            className="btn btn--primary"
            onClick={() => {
              copyTextToClipboard(request.text);
              setPendingClipboard(null);
            }}
          >
            <Icon name="check" size={13} /> Скопировать
          </button>
        </div>
      </div>
    </Modal>
  );
}
