"use client";

import { useEffect, useRef, useState } from "react";
import { clock, frame, frameLoop, init, surface } from "vgpu";
import type { FrameLoopHandle, Gpu } from "vgpu";
import {
  OPENCODE_MARK,
  OPENCODE_OMEGA,
  createOpenCodeMarkScene,
} from "./scene";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Interaction tuning (radians / rad-per-second).
 *
 * Drag: horizontal movement adds free turntable yaw (~0.9 turn across the
 * canvas width), vertical movement adds camera-space pitch clamped to
 * ±DRAG_PITCH so the mark tips but never flips over.
 */
const DRAG_PITCH = 0.5;
const DRAG_TURN = Math.PI * 1.8; // rad of yaw per full-width drag
/** Hover parallax: subtle eased lean toward the cursor (mouse/pen only). */
const HOVER_PITCH = 0.05;
const HOVER_YAW = 0.09;
/**
 * Loose-insert lag: the inner bar counter-rotates/shifts a touch while the
 * ring is dragged. Capped well under the scene's documented limits
 * (|bar| ≤ 0.07 rad, |shift| ≤ 0.015) so the bar stays buried in the ring.
 */
const BAR_LAG = 0.022;
const BAR_LAG_MAX = 0.07;
const BAR_SHIFT = 0.0022;
const BAR_SHIFT_MAX = 0.012;

/**
 * Mutable interaction state fed to `mark.encode()` every frame. Every
 * offset decays back to zero on its own, so releasing the pointer always
 * hands control back to the turntable without a snap.
 */
interface Interaction {
  dragging: boolean;
  pointerId: number;
  lastX: number;
  lastY: number;
  lastT: number;
  /** Drag offsets: free yaw, pitch clamped to ±DRAG_PITCH. */
  spinY: number;
  tiltX: number;
  /** Release velocity in rad/s (EMA of recent drag speed) — drives the fling. */
  velY: number;
  velX: number;
  /** Hover parallax: target angles and eased current values. */
  hoverTX: number;
  hoverTY: number;
  hoverX: number;
  hoverY: number;
  /** Loose-insert lag on the inner bar (eased toward the velocity targets). */
  barX: number;
  barY: number;
  barDX: number;
  barDY: number;
  /** Turntable weight 0..1 — dips while the mark is held, ramps back after. */
  turn: number;
  /** Integrated turntable yaw; starts where the static render starts. */
  phase: number;
}

function createInteraction(): Interaction {
  return {
    dragging: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    spinY: 0,
    tiltX: 0,
    velY: 0,
    velX: 0,
    hoverTX: 0,
    hoverTY: 0,
    hoverX: 0,
    hoverY: 0,
    barX: 0,
    barY: 0,
    barDX: 0,
    barDY: 0,
    turn: 1,
    phase: OPENCODE_MARK.startAngle,
  };
}

/**
 * 3D extruded OpenCode "O" — a WebGPU turntable that floats on the page
 * (transparent background, meant to sit over paper).
 *
 * Interactive: drag to spin/pitch it (with inertia on release and an ease
 * back to the turntable), hover for a subtle parallax lean, and the inner
 * bar trails the ring a touch while dragged — a loose-insert feel.
 *
 * Falls back to `fallback` (or nothing) when WebGPU is unavailable or init
 * fails. Under `prefers-reduced-motion` it renders a single static,
 * non-interactive frame at the opening angle — interaction is itself
 * motion, so the reduced-motion path attaches no pointer handlers at all.
 */
export function OpenCodeMark({
  className,
  fallback,
}: {
  className?: string;
  fallback?: React.ReactNode;
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
    let removePointerListeners: (() => void) | undefined;
    let stillRaf = 0;

    /** Stop the loop, drop the gpu, and switch to the fallback once. */
    function fail() {
      loop?.stop();
      loop = undefined;
      cancelAnimationFrame(stillRaf);
      removePointerListeners?.();
      removePointerListeners = undefined;
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
        const mark = createOpenCodeMarkScene(g, { size: canvasSurface.size });
        const time = clock(g);

        if (reduced) {
          // Single static frame; re-render once after any later resize.
          // Deliberately non-interactive: no pointer handlers are attached,
          // so reduced-motion users get a still mark with default cursors
          // and native touch scrolling.
          const renderStill = () =>
            frame(g, (f) => mark.encode(f, canvasSurface, OPENCODE_MARK.startAngle));
          unsubscribeResize = canvasSurface.onResize(({ width, height }) => {
            mark.setSize(width, height);
            cancelAnimationFrame(stillRaf);
            stillRaf = requestAnimationFrame(renderStill);
          });
          renderStill();
        } else {
          const it = createInteraction();

          const onPointerDown = (e: PointerEvent) => {
            if (it.dragging) return; // one pointer drives the mark
            if (e.pointerType === "mouse" && e.button !== 0) return;
            it.dragging = true;
            it.pointerId = e.pointerId;
            it.lastX = e.clientX;
            it.lastY = e.clientY;
            it.lastT = e.timeStamp;
            // Fresh grab: the fling restarts from this drag's velocity.
            it.velY = 0;
            it.velX = 0;
            try {
              canvas.setPointerCapture(e.pointerId);
            } catch {
              // Pointer already gone (synthetic events) — drag still works.
            }
            canvas.style.cursor = "grabbing";
            e.preventDefault();
          };

          const onPointerMove = (e: PointerEvent) => {
            if (it.dragging && e.pointerId === it.pointerId) {
              const rect = canvas.getBoundingClientRect();
              const ky = DRAG_TURN / Math.max(1, rect.width);
              const kx = (DRAG_PITCH * 2.4) / Math.max(1, rect.height);
              const dx = e.clientX - it.lastX;
              const dy = e.clientY - it.lastY;
              it.spinY += dx * ky;
              it.tiltX = clamp(it.tiltX + dy * kx, -DRAG_PITCH, DRAG_PITCH);
              // Track release velocity as an EMA of per-event drag speed.
              const dt = Math.max(1, e.timeStamp - it.lastT) / 1000;
              it.velY += ((dx * ky) / dt - it.velY) * 0.35;
              it.velX += ((dy * kx) / dt - it.velX) * 0.35;
              it.lastX = e.clientX;
              it.lastY = e.clientY;
              it.lastT = e.timeStamp;
            } else if (e.pointerType !== "touch") {
              // Hover parallax: lean gently toward the cursor position.
              const rect = canvas.getBoundingClientRect();
              const nx = clamp(
                ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
                -1,
                1,
              );
              const ny = clamp(
                ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1,
                -1,
                1,
              );
              it.hoverTY = nx * HOVER_YAW;
              it.hoverTX = ny * HOVER_PITCH;
            }
          };

          const endDrag = (e: PointerEvent, fling: boolean) => {
            if (!it.dragging || e.pointerId !== it.pointerId) return;
            it.dragging = false;
            it.pointerId = -1;
            if (!fling) {
              it.velY = 0;
              it.velX = 0;
            }
            canvas.style.cursor = "grab";
          };
          const onPointerUp = (e: PointerEvent) => endDrag(e, true);
          const onPointerCancel = (e: PointerEvent) => endDrag(e, false);
          // Capture ending without a pointerup (rare) — keep the fling.
          const onLostCapture = (e: PointerEvent) => endDrag(e, true);
          const onPointerLeave = () => {
            it.hoverTX = 0;
            it.hoverTY = 0;
          };

          canvas.addEventListener("pointerdown", onPointerDown);
          canvas.addEventListener("pointermove", onPointerMove);
          canvas.addEventListener("pointerup", onPointerUp);
          canvas.addEventListener("pointercancel", onPointerCancel);
          canvas.addEventListener("lostpointercapture", onLostCapture);
          canvas.addEventListener("pointerleave", onPointerLeave);
          // Set imperatively (not via the style prop) so the reduced-motion
          // path keeps native touch scrolling and the default cursor.
          canvas.style.touchAction = "none";
          canvas.style.cursor = "grab";
          removePointerListeners = () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerCancel);
            canvas.removeEventListener("lostpointercapture", onLostCapture);
            canvas.removeEventListener("pointerleave", onPointerLeave);
            canvas.style.touchAction = "";
            canvas.style.cursor = "";
          };

          unsubscribeResize = canvasSurface.onResize(({ width, height }) => {
            mark.setSize(width, height);
          });
          loop = frameLoop(g, (f) => {
            // Clamp dt so a backgrounded tab can't slingshot the mark.
            const dt = clamp(time.deltaTime, 0, 0.05);

            // Turntable pauses while held, ramps back up on release — the
            // mark never snaps back mid-flight, it eases onto the turn path.
            it.turn +=
              ((it.dragging ? 0 : 1) - it.turn) *
              Math.min(1, dt * (it.dragging ? 10 : 1.6));
            it.phase += OPENCODE_OMEGA * dt * it.turn;

            if (!it.dragging) {
              // Inertia: integrate the release velocity, bleed it off with
              // friction, then pull the remaining offset back to the
              // turntable (slower than the friction, so a fling reads first).
              it.spinY += it.velY * dt;
              it.tiltX = clamp(it.tiltX + it.velX * dt, -DRAG_PITCH, DRAG_PITCH);
              const friction = Math.exp(-dt * 3.2);
              it.velY *= friction;
              it.velX *= friction;
              it.spinY *= Math.exp(-dt * 1.4);
              it.tiltX *= Math.exp(-dt * 2.2);
            }

            // Hover parallax eases toward its target; suppressed while held.
            if (it.dragging) {
              it.hoverTX = 0;
              it.hoverTY = 0;
            }
            const ease = Math.min(1, dt * 7);
            it.hoverX += (it.hoverTX - it.hoverX) * ease;
            it.hoverY += (it.hoverTY - it.hoverY) * ease;

            // Loose insert: the bar trails the current drag velocity a
            // touch — while held and through the fling — then recenters.
            const lag = Math.min(1, dt * 6);
            it.barY += (clamp(-it.velY * BAR_LAG, -BAR_LAG_MAX, BAR_LAG_MAX) - it.barY) * lag;
            it.barX += (clamp(it.velX * BAR_LAG, -BAR_LAG_MAX, BAR_LAG_MAX) - it.barX) * lag;
            it.barDX +=
              (clamp(-it.velY * BAR_SHIFT, -BAR_SHIFT_MAX, BAR_SHIFT_MAX) - it.barDX) * lag;
            it.barDY +=
              (clamp(it.velX * BAR_SHIFT, -BAR_SHIFT_MAX, BAR_SHIFT_MAX) - it.barDY) * lag;

            mark.encode(f, canvasSurface, it.phase, {
              tiltX: it.tiltX + it.hoverX,
              tiltY: it.hoverY,
              spinY: it.spinY,
              barX: it.barX,
              barY: it.barY,
              barDX: it.barDX,
              barDY: it.barDY,
            });
          });
        }
      } catch {
        fail();
      }
    })();

    return () => {
      disposed = true;
      removePointerListeners?.();
      cancelAnimationFrame(stillRaf);
      unsubscribeResize?.();
      loop?.stop();
      gpu?.dispose();
    };
  }, []);

  if (failed) return <>{fallback ?? null}</>;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
      role="img"
      aria-label="OpenCode logo"
    />
  );
}
