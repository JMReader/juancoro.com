"use client";

export function ExitProject() {
  return (
    <button
      type="button"
      className="exit"
      onClick={() => {
        document.body.classList.remove("project");
        window.scrollTo(0, 0);
      }}
    >
      Esc · Volver a la guía
    </button>
  );
}
