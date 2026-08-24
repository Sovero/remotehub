import { useState } from 'react';
import type { Runbook, RunbookStep } from '@shared/types';
import { useApp } from '../../store';
import Icon from '../Icon';
import Modal from './Modal';

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function RunbooksDialog(): React.JSX.Element {
  const runbooks = useApp((s) => s.runbooks);
  const saveRunbook = useApp((s) => s.saveRunbook);
  const deleteRunbook = useApp((s) => s.deleteRunbook);
  const runRunbook = useApp((s) => s.runRunbook);
  const closeDialog = useApp((s) => s.closeDialog);
  const tree = useApp((s) => s.tree);
  const pushToast = useApp((s) => s.pushToast);

  const [editing, setEditing] = useState<Runbook | null>(null);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);

  // Flatten hosts for dropdown
  const hosts = tree.flatMap(function flatten(n: any): any[] {
    return n.kind === 'group' ? (n.children ?? []).flatMap(flatten) : [n];
  }).filter((n: any) => n.kind === 'host');

  if (editing) {
    return <RunbookEditor runbook={editing} onSave={async (rb) => {
      await saveRunbook(rb);
      setEditing(null);
      pushToast(`Runbook «${rb.name}» сохранён`);
    }} onCancel={() => setEditing(null)} />;
  }

  return (
    <Modal title="Runbook-скрипты" onClose={() => closeDialog()} width={620}>
      <div className="runbook-panel">
        <div className="runbook-body">
          {runbooks.length === 0 ? (
            <div className="history-empty">
              <Icon name="code" size={32} />
              <p>Нет runbook-скриптов</p>
              <p className="placeholder-muted">Создайте цепочку команд для выполнения на хостах</p>
            </div>
          ) : (
            <div className="runbook-list">
              {runbooks.map((rb) => (
                <div key={rb.id} className="runbook-item">
                  <div className="runbook-item-info">
                    <div className="runbook-item-name">{rb.name}</div>
                    <div className="runbook-item-desc">{rb.description || `${rb.steps.length} шагов`}</div>
                  </div>
                  <div className="runbook-item-actions">
                    <select
                      className="input input--sm"
                      value={selectedHost ?? ''}
                      onChange={(e) => setSelectedHost(e.target.value || null)}
                    >
                      <option value="">Выбрать хост…</option>
                      {hosts.map((h: any) => (
                        <option key={h.id} value={h.id}>{h.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn--sm btn--primary"
                      disabled={!selectedHost}
                      onClick={() => selectedHost && void runRunbook(rb.id, selectedHost)}
                      title="Запустить на выбранном хосте"
                    >
                      <Icon name="play" size={12} /> Запустить
                    </button>
                    <button className="btn btn--sm" onClick={() => setEditing(rb)} title="Редактировать">
                      <Icon name="pencil" size={12} />
                    </button>
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={() => void deleteRunbook(rb.id)}
                      title="Удалить"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="runbook-foot">
          <button className="btn btn--primary" onClick={() => setEditing({
            id: genId(),
            name: '',
            description: '',
            hostIds: [],
            steps: [{ id: genId(), name: 'Шаг 1', command: '' }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })}>
            <Icon name="plus" size={12} /> Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RunbookEditor({ runbook, onSave, onCancel }: {
  runbook: Runbook;
  onSave: (rb: Runbook) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(runbook.name);
  const [desc, setDesc] = useState(runbook.description);
  const [steps, setSteps] = useState<RunbookStep[]>(runbook.steps);

  const addStep = (): void => {
    setSteps([...steps, { id: genId(), name: `Шаг ${steps.length + 1}`, command: '' }]);
  };

  const updateStep = (id: string, patch: Partial<RunbookStep>): void => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeStep = (id: string): void => {
    setSteps(steps.filter((s) => s.id !== id));
  };

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return;
    await onSave({
      ...runbook,
      name: name.trim(),
      description: desc.trim(),
      steps: steps.filter((s) => s.command.trim()),
      updatedAt: new Date().toISOString()
    });
  };

  return (
    <Modal title={runbook.name ? 'Редактировать runbook' : 'Новый runbook'} onClose={onCancel} width={560}>
      <div className="runbook-editor">
        <label className="form-label">
          Название
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Мой скрипт" />
        </label>
        <label className="form-label">
          Описание
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Обновление пакетов и перезагрузка" />
        </label>
        <div className="runbook-steps">
          <h4>Шаги ({steps.length})</h4>
          {steps.map((step, idx) => (
            <div key={step.id} className="runbook-step">
              <span className="runbook-step-num">{idx + 1}</span>
              <input
                className="input input--sm"
                value={step.name}
                onChange={(e) => updateStep(step.id, { name: e.target.value })}
                placeholder="Название шага"
                style={{ flex: '0 0 140px' }}
              />
              <input
                className="input"
                value={step.command}
                onChange={(e) => updateStep(step.id, { command: e.target.value })}
                placeholder="apt update && apt upgrade -y"
              />
              <button className="btn btn--sm btn--danger btn--icon" onClick={() => removeStep(step.id)}>
                <Icon name="trash" size={11} />
              </button>
            </div>
          ))}
          <button className="btn btn--sm" onClick={addStep}>
            <Icon name="plus" size={12} /> Добавить шаг
          </button>
        </div>
        <div className="runbook-foot">
          <button className="btn btn--primary" onClick={() => void handleSave()} disabled={!name.trim()}>
            <Icon name="save" size={12} /> Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}
