import { useEffect, useRef } from 'react';

export function useModalBackHandler(isOpen: boolean, onClose: () => void) {
  const isClosingViaPopstate = useRef(false);
  const pushedStateRef = useRef(false);
  
  // Store the latest onClose callback to avoid unnecessary effect re-runs
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    // Generate a unique identifier for this modal instance
    const modalId = 'm_' + Math.random().toString(36).substring(2, 9);
    isClosingViaPopstate.current = false;
    pushedStateRef.current = false;

    // Push hash state when modal opens, guaranteeing a real browser history entry
    try {
      const targetHash = '#modal-' + modalId;
      window.history.pushState({ modalOpen: true, modalId }, '', targetHash);
      pushedStateRef.current = true;
    } catch (e) {
      console.warn('[useModalBackHandler] pushState error:', e);
    }

    const handlePopState = () => {
      isClosingViaPopstate.current = true;
      onCloseRef.current();
    };

    const handleHashChange = () => {
      if (!window.location.hash.includes(modalId)) {
        isClosingViaPopstate.current = true;
        onCloseRef.current();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('keydown', handleKeyDown);
      
      // If the modal was closed via UI (e.g., UI close button, Geri button, ESC, backdrop),
      // and we had successfully pushed history state with our hash, revert the hash safely.
      if (!isClosingViaPopstate.current && pushedStateRef.current) {
        try {
          if (window.location.hash.includes(modalId) || (window.history.state && window.history.state.modalId === modalId)) {
            window.history.back();
          }
        } catch (e) {
          console.warn('[useModalBackHandler] history.back error:', e);
        }
      }
      isClosingViaPopstate.current = false;
      pushedStateRef.current = false;
    };
  }, [isOpen]); // We only re-run when isOpen changes
}

