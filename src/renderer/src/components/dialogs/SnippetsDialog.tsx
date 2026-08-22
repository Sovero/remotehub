import { useState } from 'react';
import { nanoid } from 'nanoid';
import type { Snippet } from '@shared/types';
import { useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

export default function SnippetsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const snippets = useApp((s) => s.settings.snippets);
  const saveSnippet = useApp((s) => s.saveSnippet);
  const deleteSnippet = useApp((s) => s.deleteSnippet);
  const pushToast = useApp((s) => s.pushToast);
  const [editing, setEditing] = useState<{ snippet: Snippet | null } | null>(null);

  const save = (name: string, command: string, id?: string): void => {
    if (!name.trim() || !command.trim()) {
      pushToast('Заполните имя и команду');
      return;
    }
    void saveSnippet({ id: id ?? nanoid(10), name: name.trim(), command: command.trimEnd() }).then(() => {
      setEditing(null);
      pushToast(id ? 'Сниппет обновлён' : 'Сниппет добавлен');
    });
  };

  if (editing) {
    return (
      <SnippetEditor
        initial={editing.snippet}
        onSave={(name, command, id) => save(name, command, id)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <Modal title="Сниппеты" onClose={onClose} width={480}>
      <div className="form">
        {snippets.length === 0 ? (
          <div className="confirm-text">
            Сниппеты — сохранённые команды, которые вставляются в активный терминал одним кликом (кнопка Σ на панели
            вкладок).
          </div>
        ) : (
          <div className="cred-list">
            {snippets.map((s) => (
              <div key={s.id} className="cred-item">
                <div className="cred-item-main">
                  <div className="cred-item-name">{s.name}</div>
                  <div className="cred-item-sub" style={{ fontFamily: 'var(--font-mono)' }}>
                    {s.command}
                  </div>
                </div>
                <div className="cred-item-actions">
                  <button className="btn btn--sm" onClick={() => setEditing({ snippet: s })}>
                    <Icon name="pencil" size={12} /> Изменить
                  </button>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => {
                      void deleteSnippet(s.id);
                      pushToast(`Сниппет «${s.name}» удалён`);
                    }}
                  >
                    <Icon name="trash" size={12} /> Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            <Icon name="close" size={13} /> Закрыть
          </button>
          <button className="btn btn--primary" onClick={() => setEditing({ snippet: null })}>
            <Icon name="plus" size={13} /> Добавить сниппет
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SnippetEditor({
  initial,
  onSave,
  onCancel
}: {
  initial: Snippet | null;
  onSave: (name: string, command: string, id?: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');

  return (
    <Modal title={initial ? 'Изменить сниппет' : 'Новый сниппет'} onClose={onCancel} width={480}>
      <div className="form">
        <div className="form-row">
          <label className="form-label">Имя</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Команда</label>
          <textarea
            className="input"
            rows={3}
            style={{ fontFamily: 'var(--font-mono)' }}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
        </div>
        <div className="form-hint">Сниппет вставляется в активный терминал без нажатия Enter.</div>
        <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          <Icon name="arrow-left" size={13} /> Назад
        </button>
        <button className="btn btn--primary" onClick={() => onSave(name, command, initial?.id)}>
          <Icon name="check" size={13} /> Сохранить
        </button>
        </div>
      </div>
    </Modal>
  );
}
