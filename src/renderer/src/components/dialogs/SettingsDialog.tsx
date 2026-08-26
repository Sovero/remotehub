import Modal from './Modal';
import SettingsForm from '../SettingsForm';

export default function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title="Настройки" onClose={onClose} width={480}>
      <SettingsForm />
    </Modal>
  );
}
