"use client";

import { useCallback, useEffect, useState } from "react";

function applyScale() {
  document.body.style.setProperty(
    "--scale",
    String(Math.min(window.innerWidth / 1600, window.innerHeight / 900)),
  );
}

/** Activa el modo diapositiva: la portada se proyecta a 1600x900. Esc para salir. */
export function ProjectToggle() {
  const [projecting, setProjecting] = useState(false);

  const toggle = useCallback(() => {
    setProjecting((prev) => {
      const next = !prev;
      document.body.classList.toggle("project", next);
      if (next) applyScale();
      else window.scrollTo(0, 0);
      return next;
    });
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (document.body.classList.contains("project")) applyScale();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.body.classList.contains("project")) {
        document.body.classList.remove("project");
        setProjecting(false);
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <button type="button" onClick={toggle} aria-pressed={projecting}>
      {projecting ? "Esc · Volver a la guía" : "Proyectar diapo"}
    </button>
  );
}
