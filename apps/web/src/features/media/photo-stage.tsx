'use client';

import { Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import {
  centreOf,
  doubleClickScale,
  fitScale,
  fitView,
  isZoomedIn,
  MAX_SCALE,
  panBy,
  refitView,
  wheelPixels,
  wheelScale,
  ZOOM_STEP,
  zoomTo,
  type Point,
  type Size,
  type ZoomView,
} from './zoom';

interface PhotoStageProps {
  /** An object URL of the photo held in memory. */
  src: string;
  alt: string;
  /** The bytes arrived but would not draw. */
  onBroken: () => void;
}

/** A press that travels further than this is a drag, not a click. */
const CLICK_SLOP_PX = 4;

interface Gesture {
  /** The press began on the dark around the picture, not on it. */
  isOnBackdrop: boolean;
  start: Point;
  hasMoved: boolean;
}

interface Pinch {
  distance: number;
  middle: Point;
}

const distanceOf = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const middleOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A key pressed with a modifier is the browser's (Ctrl + zooms the page), not the photo's. */
const isModified = (event: KeyboardEvent): boolean =>
  event.ctrlKey || event.metaKey || event.altKey;

interface ZoomButtonProps {
  label: string;
  /** Nothing to do from here: marked so, and the focus stays on it. */
  isUnavailable: boolean;
  onPress: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * One button of the zoom bar. Marked unavailable rather than disabled: a
 * disabled button drops the focus it holds, and «По размеру окна» would throw
 * the keyboard out of the viewer the moment it is pressed.
 */
function ZoomButton({ label, isUnavailable, onPress, className, children }: ZoomButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={isUnavailable || undefined}
      onClick={isUnavailable ? undefined : onPress}
      className={cn(
        'inline-flex h-11 min-w-11 items-center justify-center rounded-full hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * A photo that can be looked at closely: the wheel, «+» and «−», fitted and
 * 100 %, a double click, a drag once zoomed in, and on a touch screen two
 * fingers to pinch and one to drag. The keys `+`, `−` and `0` do the same.
 *
 * Fitted is not a zoom: until the manager zooms, the picture is laid out by
 * the browser (`object-contain`) and follows the window's size by itself. A
 * zoom is measured against the stage when it is asked for, and kept on the
 * stage when the window changes size.
 *
 * A press that began on the dark around the picture and did not travel is a
 * click outside it, and goes on to the viewer, which closes; every other
 * press keeps its click to itself — a drag that ends off the picture must not
 * close it.
 */
export function PhotoStage({ src, alt, onBroken }: PhotoStageProps) {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<Size | null>(null);
  const [stage, setStage] = useState<Size | null>(null);
  /** Null while fitted. */
  const [view, setView] = useState<ZoomView | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const pinch = useRef<Pinch | null>(null);

  const measure = (): Size | null => {
    const box = stageRef.current?.getBoundingClientRect();
    return box === undefined ? null : { width: box.width, height: box.height };
  };

  /** A change of the view, from the view as it stands now; a zoom back to fitted is fitted. */
  const change = (make: (current: ZoomView, picture: Size, room: Size) => ZoomView) => {
    const room = measure();
    if (image === null || room === null || room.width === 0 || room.height === 0) {
      return;
    }
    setStage(room);
    setView((current) => {
      const next = make(current ?? fitView(image, room), image, room);
      return isZoomedIn(next, image, room) ? next : null;
    });
  };

  const zoomBy = (factor: number) =>
    change((current, picture, room) =>
      zoomTo(current, current.scale * factor, centreOf(room), picture, room),
    );
  const zoomToActual = () =>
    change((current, picture, room) => zoomTo(current, 1, centreOf(room), picture, room));
  const toLocal = (clientX: number, clientY: number): Point => {
    const box = stageRef.current?.getBoundingClientRect();
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
  };

  const onWheel = useEffectEvent((event: WheelEvent) => {
    // Held, so a trackpad's pinch (a wheel with Ctrl) zooms the photo and not the page.
    event.preventDefault();
    const at = toLocal(event.clientX, event.clientY);
    const travel = wheelPixels(event.deltaY, event.deltaMode, window.innerHeight);
    change((current, picture, room) =>
      zoomTo(current, wheelScale(current.scale, travel), at, picture, room),
    );
  });
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (isModified(event)) {
      return;
    }
    if (event.key === '+' || event.key === '=') {
      zoomBy(ZOOM_STEP);
    } else if (event.key === '-') {
      zoomBy(1 / ZOOM_STEP);
    } else if (event.key === '0') {
      setView(null);
    }
  });
  const onResize = useEffectEvent(() => {
    const room = measure();
    if (image === null || room === null || room.width === 0 || room.height === 0) {
      return;
    }
    setStage(room);
    setView((current) => refitView(current, image, room));
  });

  useEffect(() => {
    const element = stageRef.current;
    if (element === null) {
      return undefined;
    }
    const wheel = (event: WheelEvent) => onWheel(event);
    const key = (event: KeyboardEvent) => onKey(event);
    const resize = () => onResize();
    element.addEventListener('wheel', wheel, { passive: false });
    // Capture, as the viewer's arrows: the dialog keeps keys from reaching the window.
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', resize);
    return () => {
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) {
      gesture.current = {
        isOnBackdrop: event.target === event.currentTarget,
        start: point,
        hasMoved: false,
      };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: distanceOf(a, b), middle: middleOf(a, b) };
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (before === undefined) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    const press = gesture.current;
    if (press !== null && distanceOf(press.start, point) > CLICK_SLOP_PX) {
      gesture.current = { ...press, hasMoved: true };
    }

    const last = pinch.current;
    if (pointers.current.size === 2 && last !== null) {
      const [a, b] = [...pointers.current.values()];
      const now = { distance: distanceOf(a, b), middle: middleOf(a, b) };
      const at = toLocal(now.middle.x, now.middle.y);
      change((current, picture, room) =>
        panBy(
          zoomTo(current, (current.scale * now.distance) / last.distance, at, picture, room),
          now.middle.x - last.middle.x,
          now.middle.y - last.middle.y,
          picture,
          room,
        ),
      );
      pinch.current = now;
      return;
    }
    if (pointers.current.size === 1 && view !== null) {
      setIsDragging(true);
      change((current, picture, room) =>
        panBy(current, point.x - before.x, point.y - before.y, picture, room),
      );
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      pinch.current = null;
    }
    if (pointers.current.size === 0) {
      setIsDragging(false);
    }
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const press = gesture.current;
    if (press === null || !press.isOnBackdrop || press.hasMoved) {
      // Not a click outside the picture: the viewer is not to hear of it.
      event.stopPropagation();
    }
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (gesture.current?.isOnBackdrop === true) {
      return;
    }
    const at = toLocal(event.clientX, event.clientY);
    change((current, picture, room) =>
      zoomTo(current, doubleClickScale(current, picture, room), at, picture, room),
    );
  };

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    setImage({ width: naturalWidth, height: naturalHeight });
    setStage(measure());
  };

  const fit = image === null || stage === null ? 1 : fitScale(image, stage);
  const scale = view?.scale ?? fit;
  const percent = Math.round(scale * 100);
  const isReady = image !== null && image.width > 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={stageRef}
        data-viewer-backdrop=""
        className={cn(
          'relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none',
          view === null ? 'cursor-zoom-in' : isDragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of a private file */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={onLoad}
          onError={onBroken}
          className={cn(
            view === null
              ? 'max-h-full max-w-full object-contain'
              : 'absolute top-0 left-0 max-w-none',
            !isDragging && 'motion-safe:transition-transform motion-safe:duration-150',
          )}
          style={
            view === null || image === null
              ? undefined
              : {
                  width: image.width,
                  height: image.height,
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                  transformOrigin: '0 0',
                }
          }
        />
      </div>
      <div
        role="group"
        aria-label={t('panel.media.viewer.zoom')}
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-popover/95 px-1 text-popover-foreground shadow ring-1 ring-foreground/10"
      >
        <ZoomButton
          label={t('panel.media.viewer.zoomOut')}
          isUnavailable={!isReady || view === null}
          onPress={() => zoomBy(1 / ZOOM_STEP)}
        >
          <ZoomOut aria-hidden="true" className="size-5" />
        </ZoomButton>
        <span className="min-w-14 text-center text-sm whitespace-nowrap tabular-nums">
          {t('panel.media.viewer.percent', { percent })}
        </span>
        <ZoomButton
          label={t('panel.media.viewer.zoomIn')}
          isUnavailable={!isReady || scale >= Math.max(MAX_SCALE, fit)}
          onPress={() => zoomBy(ZOOM_STEP)}
        >
          <ZoomIn aria-hidden="true" className="size-5" />
        </ZoomButton>
        <ZoomButton
          label={t('panel.media.viewer.fit')}
          isUnavailable={!isReady || view === null}
          onPress={() => setView(null)}
        >
          <Minimize2 aria-hidden="true" className="size-5" />
        </ZoomButton>
        <ZoomButton
          label={t('panel.media.viewer.actualSize')}
          isUnavailable={!isReady || percent === 100}
          onPress={zoomToActual}
          className="px-3 text-sm font-medium"
        >
          {t('panel.media.viewer.percent', { percent: 100 })}
        </ZoomButton>
      </div>
    </div>
  );
}
