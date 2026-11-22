import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * 확인 창. 화면 읽기 프로그램에 대화상자로 알리고, 열리면 안전한 버튼(data-autofocus)에 초점을 두며,
 * Tab은 창 안에서만 돌고, Esc로 닫히고, 닫히면 원래 있던 곳으로 초점을 돌려준다.
 */
export function Modal({ title, onClose, children, dismissOnBackdrop = true }: { title: string; onClose: () => void; children: ReactNode; dismissOnBackdrop?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const focusables = () =>
      box ? [...box.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled")) : [];
    (box?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab") {
        const els = focusables();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={dismissOnBackdrop ? onClose : undefined}>
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h3 id={titleId}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
