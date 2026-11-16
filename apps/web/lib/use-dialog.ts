"use client";
import { useEffect, useRef } from "react";

/** Keep keyboard focus in a modal and return it to the control that opened it. */
export function useDialog(onClose: () => void, blocked = false, open = true) {
  const element = useRef<HTMLElement>(null);
  const current = useRef({ onClose, blocked });
  useEffect(() => {
    current.current = { onClose, blocked };
  }, [onClose, blocked]);
  useEffect(() => {
    const dialog = element.current;
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, video[controls], [tabindex="0"]',
        ),
      ].filter((node) => node.getClientRects().length > 0 && node.tabIndex >= 0);
    (controls()[0] || dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!current.current.blocked) current.current.onClose();
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0] || dialog;
      const last = items[items.length - 1] || dialog;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return element;
}
