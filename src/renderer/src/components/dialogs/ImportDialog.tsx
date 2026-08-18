import { useApp } from '../../store';
import Modal from './Modal';

export default function ImportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const importTree = useApp((s) => s.importTree);
  const closeDialog = useApp((s) => s.closeDialog);

  const run = (mode: 'merge' | 'replace'): void => {
    closeDialog();
    void importTree(mode);
  };

  return (
    <Modal title="Импорт профилей" onClose={onClose} width={420}>
      <div className="confirm-text">
        Выберите файл профилей Remote Hub (JSON), затем — как применить импорт.
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button className="btn" onClick={() => run('merge')}>
          Слить с текущими
        </button>
        <button className="btn btn--primary" onClick={() => run('replace')}>
          Заменить всё
        </button>
      </div>
    </Modal>
  );
}
