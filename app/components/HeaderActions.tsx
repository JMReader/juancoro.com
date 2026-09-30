"use client";

import { ProjectToggle } from "./ProjectToggle";

export function HeaderActions() {
  return (
    <nav>
      <ProjectToggle />
      <button type="button" onClick={() => window.print()}>
        Imprimir
      </button>
    </nav>
  );
}
