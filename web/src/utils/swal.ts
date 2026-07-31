import Swal from 'sweetalert2';

/**
 * AlHayat ERP Enterprise SweetAlert2 Design System
 * Inspired by Google Material 3 & Modern Enterprise UI
 */
const AlHayatSwal = Swal.mixin({
  customClass: {
    popup: 'swal2-alhayat-popup',
    title: 'swal2-alhayat-title',
    htmlContainer: 'swal2-alhayat-html',
    confirmButton: 'swal2-alhayat-confirm-btn',
    cancelButton: 'swal2-alhayat-cancel-btn',
    denyButton: 'swal2-alhayat-deny-btn',
    actions: 'swal2-alhayat-actions',
  },
  buttonsStyling: false,
});

/**
 * Confirm item deletion with a modern red/warning SweetAlert modal
 */
export const confirmDelete = async (
  title = 'Delete Item?',
  text = 'This action is permanent and cannot be undone.'
): Promise<boolean> => {
  const result = await AlHayatSwal.fire({
    title,
    text,
    icon: 'warning',
    iconColor: '#dc2626',
    showCancelButton: true,
    confirmButtonText: 'Yes, Delete',
    cancelButtonText: 'Cancel',
    reverseButtons: true,
    focusCancel: true,
  });
  return result.isConfirmed;
};

/**
 * Confirm a general action (e.g. status change, credential reset, order completion)
 */
export const confirmAction = async (
  title: string,
  text: string,
  confirmButtonText = 'Confirm',
  icon: 'warning' | 'info' | 'question' | 'error' | 'success' = 'warning'
): Promise<boolean> => {
  const result = await AlHayatSwal.fire({
    title,
    text,
    icon,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: 'Cancel',
    reverseButtons: true,
  });
  return result.isConfirmed;
};

/**
 * Display a modern alert notification
 */
export const showAlert = async (
  title: string,
  text?: string,
  icon: 'success' | 'error' | 'warning' | 'info' = 'info'
): Promise<void> => {
  await AlHayatSwal.fire({
    title,
    text,
    icon,
    confirmButtonText: 'OK',
  });
};

/**
 * Display a sleek floating toast in the top right
 */
export const showToast = (
  title: string,
  icon: 'success' | 'error' | 'info' | 'warning' = 'success'
) => {
  const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    didOpen: (toast) => {
      toast.onmouseenter = Swal.stopTimer;
      toast.onmouseleave = Swal.resumeTimer;
    },
  });

  Toast.fire({
    icon,
    title,
  });
};
