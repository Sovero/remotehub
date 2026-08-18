import Modal from './Modal';

const HOTKEYS: [string, string][] = [
  ['Ctrl+Shift+T', 'Новая сессия'],
  ['Ctrl+W', 'Закрыть вкладку'],
  ['Ctrl+Tab', 'Следующая вкладка'],
  ['Ctrl+1…9', 'Переключиться на вкладку'],
  ['Ctrl+F', 'Поиск в выводе терминала'],
  ['Ctrl+= / Ctrl+-', 'Увеличить / уменьшить шрифт'],
  ['Ctrl+Shift+C / V', 'Копировать / вставить в терминал'],
  ['Правая кнопка мыши', 'Вставить в терминал'],
  ['Enter', 'Быстрое подключение / поиск'],
  ['Esc', 'Закрыть диалог'],
  ['Двойной клик по хосту', 'Открыть сессию'],
  ['Средняя кнопка мыши по вкладке', 'Закрыть вкладку']
];

export default function HotkeysDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title="Горячие клавиши" onClose={onClose} width={420}>
      <table className="hotkeys">
        <tbody>
          {HOTKEYS.map(([key, desc]) => (
            <tr key={key}>
              <td className="hotkeys-key">
                <kbd>{key}</kbd>
              </td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
