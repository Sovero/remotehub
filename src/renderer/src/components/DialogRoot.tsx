import { useApp } from '../store';
import ConfirmDialog from './dialogs/ConfirmDialog';
import GroupDialog from './dialogs/GroupDialog';
import HostDialog from './dialogs/HostDialog';
import ImportDialog from './dialogs/ImportDialog';

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
    default:
      return null;
  }
}
