import Swal from 'sweetalert2';

/**
 * AlHayat ERP Enterprise SweetAlert2 Design System
 * Inspired by Google Material 3 & Modern Enterprise UI
 */
const AlHayatSwal = Swal.mixin({
  allowOutsideClick: false,
  allowEscapeKey: false,
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
    customClass: {
      confirmButton: 'swal2-alhayat-danger-btn',
    },
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
 * Safe HTML escape helper
 */
const escapeHtml = (text: string): string => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Modern SVG Icon Badges for Enterprise Notifications (Linear/Stripe/Vercel aesthetic)
 */
const getToastIconBadge = (type: 'success' | 'error' | 'info' | 'warning'): string => {
  switch (type) {
    case 'success':
      return `
        <div class="swal2-toast-icon-badge swal2-toast-icon-badge--success" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
      `;
    case 'error':
      return `
        <div class="swal2-toast-icon-badge swal2-toast-icon-badge--error" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </div>
      `;
    case 'warning':
      return `
        <div class="swal2-toast-icon-badge swal2-toast-icon-badge--warning" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
      `;
    case 'info':
    default:
      return `
        <div class="swal2-toast-icon-badge swal2-toast-icon-badge--info" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </div>
      `;
  }
};

/**
 * Display a sleek floating modern toast notification (Linear / Stripe / Apple tier)
 */
export const showToast = (
  title: string,
  type: 'success' | 'error' | 'info' | 'warning' = 'success',
  duration = 3500
) => {
  const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    showCloseButton: true,
    timer: duration,
    timerProgressBar: true,
    customClass: {
      popup: `swal2-modern-toast swal2-toast--${type}`,
      htmlContainer: 'swal2-modern-toast-html',
      closeButton: 'swal2-modern-toast-close',
      timerProgressBar: 'swal2-modern-toast-progress',
    },
    didOpen: (toast) => {
      toast.onmouseenter = Swal.stopTimer;
      toast.onmouseleave = Swal.resumeTimer;
    },
  });

  Toast.fire({
    html: `
      <div class="swal2-modern-toast-inner">
        ${getToastIconBadge(type)}
        <div class="swal2-modern-toast-content">
          <span class="swal2-modern-toast-message">${escapeHtml(title)}</span>
        </div>
      </div>
    `,
  });
};

