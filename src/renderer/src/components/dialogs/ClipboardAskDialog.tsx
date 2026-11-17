import { formatBytes } from '@shared/clipboard-policy';
import { copyTextToClipboard } from '../../lib/clipboard';
import { useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

/**
 * Подтверждение записи в буфер обмена текста из удалённой сессии (политика
 * «спрашивать»). Общий для SSH, RDP и VNC: запросы кладёт в очередь
 * `offerRemoteClipboard`, показываем первый, остальные ждут своей очереди —
 * второй текст из сессии не выбрасывает неотвеченный первый.
 */
export default function ClipboardAskDialog(): React.JSX.Element | null {
  const queue = useApp((s) => s.clipboardRequests);
  const resolve = useApp((s) => s.resolveClipboardRequest);
  const request = queue[0];
  if (!request) return null;
  const waiting = queue.length - 1;

  return (
    <Modal title="Скопировать в буфер обмена?" onClose={resolve} width={460}>
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
        {waiting > 0 && (
          <div className="form-hint">
            Ещё запросов в очереди: {waiting} — следующий покажем после ответа на этот.
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={resolve}>
            <Icon name="close" size={13} /> Не копировать
          </button>
          <button
            className="btn btn--primary"
            onClick={() => {
              copyTextToClipboard(request.text);
              resolve();
            }}
          >
            <Icon name="check" size={13} /> Скопировать
          </button>
        </div>
      </div>
    </Modal>
  );
}
