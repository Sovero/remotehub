import Modal from './Modal';

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal title={title} onClose={onClose} width={400}>
      <div className="confirm-text">{message}</div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button
          className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
          onClick={() => {
            void onConfirm();
            onClose();
          }}
        >
          {confirmLabel ?? 'Подтвердить'}
        </button>
      </div>
    </Modal>
  );
}
