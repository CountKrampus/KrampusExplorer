import { useEffect, useRef, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/** Tracks a ref'd element's content-box size via ResizeObserver. Returns { width: 0, height: 0 }
 * until the element is mounted and the first observation fires. Not unit-tested here -- like
 * TerminalWindow's existing ResizeObserver usage, this is a thin wrapper around a browser API
 * that isn't meaningfully testable without a heavy DOM mock, and this codebase's convention is
 * to verify interactive/layout behavior by hand rather than fake-test it. */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, ElementSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
