"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clock, frame, frameLoop, init, surface } from "vgpu";
import type { FrameLoopHandle, Gpu } from "vgpu";
import { createBrainScene } from "./scene";
import type { BrainInteraction } from "./scene";

/* ------------------------------------------------------------------ */
/* Pointer interaction                                                  */
/* ------------------------------------------------------------------ */

const PITCH_LIMIT = 0.5; // max orbit pitch, rad (~±29°)
const DRAG_RAD_PER_PX = 0.0062; // orbit sensitivity
const TILT_YAW = 0.07; // hover parallax amplitude, rad (~4°)
const TILT_PITCH = 0.05; // (~3°)
const TILT_EASE = 7; // 1/s approach rate toward the hovered tilt
const SPRING_K = 9; // pull back to neutral after release (underdamped)
const SPRING_C = 4.4;
const VEL_LIMIT = 4; // fling cap, rad/s
const PULSE_BOOST = 1.8; // extra pulse phase per second at full drag (~2.8x)

interface BrainPointer {
  /** Advance the interaction sim by `dt` seconds; returns pose for the frame. */
  step(dt: number): BrainInteraction;
  /** Remove every listener this attached. */
  dispose(): void;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);
const wrapPi = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));

/**
 * Orbit-style pointer control for the brain graph. Owns all interaction
 * state in a plain closure (no React state → no re-renders) and hands the
 * scene a pose per frame:
 *
 * - drag: yaw is unbounded, pitch is clamped to ±PITCH_LIMIT. Velocity is
 *   tracked from coalesced pointer events for a natural release fling.
 * - release: an underdamped spring keeps the fling (inertia), then eases
 *   yaw/pitch back to zero — i.e. into the auto-turntable, which keeps
 *   running underneath, so the graph never stops dead. Yaw is wrapped to
 *   (-π, π] on release so the spring takes the short way home.
 * - hover (no drag): a few degrees of eased parallax tilt toward the cursor.
 * - dragging also feeds `pulsePhase`, speeding the traveling pulses up to
 *   ~2.8x so the graph visibly reacts while grabbed.
 */
function attachBrainInteraction(canvas: HTMLCanvasElement): BrainPointer {
  const drag = {
    active: false,
    moved: false, // any pointermove since the previous step()
    id: -1,
    x: 0,
    y: 0,
    t: 0, // last move event timestamp (ms)
    yaw: 0,
    pitch: 0,
    vYaw: 0,
    vPitch: 0,
  };
  const hover = { inside: false, x: 0, y: 0, yaw: 0, pitch: 0 };
  let pulsePhase = 0;
  let pulseBoost = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag.active) return;
    drag.active = true;
    drag.moved = false;
    drag.id = e.pointerId;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    drag.vYaw = 0;
    drag.vPitch = 0;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Pointer may already be gone (e.g. OS gesture stole it) — drag state
      // is consistent regardless, capture just improves tracking.
    }
    canvas.style.cursor = "grabbing";
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag.active) {
      if (e.pointerId !== drag.id) return;
      // Fold in coalesced events — fast flicks otherwise lose precision.
      const coalesced =
        typeof e.getCoalescedEvents === "function"
          ? e.getCoalescedEvents()
          : [];
      const events = coalesced.length > 0 ? coalesced : [e];
      let dx = 0;
      let dy = 0;
      for (const ev of events) {
        dx += ev.clientX - drag.x;
        dy += ev.clientY - drag.y;
        drag.x = ev.clientX;
        drag.y = ev.clientY;
      }
      const last = events[events.length - 1];
      const dtc = Math.max((last.timeStamp - drag.t) / 1000, 1e-3);
      drag.t = last.timeStamp;
      drag.moved = true;

      const dYaw = dx * DRAG_RAD_PER_PX;
      const dPitch = dy * DRAG_RAD_PER_PX;
      drag.yaw += dYaw;
      drag.pitch = clamp(drag.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);

      // Smoothed velocity → release fling.
      const a = 0.45;
      drag.vYaw = clamp(
        drag.vYaw * (1 - a) + (dYaw / dtc) * a,
        -VEL_LIMIT,
        VEL_LIMIT,
      );
      drag.vPitch = clamp(
        drag.vPitch * (1 - a) + (dPitch / dtc) * a,
        -VEL_LIMIT,
        VEL_LIMIT,
      );
    } else {
      const r = canvas.getBoundingClientRect();
      hover.x = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
      hover.y = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1;
      hover.inside = true;
    }
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (!drag.active || e.pointerId !== drag.id) return;
    drag.active = false;
    drag.id = -1;
    drag.yaw = wrapPi(drag.yaw); // short way home for the spring
    canvas.style.cursor = "grab";
    try {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // capture may already be gone — safe to ignore
    }
  };

  const onPointerLeave = () => {
    hover.inside = false;
  };

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("pointerleave", onPointerLeave);

  return {
    step(dtRaw: number): BrainInteraction {
      const dt = clamp(dtRaw, 0, 0.1); // ignore huge deltas (tab refocus)
      if (drag.active) {
        // Pointer held but not moving bleeds stale velocity quickly, so a
        // slow press-and-release doesn't fling.
        if (!drag.moved) {
          const bleed = Math.exp(-10 * dt);
          drag.vYaw *= bleed;
          drag.vPitch *= bleed;
        }
      } else {
        // Inertia then ease back: underdamped spring toward neutral.
        drag.vYaw += (-SPRING_K * drag.yaw - SPRING_C * drag.vYaw) * dt;
        drag.vPitch += (-SPRING_K * drag.pitch - SPRING_C * drag.vPitch) * dt;
        drag.yaw += drag.vYaw * dt;
        drag.pitch += drag.vPitch * dt;
        if (Math.abs(drag.yaw) < 1e-4 && Math.abs(drag.vYaw) < 1e-4) {
          drag.yaw = 0;
          drag.vYaw = 0;
        }
        if (Math.abs(drag.pitch) < 1e-4 && Math.abs(drag.vPitch) < 1e-4) {
          drag.pitch = 0;
          drag.vPitch = 0;
        }
      }
      drag.moved = false;

      // Hover parallax — suppressed while dragging.
      const tiltK = 1 - Math.exp(-TILT_EASE * dt);
      const tiltYawT = !drag.active && hover.inside ? hover.x * TILT_YAW : 0;
      const tiltPitchT =
        !drag.active && hover.inside ? hover.y * TILT_PITCH : 0;
      hover.yaw += (tiltYawT - hover.yaw) * tiltK;
      hover.pitch += (tiltPitchT - hover.pitch) * tiltK;

      // Pulses speed up while the graph is grabbed, easing in and out so
      // their motion never jumps.
      pulseBoost +=
        ((drag.active ? 1 : 0) - pulseBoost) * (1 - Math.exp(-6 * dt));
      pulsePhase += dt * pulseBoost * PULSE_BOOST;

      return {
        yaw: drag.yaw + hover.yaw,
        pitch: clamp(drag.pitch + hover.pitch, -PITCH_LIMIT, PITCH_LIMIT),
        pulsePhase,
      };
    },
    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.style.cursor = "grab";
    },
  };
}

/**
 * Mounts the grayscale 3D node-graph on a canvas that fills its parent.
 *
 * - No WebGPU (or init/compile failure) → renders `fallback ?? null`.
 * - `prefers-reduced-motion` → one static frame, no animation loop, and no
 *   pointer interaction (deliberate: reduced motion means no motion, not
 *   "motion only when grabbed").
 * - Otherwise: drag orbits the graph with inertia and a spring back to the
 *   auto-turntable; resting the pointer adds a few degrees of parallax
 *   tilt; pulses speed up while dragged. Cursor: `grab` → `grabbing`.
 * - Strict-mode safe: the effect removes every listener it adds.
 */
export function BrainScene({
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
    const nav =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { gpu?: unknown });

    let disposed = false;
    let gpu: Gpu | undefined;
    let loop: FrameLoopHandle | undefined;
    let offResize: (() => void) | undefined;
    let pointer: BrainPointer | undefined;

    void (async () => {
      try {
        if (!nav?.gpu) throw new Error("WebGPU unavailable");
        gpu = await init();
        if (disposed) {
          gpu.dispose();
          return;
        }
        const canvasSurface = surface(gpu, canvas, { dpr: [1, 2] });
        const brain = await createBrainScene(gpu, { size: canvasSurface.size });
        if (disposed) {
          gpu.dispose();
          return;
        }
        offResize = canvasSurface.onResize(({ width, height }) => {
          brain.resize([width, height]);
        });
        const time = clock(gpu);
        const reduced =
          typeof matchMedia === "function" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (reduced) {
          // Single still frame — no loop, no interaction.
          frame(gpu, (f) => brain.render(f, canvasSurface, 9));
        } else {
          pointer = attachBrainInteraction(canvas);
          loop = frameLoop(gpu, (f) => {
            brain.render(
              f,
              canvasSurface,
              time.time,
              pointer?.step(time.deltaTime),
            );
          });
        }
      } catch {
        gpu?.dispose();
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      loop?.stop();
      offResize?.();
      pointer?.dispose();
      gpu?.dispose(); // disposes the surface and every owned resource
    };
  }, []);

  if (failed) return <>{fallback ?? null}</>;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        cursor: "grab",
        // Touch drags rotate the graph instead of scrolling the page.
        touchAction: "none",
      }}
    />
  );
}
