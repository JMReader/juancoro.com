"use client";

import { useState } from "react";

export function CopyPrompt({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard no disponible: el texto queda seleccionable en el <pre>
    }
  }

  return (
    <>
      <button type="button" className={className ?? "copy"} onClick={copy}>
        Copiar prompt
      </button>
      <div className="toast" role="status" style={copied ? { display: "block" } : undefined}>
        Prompt copiado
      </div>
    </>
  );
}
