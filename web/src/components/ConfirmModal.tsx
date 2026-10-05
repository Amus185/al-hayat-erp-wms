import { useEffect } from 'react';
import Swal from 'sweetalert2';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    Swal.fire({
      title,
      text: message,
      icon: isDestructive ? 'warning' : 'question',
      iconColor: isDestructive ? '#dc2626' : '#0B8F08',
      showCancelButton: true,
      confirmButtonText: confirmLabel,
      cancelButtonText: cancelLabel,
      reverseButtons: true,
      allowOutsideClick: false,
      allowEscapeKey: false,
      customClass: {
        popup: 'swal2-alhayat-popup',
        title: 'swal2-alhayat-title',
        htmlContainer: 'swal2-alhayat-html',
        actions: 'swal2-alhayat-actions',
        confirmButton: isDestructive ? 'swal2-alhayat-danger-btn' : 'swal2-alhayat-confirm-btn',
        cancelButton: 'swal2-alhayat-cancel-btn',
      },
      buttonsStyling: false,
      background: 'var(--bg-card, #ffffff)',
      color: 'var(--text, #1a1a1a)',
    }).then((result) => {
      onCancel(); // Always reset isOpen to false in parent
      if (result.isConfirmed) {
        onConfirm();
      }
    });
  }, [isOpen]);

  return null;
}

