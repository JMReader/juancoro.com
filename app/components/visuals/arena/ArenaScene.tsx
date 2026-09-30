"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clock, frame, frameLoop, init, surface } from "vgpu";
import type { FrameLoopHandle, Gpu } from "vgpu";
import { ARENA_PAN, createArenaScene } from "./scene";
import type { ArenaGrab, ArenaScene as ArenaSceneApi } from "./scene";

/* ------------------------------------------------------------------ */
/* Pointer interaction                                                  */
/* ------------------------------------------------------------------ */

/** Exponential ease rate (1/s) for the camera hover pan. */
const PAN_EASE = 6;
/** Pointer-velocity EMA weight per coalesced event — sets the throw. */
const VEL_EMA = 0.4;
/** Held-but-stationary pointers bleed velocity at this rate (1/s). */
const STALE_BLEED = 10;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

interface ArenaPointer {
  /**
   * Advance the interaction sim by `dt` seconds. Returns the grab state for
   * `arena.step()` (null when nothing is held) and the eased camera pan for
   * `arena.render()` — zeroed while a mark is held so the world never
   * slides out from under the grabbed body.
   */
  step(dt: number): { grab: ArenaGrab | null; panX: number; panY: number };
  /** Remove every listener this attached. */
  dispose(): void;
}

/**
 * Pointer control for the arena. Owns all interaction state in a plain
 * closure (no React state → no re-renders) and feeds the scene:
 *
 * - pointerdown near a mark grabs it — the nearest body within its pick
 *   radius — and the grab offset keeps the mark from jumping to the cursor.
 * - while held, the body kinematically follows the pointer projected onto
 *   the z=0 plane; its velocity tracks a smoothed world-space pointer
 *   velocity, so pointerup throws with whatever speed the drag had.
 * - pointercancel (or a still press) releases without a fling.
 * - hovering without a grab eases a small camera pan toward the cursor and
 *   shows the grab cursor only while a mark is actually under the pointer.
 */
function attachArenaInteraction(
  canvas: HTMLCanvasElement,
  arena: ArenaSceneApi,
): ArenaPointer {
  const grab = {
    active: false,
    moved: false, // any pointermove since the previous step()
    id: -1,
    body: -1,
    offX: 0, // body center minus pointer, captured at grab time
    offY: 0,
    x: 0, // pointer position in world units (z=0 plane)
    y: 0,
    vx: 0, // EMA of pointer velocity, world units/s → the throw
    vy: 0,
    t: 0, // last move event timestamp (ms)
  };
  const hover = { inside: false, nx: 0, ny: 0, panX: 0, panY: 0 };

  /** Pointer event -> canvas NDC (-1..1, y up). */
  const toNdc = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    const nx = clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1);
    const ny = clamp(1 - ((e.clientY - r.top) / Math.max(1, r.height)) * 2, -1, 1);
    return [nx, ny] as const;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (grab.active) return; // one pointer drives one mark
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [nx, ny] = toNdc(e);
    const [wx, wy] = arena.ndcToWorld(nx, ny);
    const hit = arena.pick(wx, wy);
    if (!hit) return; // empty space — don't capture, don't preventDefault
    grab.active = true;
    grab.moved = false;
    grab.id = e.pointerId;
    grab.body = hit.body;
    grab.offX = hit.offsetX;
    grab.offY = hit.offsetY;
    grab.x = wx;
    grab.y = wy;
    grab.vx = 0;
    grab.vy = 0;
    grab.t = e.timeStamp;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Pointer may already be gone (synthetic events) — grab still works.
    }
    canvas.style.cursor = "grabbing";
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (grab.active) {
      if (e.pointerId !== grab.id) return;
      // Fold in coalesced events — fast flicks otherwise lose precision.
      const coalesced =
        typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      const events = coalesced.length > 0 ? coalesced : [e];
      for (const ev of events) {
        const [nx, ny] = toNdc(ev);
        const [wx, wy] = arena.ndcToWorld(nx, ny);
        const dt = Math.max((ev.timeStamp - grab.t) / 1000, 1e-3);
        grab.vx += ((wx - grab.x) / dt - grab.vx) * VEL_EMA;
        grab.vy += ((wy - grab.y) / dt - grab.vy) * VEL_EMA;
        grab.x = wx;
        grab.y = wy;
        grab.t = ev.timeStamp;
      }
      grab.moved = true;
    } else if (e.pointerType !== "touch") {
      // Hover: track NDC for the camera pan and give the grab cursor only
      // when the pointer is actually over a mark.
      const [nx, ny] = toNdc(e);
      hover.nx = nx;
      hover.ny = ny;
      hover.inside = true;
      const [wx, wy] = arena.ndcToWorld(nx, ny);
      canvas.style.cursor = arena.pick(wx, wy) ? "grab" : "";
    }
  };

  const endGrab = (e: PointerEvent, fling: boolean) => {
    if (!grab.active || e.pointerId !== grab.id) return;
    grab.active = false;
    grab.id = -1;
    grab.body = -1;
    if (!fling) {
      grab.vx = 0;
      grab.vy = 0;
    }
    canvas.style.cursor = "grab";
  };
  const onPointerUp = (e: PointerEvent) => endGrab(e, true);
  const onPointerCancel = (e: PointerEvent) => endGrab(e, false);
  // Capture ending without a pointerup (rare) — keep the fling.
  const onLostCapture = (e: PointerEvent) => endGrab(e, true);
  const onPointerLeave = () => {
    hover.inside = false;
  };

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("lostpointercapture", onLostCapture);
  canvas.addEventListener("pointerleave", onPointerLeave);
  // If pointer capture failed, the release can land off-canvas.
  window.addEventListener("pointerup", onPointerUp);

  // Set imperatively (not via the style prop) so the reduced-motion path
  // keeps native touch scrolling and the default cursor.
  canvas.style.touchAction = "none";

  return {
    step(dt: number) {
      if (grab.active && !grab.moved) {
        // Held but not moving: stale velocity bleeds fast so a slow
        // press-and-release doesn't fling.
        const bleed = Math.exp(-STALE_BLEED * dt);
        grab.vx *= bleed;
        grab.vy *= bleed;
      }
      grab.moved = false;

      // Camera pan eases toward the hover target; suppressed while a mark
      // is held so the picked point stays glued to the pointer.
      const k = 1 - Math.exp(-PAN_EASE * dt);
      const tx = !grab.active && hover.inside ? hover.nx * ARENA_PAN.x : 0;
      const ty = !grab.active && hover.inside ? hover.ny * ARENA_PAN.y : 0;
      hover.panX += (tx - hover.panX) * k;
      hover.panY += (ty - hover.panY) * k;

      return {
        grab: grab.active
          ? {
              body: grab.body,
              x: grab.x + grab.offX,
              y: grab.y + grab.offY,
              vx: grab.vx,
              vy: grab.vy,
            }
          : null,
        panX: hover.panX,
        panY: hover.panY,
      };
    },
    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("lostpointercapture", onLostCapture);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerup", onPointerUp);
      canvas.style.touchAction = "";
      canvas.style.cursor = "";
    },
  };
}

/**
 * The Devin mark and the OpenCode "O" drifting and colliding inside a
 * shared invisible box — grab one and throw it.
 *
 * - No WebGPU (or init/compile failure) → renders `fallback ?? null`.
 * - `prefers-reduced-motion` → one static frame of the opening state, no
 *   animation loop, no pointer handlers, native touch scrolling.
 * - Otherwise: canvas fills its parent, cursor is grab/grabbing over a
 *   mark, and the camera pans a touch toward the resting pointer.
 * - Strict-mode safe: the effect removes every listener it adds.
 */
export function ArenaScene({
  className,
  fallback,
}: {
  className?: string;
  fallback?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let gpu: Gpu | undefined;
    let loop: FrameLoopHandle | undefined;
    let unsubscribeResize: (() => void) | undefined;
    let pointer: ArenaPointer | undefined;
    let stillRaf = 0;

    /** Stop the loop, drop the gpu, and switch to the fallback once. */
    function fail() {
      loop?.stop();
      loop = undefined;
      cancelAnimationFrame(stillRaf);
      pointer?.dispose();
      pointer = undefined;
      unsubscribeResize?.();
      unsubscribeResize = undefined;
      gpu?.dispose();
      gpu = undefined;
      if (!disposed) setFailed(true);
    }

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    void (async () => {
      // Async boundary: keeps the unsupported check out of the effect body
      // (synchronous setState in effects is disallowed) while staying cheap.
      await Promise.resolve();
      if (disposed) return;
      if (typeof navigator === "undefined" || !("gpu" in navigator)) {
        setFailed(true);
        return;
      }

      let g: Gpu;
      try {
        g = await init();
      } catch {
        fail();
        return;
      }
      gpu = g;
      if (disposed) {
        g.dispose();
        return;
      }

      try {
        const canvasSurface = surface(g, canvas, {
          dpr: [1, 2],
          alphaMode: "premultiplied",
        });
        const arena = createArenaScene(g, { size: canvasSurface.size });
        const time = clock(g);

        if (reduced) {
          // Single static frame of the opening state; re-render once after
          // any later resize. Deliberately non-interactive: no pointer
          // handlers are attached, so reduced-motion users get a still
          // arena with default cursors and native touch scrolling.
          const renderStill = () =>
            frame(g, (f) => arena.render(f, canvasSurface));
          unsubscribeResize = canvasSurface.onResize(({ width, height }) => {
            arena.resize([width, height]);
            cancelAnimationFrame(stillRaf);
            stillRaf = requestAnimationFrame(renderStill);
          });
          renderStill();
        } else {
          pointer = attachArenaInteraction(canvas, arena);
          unsubscribeResize = canvasSurface.onResize(({ width, height }) => {
            arena.resize([width, height]);
          });
          loop = frameLoop(g, (f) => {
            // Clamp dt so a backgrounded tab can't slingshot the bodies.
            const dt = clamp(time.deltaTime, 0, 0.05) || 1 / 60;
            const input = pointer?.step(dt) ?? {
              grab: null,
              panX: 0,
              panY: 0,
            };
            arena.step(dt, input.grab);
            arena.render(f, canvasSurface, {
              panX: input.panX,
              panY: input.panY,
            });
          });
        }
      } catch {
        fail();
      }
    })();

    return () => {
      disposed = true;
      pointer?.dispose();
      cancelAnimationFrame(stillRaf);
      unsubscribeResize?.();
      loop?.stop();
      gpu?.dispose(); // disposes the surface and every owned resource
    };
  }, []);

  if (failed) return <>{fallback ?? null}</>;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
      aria-hidden="true"
    />
  );
}
