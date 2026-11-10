"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/useIsMobile";
import MonoLabel from "./ui/MonoLabel";

/**
 * 프로필 사진 자르기.
 *
 * 라이브러리 없이 canvas 하나로 끝낸다 — 한 손가락/드래그로 옮기고, 크기는
 * PC에서 슬라이더로, 모바일에서 두 손가락 핀치로 조절해서, 프로필 사진 칸과 같은
 * 132:152 비율로 잘라 낸다. 결과물은 그 비율의 작은 JPEG 한 장이라 Storage에
 * 얹는 부담이 거의 없다.
 *
 * Pointer Events 는 터치 손가락마다 별도 pointerId 를 주므로, 지금 눌린
 * 포인터 수로 한 손가락(이동)과 두 손가락(확대)을 구분한다.
 */

const ASPECT = 132 / 152;
const VIEW_W = 208;
const VIEW_H = Math.round(VIEW_W / ASPECT);
// 화면보다 조금 더 선명하게 뽑아 두되, 파일은 작게 유지한다.
const OUTPUT_W = 364;
const OUTPUT_H = Math.round(OUTPUT_W / ASPECT);

type Point = { x: number; y: number };

export default function AvatarCropper({
  file,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  file: File;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const isMobile = useIsMobile();
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  // 지금 눌려 있는 포인터들(손가락/마우스). 1개면 이동, 2개면 핀치.
  const pointers = useRef<Map<number, Point>>(new Map());
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    setNatural(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const coverScale = useMemo(() => {
    if (!natural) return 1;
    return Math.max(VIEW_W / natural.w, VIEW_H / natural.h);
  }, [natural]);

  const scale = coverScale * zoom;
  const dispW = natural ? natural.w * scale : 0;
  const dispH = natural ? natural.h * scale : 0;
  const maxOffX = Math.max(0, (dispW - VIEW_W) / 2);
  const maxOffY = Math.max(0, (dispH - VIEW_H) / 2);

  const clamp = (o: Point): Point => ({
    x: Math.min(maxOffX, Math.max(-maxOffX, o.x)),
    y: Math.min(maxOffY, Math.max(-maxOffY, o.y)),
  });

  // 줌이 바뀌면 경계도 바뀌므로, 지금 위치가 새 경계를 벗어났으면 당겨온다.
  useEffect(() => {
    setOffset((o) => clamp(o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, natural]);

  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: dist(a, b), zoom };
      pan.current = null;
    } else {
      pan.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = Array.from(pointers.current.values());
      const next = (pinch.current.zoom * dist(a, b)) / pinch.current.dist;
      setZoom(Math.min(3, Math.max(1, next)));
      return;
    }

    if (pointers.current.size === 1 && pan.current) {
      const dx = e.clientX - pan.current.x;
      const dy = e.clientY - pan.current.y;
      setOffset(clamp({ x: pan.current.ox + dx, y: pan.current.oy + dy }));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);

    if (pointers.current.size < 2) pinch.current = null;

    if (pointers.current.size === 1) {
      const remaining = Array.from(pointers.current.values())[0];
      pan.current = {
        x: remaining.x,
        y: remaining.y,
        ox: offset.x,
        oy: offset.y,
      };
    } else {
      pan.current = null;
    }
  }

  const imgLeft = VIEW_W / 2 - dispW / 2 + offset.x;
  const imgTop = VIEW_H / 2 - dispH / 2 + offset.y;

  function confirm() {
    if (!imgRef.current || !natural || busy) return;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_W;
    canvas.height = OUTPUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sx = Math.min(natural.w, Math.max(0, -imgLeft / scale));
    const sy = Math.min(natural.h, Math.max(0, -imgTop / scale));
    const sW = Math.min(natural.w - sx, VIEW_W / scale);
    const sH = Math.min(natural.h - sy, VIEW_H / scale);

    ctx.drawImage(imgRef.current, sx, sy, sW, sH, 0, 0, OUTPUT_W, OUTPUT_H);
    canvas.toBlob((blob) => blob && onConfirm(blob), "image/jpeg", 0.86);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="border-line w-full max-w-xs border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
          <MonoLabel>사진 자르기</MonoLabel>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
          >
            닫기
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 p-4">
          <div
            className="border-line relative touch-none select-none overflow-hidden border bg-bg-0"
            style={{ width: VIEW_W, height: VIEW_H }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const t = e.currentTarget;
                  setNatural({ w: t.naturalWidth, h: t.naturalHeight });
                }}
                className="absolute left-0 top-0 max-w-none cursor-move"
                style={
                  natural
                    ? {
                        width: dispW,
                        height: dispH,
                        transform: `translate(${imgLeft}px, ${imgTop}px)`,
                      }
                    : { visibility: "hidden" }
                }
              />
            )}
          </div>

          {!isMobile && (
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              disabled={!natural || busy}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="accent-brass w-full"
              aria-label="확대"
            />
          )}

          <p className="body-15 text-fg-low text-center">
            {isMobile
              ? "끌어서 위치를 잡고, 두 손가락으로 벌리거나 좁혀 크기를 맞춰 주세요."
              : "끌어서 위치를 잡고, 슬라이더로 크기를 맞춰 주세요."}
          </p>

          {error && <p className="mono-13 text-loss">{error}</p>}

          <div className="flex w-full gap-2">
            <button
              type="button"
              disabled={!natural || busy}
              onClick={confirm}
              className="state-fade label-11 border-brass-line flex-1 border bg-brass-fill px-3 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
            >
              {busy ? "올리는 중…" : "등록"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="label-11 state-fade border-line border bg-surface px-3 py-2.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
