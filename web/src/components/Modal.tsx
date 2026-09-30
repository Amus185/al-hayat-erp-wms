import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

let activeModalCount = 0;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  id?: string;
  zIndex?: number;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  width = 'md',
  id = 'modal',
  zIndex,
}: ModalProps) {
  const levelRef = useRef<number>(0);

  if (isOpen && levelRef.current === 0) {
    activeModalCount += 1;
    levelRef.current = activeModalCount;
  }

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      const myLevel = levelRef.current;

      const handleKeyDown = (e: KeyboardEvent) => {
        // Only the topmost open modal closes on Escape
        if (e.key === 'Escape' && activeModalCount === myLevel) {
          onClose();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        activeModalCount = Math.max(0, activeModalCount - 1);
        levelRef.current = 0;
        if (activeModalCount === 0) {
          document.body.style.overflow = '';
        }
      };
    } else {
      levelRef.current = 0;
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const effectiveZIndex = zIndex !== undefined ? zIndex : 1000 + (levelRef.current || 1) * 100;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      id={`${id}-backdrop`}
      style={{ zIndex: effectiveZIndex }}
    >
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
  zIndex?: number;
}

export function SlideOver({
  isOpen,
  onClose,
  title,
  children,
  footer,
  id = 'slide-over',
  zIndex,
}: SlideOverProps) {
  const levelRef = useRef<number>(0);

  if (isOpen && levelRef.current === 0) {
    activeModalCount += 1;
    levelRef.current = activeModalCount;
  }

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      const myLevel = levelRef.current;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && activeModalCount === myLevel) {
          onClose();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        activeModalCount = Math.max(0, activeModalCount - 1);
        levelRef.current = 0;
        if (activeModalCount === 0) {
          document.body.style.overflow = '';
        }
      };
    } else {
      levelRef.current = 0;
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const effectiveZIndex = zIndex !== undefined ? zIndex : 1000 + (levelRef.current || 1) * 100;

  return (
    <div
      className="slide-over-backdrop"
      onClick={onClose}
      id={`${id}-backdrop`}
      style={{ zIndex: effectiveZIndex }}
    >
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

