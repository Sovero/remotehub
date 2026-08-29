import { useApp } from '../store';
import ConfirmDialog from './dialogs/ConfirmDialog';
import CredentialsDialog from './dialogs/CredentialsDialog';
import GroupDialog from './dialogs/GroupDialog';
import HostDialog from './dialogs/HostDialog';
import HelpDialog from './dialogs/HelpDialog';
import AboutDialog from './dialogs/AboutDialog';
import HotkeysDialog from './dialogs/HotkeysDialog';
import ImportDialog from './dialogs/ImportDialog';
import NewSessionDialog from './dialogs/NewSessionDialog';
import PasswordDialog from './dialogs/PasswordDialog';
import SnippetsDialog from './dialogs/SnippetsDialog';
import TunnelsDialog from './dialogs/TunnelsDialog';
import WhatsNewDialog from './dialogs/WhatsNewDialog';
import SettingsDialog from './dialogs/SettingsDialog';
import LogDialog from './dialogs/LogDialog';
import HistoryPanel from './HistoryPanel';
import RunbooksDialog from './dialogs/RunbooksDialog';
import Modal from './dialogs/Modal';

export default function DialogRoot(): React.JSX.Element | null {
  const dialog = useApp((s) => s.dialog);
  const closeDialog = useApp((s) => s.closeDialog);
  const patchSettings = useApp((s) => s.patchSettings);
  const historyDialogSize = useApp((s) => s.settings.historyDialogSize);

  if (!dialog) return null;
  switch (dialog.type) {
    case 'host':
      return <HostDialog host={dialog.host} parentId={dialog.parentId} onClose={closeDialog} />;
    case 'group':
      return <GroupDialog group={dialog.group} parentId={dialog.parentId} onClose={closeDialog} />;
    case 'confirm':
      return (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          onConfirm={dialog.onConfirm}
          onClose={closeDialog}
        />
      );
    case 'import':
      return <ImportDialog onClose={closeDialog} />;
    case 'new-session':
      return <NewSessionDialog onClose={closeDialog} />;
    case 'credentials':
      return <CredentialsDialog onClose={closeDialog} />;
    case 'snippets':
      return <SnippetsDialog onClose={closeDialog} />;
    case 'hotkeys':
      return <HotkeysDialog onClose={closeDialog} />;
    case 'about':
      return <AboutDialog onClose={closeDialog} />;
    case 'whats-new':
      return <WhatsNewDialog onClose={closeDialog} />;
    case 'help':
      return <HelpDialog sectionId={dialog.sectionId} onClose={closeDialog} />;
    case 'settings':
      return <SettingsDialog onClose={closeDialog} />;
    case 'password':
      return <PasswordDialog sessionId={dialog.sessionId} title={dialog.title} detail={dialog.detail} />;
    case 'tunnels':
      return <TunnelsDialog sessionId={dialog.sessionId} title={dialog.title} host={dialog.host} onClose={closeDialog} />;
    case 'history':
      return (
        <Modal
          title="История подключений"
          onClose={closeDialog}
          width={historyDialogSize?.width ?? 640}
          height={historyDialogSize?.height ?? 520}
          resizable
          onResize={(size) => void patchSettings({ historyDialogSize: size })}
        >
          <HistoryPanel />
        </Modal>
      );
    case 'logs':
      return <LogDialog />;
    case 'runbooks':
      return <RunbooksDialog />;
    default:
      return null;
  }
}
