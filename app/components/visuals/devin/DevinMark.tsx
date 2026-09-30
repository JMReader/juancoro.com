"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clock, frame, frameLoop, init, surface } from "vgpu";
import type { FrameLoopHandle } from "vgpu";
import {
  createDevinMarkScene,
  START_ANGLE,
  TURNTABLE_SPEED,
} from "./scene";

/** Radians of spin per pixel of pointer travel while dragging. */
const DRAG_SENSITIVITY = 0.009;
/** Drag pitch clamp — the mark never tips past ~29° toward/away. */
const PITCH_LIMIT = 0.5;
/** Release fling cap (rad/s) so a fast flick stays controllable. */
const MAX_FLING_SPEED = 8;
/** Damped spring returning drag offsets to the bare turntable after release. */
const SPRING_STIFFNESS = 16;
const SPRING_DAMPING = 6;
/** Hover parallax: max eased tilt (rad) when the cursor reaches an edge. */
const HOVER_YAW_MAX = 0.14;
const HOVER_PITCH_MAX = 0.1;
/** Exponential ease rate (1/s) for the hover tilt — settles in ~0.5s. */
const HOVER_EASE = 5;

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * 3D extruded Devin mark on a transparent WebGPU canvas. The canvas fills its
 * parent; when WebGPU is unavailable or init fails it renders `fallback`.
 */
export function DevinMark({
  className,
  fallback,
}: {
  className?: string;
  fallback?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

    void (async () => {
      let gpu: Awaited<ReturnType<typeof init>>;
      try {
        // `navigator.gpu` is the WebGPU entry point (not yet in DOM types).
        if (
          typeof navigator === "undefined" ||
          !(navigator as Navigator & { gpu?: unknown }).gpu
        ) {
          throw new Error("WebGPU unavailable");
        }
        gpu = await init();
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed) {
        gpu.dispose();
        return;
      }

      try {
        const scene = createDevinMarkScene(gpu);
        const canvasSurface = surface(gpu, canvas, { dpr: [1, 2] });

        const syncSize = () => {
          const [w, h] = canvasSurface.size;
          scene.resize(Math.max(1, w), Math.max(1, h));
        };

        const reduced =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        let handle: FrameLoopHandle | undefined;
        let raf = 0;
        const renderOnce = () =>
          frame(gpu, (f) => scene.encode(f, canvasSurface, START_ANGLE));

        // Surface size changes -> resize the depth target; in reduced-motion
        // mode also re-render one frame (frame() must run outside this
        // callback, hence the rAF hop).
        const offResize = canvasSurface.onResize(() => {
          syncSize();
          if (reduced && !disposed) {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
              if (!disposed) renderOnce();
            });
          }
        });
        syncSize();

        // Assigned in the animated branch below; noop under reduced motion
        // where no listeners were ever attached.
        let removePointerListeners: (() => void) | undefined;

        if (reduced) {
          // Reduced motion: one static frame and no pointer handlers — the
          // mark stays put even when dragged.
          renderOnce();
        } else {
          // --- Desk-object interaction -----------------------------------
          // Primary-button drag spins the prism: yaw follows x, pitch follows
          // y (clamped to ±PITCH_LIMIT). On release the pose coasts on its
          // fling velocity, then an under-damped spring pulls both offsets to
          // zero so the bare turntable resumes without a snap. Hovering
          // without a drag adds a small eased parallax tilt toward the cursor.
          let dragging = false;
          let dragYaw = 0;
          let dragPitch = 0;
          let yawVel = 0;
          let pitchVel = 0;
          let lastX = 0;
          let lastY = 0;
          let lastMoveT = 0;
          let hovering = false;
          // Cursor position in canvas NDC (-1..1) + the eased tilt applied.
          let hoverX = 0;
          let hoverY = 0;
          let hoverYaw = 0;
          let hoverPitch = 0;

          const trackHover = (e: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              hoverX = clamp(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -1,
                1,
              );
              hoverY = clamp(
                ((e.clientY - rect.top) / rect.height) * 2 - 1,
                -1,
                1,
              );
            }
          };

          const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0 || !e.isPrimary || dragging) return;
            dragging = true;
            hovering = false; // the drag owns the pose; hover tilt eases out
            lastX = e.clientX;
            lastY = e.clientY;
            lastMoveT = e.timeStamp;
            yawVel = 0;
            pitchVel = 0;
            try {
              canvas.setPointerCapture(e.pointerId);
            } catch {
              // Pointer already gone — the drag still works without capture.
            }
            canvas.style.cursor = "grabbing";
            e.preventDefault();
          };

          const onPointerMove = (e: PointerEvent) => {
            if (!e.isPrimary) return;
            if (dragging) {
              const dx = e.clientX - lastX;
              const dy = e.clientY - lastY;
              lastX = e.clientX;
              lastY = e.clientY;
              dragYaw += dx * DRAG_SENSITIVITY;
              dragPitch = clamp(
                dragPitch + dy * DRAG_SENSITIVITY,
                -PITCH_LIMIT,
                PITCH_LIMIT,
              );
              const moveDt = (e.timeStamp - lastMoveT) / 1000;
              lastMoveT = e.timeStamp;
              if (moveDt > 0) {
                // Smoothed instantaneous velocity → the fling at release.
                yawVel += ((dx * DRAG_SENSITIVITY) / moveDt - yawVel) * 0.35;
                pitchVel +=
                  ((dy * DRAG_SENSITIVITY) / moveDt - pitchVel) * 0.35;
              }
            } else {
              hovering = true;
              trackHover(e);
            }
          };

          const endDrag = (e: PointerEvent) => {
            if (!dragging || !e.isPrimary) return;
            dragging = false;
            yawVel = clamp(yawVel, -MAX_FLING_SPEED, MAX_FLING_SPEED);
            pitchVel = clamp(pitchVel, -MAX_FLING_SPEED, MAX_FLING_SPEED);
            try {
              canvas.releasePointerCapture(e.pointerId);
            } catch {
              // Capture may already be released or never taken.
            }
            canvas.style.cursor = "grab";
            // Resume hover parallax from the release point; pointerleave
            // corrects this right away if the release happened off-canvas.
            hovering = true;
            trackHover(e);
          };

          const onPointerLeave = () => {
            hovering = false;
          };

          canvas.addEventListener("pointerdown", onPointerDown);
          canvas.addEventListener("pointermove", onPointerMove);
          canvas.addEventListener("pointerup", endDrag);
          canvas.addEventListener("pointercancel", endDrag);
          canvas.addEventListener("pointerleave", onPointerLeave);
          // If pointer capture failed, the release can land off-canvas.
          window.addEventListener("pointerup", endDrag);

          removePointerListeners = () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", endDrag);
            canvas.removeEventListener("pointercancel", endDrag);
            canvas.removeEventListener("pointerleave", onPointerLeave);
            window.removeEventListener("pointerup", endDrag);
            // Reset in case teardown ran mid-drag.
            canvas.style.cursor = "grab";
          };

          const t = clock(gpu);
          handle = frameLoop(gpu, (f) => {
            // Clamp the frame delta so a backgrounded tab doesn't lurch.
            const dt = clamp(t.deltaTime, 0, 0.05) || 1 / 60;
            if (!dragging) {
              // Semi-implicit Euler: release velocity carries the pose
              // (inertia), the spring decelerates it and pulls back to the
              // pure turntable with a slight settle.
              yawVel +=
                (-SPRING_STIFFNESS * dragYaw - SPRING_DAMPING * yawVel) * dt;
              dragYaw += yawVel * dt;
              pitchVel +=
                (-SPRING_STIFFNESS * dragPitch - SPRING_DAMPING * pitchVel) *
                dt;
              dragPitch = clamp(
                dragPitch + pitchVel * dt,
                -PITCH_LIMIT,
                PITCH_LIMIT,
              );
            }
            const yawTarget =
              hovering && !dragging ? hoverX * HOVER_YAW_MAX : 0;
            const pitchTarget =
              hovering && !dragging ? hoverY * HOVER_PITCH_MAX : 0;
            const ease = 1 - Math.exp(-HOVER_EASE * dt);
            hoverYaw += (yawTarget - hoverYaw) * ease;
            hoverPitch += (pitchTarget - hoverPitch) * ease;

            scene.encode(
              f,
              canvasSurface,
              START_ANGLE + t.time * TURNTABLE_SPEED + dragYaw + hoverYaw,
              dragPitch + hoverPitch,
            );
          });
        }

        teardown = () => {
          cancelAnimationFrame(raf);
          offResize();
          removePointerListeners?.();
          handle?.stop();
          canvasSurface.dispose();
          gpu.dispose();
        };
      } catch {
        gpu.dispose();
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      teardown?.();
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
        // Pointer Events own every gesture — no native scroll/pan hijack.
        touchAction: "none",
        cursor: "grab", // "grabbing" is applied on the element while dragging
      }}
      aria-hidden="true"
    />
  );
}
