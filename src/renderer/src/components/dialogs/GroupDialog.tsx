import { useState } from 'react';
import type { Group } from '@shared/types';
import { makeGroup, useApp } from '../../store';
import Modal from './Modal';

export default function GroupDialog({
  group,
  parentId,
  onClose
}: {
  group: Group | null;
  parentId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const upsertGroup = useApp((s) => s.upsertGroup);
  const pushToast = useApp((s) => s.pushToast);
  const [name, setName] = useState(group?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    if (!name.trim()) {
      setError('Укажите имя группы');
      return;
    }
    const g = makeGroup(name.trim());
    if (group) g.id = group.id;
    void upsertGroup(g, parentId).then(() => {
      pushToast(group ? `Группа «${g.name}» переименована` : `Группа «${g.name}» создана`);
      onClose();
    });
  };

  return (
    <Modal title={group ? 'Переименовать группу' : 'Новая группа'} onClose={onClose} width={380}>
      <div className="form">
        <div className="form-row">
          <label className="form-label">Имя</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Продакшен"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn--primary" onClick={save}>
            {group ? 'Переименовать' : 'Создать'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
