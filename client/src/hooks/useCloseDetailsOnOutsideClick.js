import { useEffect, useRef } from "react";

export function useCloseDetailsOnOutsideClick() {
  const ref = useRef(null);

  useEffect(() => {
    function closeIfOutside(event) {
      const details = ref.current;
      if (!details?.open || details.contains(event.target)) return;
      details.open = false;
    }

    function closeOnEscape(event) {
      const details = ref.current;
      if (event.key !== "Escape" || !details?.open) return;
      details.open = false;
    }

    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return ref;
}
