import { useEffect, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  id?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  width = 'md',
  id = 'modal',
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} id={`${id}-backdrop`}>
      <div
        className={`modal-panel modal-panel--${width}`}
        onClick={(e) => e.stopPropagation()}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-panel__header">
          <h2>{title}</h2>
          <button
            type="button"
            className="modal-panel__close"
            onClick={onClose}
            aria-label="Close"
            id={`${id}-close`}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-panel__body">{children}</div>
        {footer && <div className="modal-panel__footer">{footer}</div>}
      </div>
    </div>
  );
}

// Slide-over variant
interface SlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  id?: string;
}

export function SlideOver({
  isOpen,
  onClose,
  title,
  children,
  footer,
  id = 'slide-over',
}: SlideOverProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="slide-over-backdrop" onClick={onClose} id={`${id}-backdrop`}>
      <div
        className="slide-over-panel"
        onClick={(e) => e.stopPropagation()}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="slide-over-panel__header">
          <h2>{title}</h2>
          <button
            type="button"
            className="slide-over-panel__close"
            onClick={onClose}
            aria-label="Close"
            id={`${id}-close`}
          >
            <X size={18} />
          </button>
        </div>
        <div className="slide-over-panel__body">{children}</div>
        {footer && <div className="slide-over-panel__footer">{footer}</div>}
      </div>
    </div>
  );
}
