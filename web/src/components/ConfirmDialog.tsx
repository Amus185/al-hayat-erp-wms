import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  id?: string;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  id = 'confirm-dialog',
}: ConfirmDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width="sm"
      id={id}
      footer={
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
            id={`${id}-cancel`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn--${variant}`}
            onClick={onConfirm}
            disabled={loading}
            id={`${id}-confirm`}
          >
            {loading ? 'Processing…' : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="confirm-dialog__message">{message}</p>
    </Modal>
  );
}
