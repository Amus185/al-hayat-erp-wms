import type { ToastType } from '../contexts/ToastContext';

/**
 * After a save has SUCCEEDED: refresh the screen in the background.
 *
 * The save is done, so the button stops "Processing…" and the success message shows at once. The
 * refresh must never keep the spinner running, and a refresh that fails must never be reported as
 * a failed save: that told people "Failed to record payment" after the payment was recorded,
 * and invited them to pay twice.
 */
export function refreshAfterSave(addToast: (type: ToastType, message: string) => void, ...jobs: Array<() => unknown>) {
  let warned = false;
  for (const job of jobs) {
    Promise.resolve()
      .then(job)
      .catch(() => {
        if (warned) return;
        warned = true;
        addToast('warning', 'Saved. The screen could not refresh; reload the page to see the latest.');
      });
  }
}
