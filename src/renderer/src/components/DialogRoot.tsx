import { useApp } from '../store';
import ConfirmDialog from './dialogs/ConfirmDialog';
import CredentialsDialog from './dialogs/CredentialsDialog';
import GroupDialog from './dialogs/GroupDialog';
import HostDialog from './dialogs/HostDialog';
import HotkeysDialog from './dialogs/HotkeysDialog';
import ImportDialog from './dialogs/ImportDialog';
import NewSessionDialog from './dialogs/NewSessionDialog';
import PasswordDialog from './dialogs/PasswordDialog';
import SettingsDialog from './dialogs/SettingsDialog';
import SnippetsDialog from './dialogs/SnippetsDialog';
import TunnelsDialog from './dialogs/TunnelsDialog';

export default function DialogRoot(): React.JSX.Element | null {
  const dialog = useApp((s) => s.dialog);
  const closeDialog = useApp((s) => s.closeDialog);

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
    case 'settings':
      return <SettingsDialog onClose={closeDialog} />;
    case 'snippets':
      return <SnippetsDialog onClose={closeDialog} />;
    case 'hotkeys':
      return <HotkeysDialog onClose={closeDialog} />;
    case 'password':
      return <PasswordDialog sessionId={dialog.sessionId} title={dialog.title} detail={dialog.detail} />;
    case 'tunnels':
      return <TunnelsDialog sessionId={dialog.sessionId} title={dialog.title} host={dialog.host} onClose={closeDialog} />;
    default:
      return null;
  }
}
