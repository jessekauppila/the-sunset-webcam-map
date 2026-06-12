import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type mapboxgl from 'mapbox-gl';
import type { WindyWebcam } from '../../../lib/types';
import RatingCard, {
  type RateResult,
} from '@/app/components/Webcam/RatingCard';
import {
  captureAndRateWebcam,
  type CaptureAndRateResponse,
} from '@/app/lib/snapshots';
import { healthVisual } from '@/app/components/Map/cameraHealthVisual';
import { CameraHealthHeader } from '@/app/components/MyCameras/CameraHealthHeader';

type MarkerEntry = {
  marker: mapboxgl.Marker;
  popup: mapboxgl.Popup;
  root: Root;
  container: HTMLElement;
  latestRating: number | null;
  render: (webcam: WindyWebcam) => void;
  cleanup: () => void;
};

type UseSetWebcamMarkersOptions = {
  activeWebcamId?: number | null;
  onAdvance?: () => void;
  onPopupStateChange?: (isOpen: boolean) => void;
  /**
   * Fly to + open this marker's popup. The effect re-runs only when the VALUE
   * changes, so consumers that want to re-focus the same camera after the popup
   * was closed must reset this to null first, then set the id again.
   */
  focusWebcamId?: number | null;
};

type FeedbackTone = RateResult['tone'];

const SNACKBAR_ID = 'webcam-rating-snackbar';

export function createMarkerElement(webcam: WindyWebcam) {
  const wrapper = document.createElement('div');
  wrapper.className = 'webcam-marker';
  // Do NOT set `position` here. Mapbox positions the marker element via
  // `.mapboxgl-marker { position: absolute }` + a transform; an inline position
  // overrides that and drops every marker into normal flow (stacked off-globe).
  // The health badge below still anchors to this wrapper because Mapbox's
  // absolute (and its transform) make it the badge's containing block.
  wrapper.style.cssText = `
    width: 60px;
    height: 60px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  `;

  const inner = document.createElement('div');
  inner.className = 'webcam-marker-inner';
  inner.style.cssText = `
    width: 100%;
    height: 100%;
    border-radius: 50%;
    border: 1px solid rgba(87, 87, 87, 0.64);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0);
    overflow: hidden;
    background: rgba(0, 0, 0, 0);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    transition: opacity 280ms ease, transform 280ms ease;
    opacity: 0;
    transform: scale(0.9);
  `;

  if (webcam.images?.current?.preview) {
    const img = document.createElement('img');
    img.src = webcam.images.current.preview;
    img.alt = webcam.title;
    img.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: cover;
    `;
    inner.appendChild(img);
  } else if (webcam.cameraHealth === 'never') {
    inner.textContent = '🛰️';
  } else {
    inner.textContent = '🌅';
  }

  wrapper.appendChild(inner);

  // "My Cameras" health ring + corner badge (absent for Windy webcams).
  if (webcam.cameraHealth) {
    const visual = healthVisual(webcam.cameraHealth);
    inner.style.boxShadow = `0 0 0 3px ${visual.color}, 0 0 14px ${visual.color}`;
    inner.style.border = `1px solid ${visual.color}`;

    const badge = document.createElement('div');
    badge.className = 'webcam-marker-badge';
    badge.textContent = visual.badge;
    badge.style.cssText = `
      position: absolute;
      bottom: -2px;
      right: -2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: ${visual.color};
      color: #0d1016;
      font-size: 11px;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #11151c;
    `;
    wrapper.appendChild(badge);
  }

  return wrapper;
}

function getInnerElement(element: HTMLElement): HTMLElement {
  const inner = element.firstElementChild;
  return inner instanceof HTMLElement ? inner : element;
}

function animateMarkerIn(element: HTMLElement, index: number) {
  const target = getInnerElement(element);
  const delay = Math.min(index, 30) * 25;
  setTimeout(() => {
    target.style.opacity = '1';
    target.style.transform = 'scale(1)';
  }, delay);
}

function animateMarkerOut(element: HTMLElement, onDone: () => void) {
  const target = getInnerElement(element);
  target.style.opacity = '0';
  target.style.transform = 'scale(0.88)';
  setTimeout(onDone, 240);
}

function feedbackFor(
  phase: 'sunrise' | 'sunset',
  rating: number
): { message: string; tone: FeedbackTone } {
  const liked = rating >= 3;
  const noun = phase === 'sunrise' ? 'sunrise' : 'sunset';

  if (liked) {
    return {
      message: `Glad you enjoyed this ${noun}!`,
      tone: 'positive',
    };
  }

  return {
    message: `Sorry you didn't enjoy this ${noun}.`,
    tone: 'negative',
  };
}

function showSnackbar(message: string, tone: FeedbackTone) {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(SNACKBAR_ID);
  if (existing) {
    existing.remove();
  }

  const el = document.createElement('div');
  el.id = SNACKBAR_ID;
  el.textContent = message;
  el.style.position = 'fixed';
  el.style.bottom = '32px';
  el.style.left = '50%';
  el.style.transform = 'translate(-50%, 12px)';
  el.style.padding = '12px 18px';
  el.style.borderRadius = '9999px';
  el.style.color = '#f8fafc';
  el.style.fontSize = '13px';
  el.style.fontWeight = '600';
  el.style.letterSpacing = '0.02em';
  el.style.backgroundColor =
    tone === 'positive'
      ? 'rgba(16, 185, 129, 0.92)'
      : tone === 'negative'
      ? 'rgba(239, 68, 68, 0.92)'
      : 'rgba(100, 116, 139, 0.92)';
  el.style.boxShadow = '0 18px 35px rgba(15, 23, 42, 0.35)';
  el.style.opacity = '0';
  el.style.zIndex = '2000';
  el.style.pointerEvents = 'none';
  el.style.transition = 'opacity 160ms ease, transform 160ms ease';

  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, 0)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, 14px)';
    setTimeout(() => {
      el.remove();
    }, 180);
  }, 2400);
}

export function useSetWebcamMarkers(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  webcams: WindyWebcam[],
  options?: UseSetWebcamMarkersOptions
) {
  const markersRef = useRef<Map<number, MarkerEntry>>(new Map());
  const optionsRef = useRef<UseSetWebcamMarkersOptions | undefined>(
    options
  );
  const pendingAutoOpenRef = useRef(false);
  const openPopupCountRef = useRef(0);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!map || !mapLoaded) return;

    let cancelled = false;

    const updatePopupState = () => {
      const entryOptions = optionsRef.current;
      entryOptions?.onPopupStateChange?.(
        openPopupCountRef.current > 0
      );
    };

    import('mapbox-gl').then((mapboxgl) => {
      if (cancelled) return;

      const markers = markersRef.current;
      const incomingIds = new Set(webcams.map((w) => w.webcamId));

      const handleRate = async (
        webcam: WindyWebcam,
        entry: MarkerEntry,
        value: number
      ): Promise<RateResult> => {
        const webcamId = Number(webcam.webcamId);
        if (!Number.isInteger(webcamId) || webcamId <= 0) {
          throw new Error('Unable to rate this webcam right now.');
        }

        const phase =
          webcam.phase === 'sunrise' || webcam.phase === 'sunset'
            ? webcam.phase
            : 'sunset';

        const response: CaptureAndRateResponse =
          await captureAndRateWebcam({
            webcamId,
            phase,
            rating: value,
          });

        const feedback = feedbackFor(phase, response.rating);
        entry.latestRating = response.rating;

        showSnackbar(feedback.message, feedback.tone);

        const entryOptions = optionsRef.current;
        pendingAutoOpenRef.current = true;
        entry.popup.remove();
        entryOptions?.onAdvance?.();

        return {
          ...feedback,
          rating: response.rating,
        };
      };

      webcams.forEach((webcam, index) => {
        const existing = markers.get(webcam.webcamId);
        if (existing) {
          existing.render(webcam);
          return;
        }

        const markerElement = createMarkerElement(webcam);
        animateMarkerIn(markerElement, index);

        const popupContainer = document.createElement('div');
        popupContainer.className = 'webcam-rating-popup';

        const popup = new mapboxgl.default.Popup({
          offset: 25,
          className: 'custom-popup rating-card-popup',
          closeButton: true,
        }).setDOMContent(popupContainer);

        // Track popup open/close events
        popup.on('open', () => {
          openPopupCountRef.current++;
          updatePopupState();
        });

        popup.on('close', () => {
          openPopupCountRef.current = Math.max(
            0,
            openPopupCountRef.current - 1
          );
          updatePopupState();
        });

        const marker = new mapboxgl.default.Marker(markerElement)
          .setLngLat([
            webcam.location.longitude,
            webcam.location.latitude,
          ])
          .setPopup(popup)
          .addTo(map);

        const root = createRoot(popupContainer);

        const entry: MarkerEntry = {
          marker,
          popup,
          root,
          container: popupContainer,
          latestRating: webcam.rating ?? null,
          render: () => {},
          cleanup: () => {
            // If this popup was open, decrement count
            if (popup.isOpen()) {
              openPopupCountRef.current = Math.max(
                0,
                openPopupCountRef.current - 1
              );
              updatePopupState();
            }
            // Defer unmount to avoid React render cycle conflicts
            setTimeout(() => {
              root.unmount();
            }, 0);
            popup.remove();
            marker.remove();
          },
        };

        entry.render = (cam: WindyWebcam) => {
          root.render(
            <>
              <CameraHealthHeader webcam={cam} />
              <RatingCard
                webcam={cam}
                initialRating={entry.latestRating ?? cam.rating ?? null}
                onRate={async () => {
                  /* no-op; map popup is read-only */
                }}
                readOnly={true}
              />
            </>
          );
        };

        entry.render(webcam);
        markers.set(webcam.webcamId, entry);
      });

      markers.forEach((entry, webcamId) => {
        if (!incomingIds.has(webcamId)) {
          const element = entry.marker.getElement();
          animateMarkerOut(element, () => {
            entry.cleanup();
            markers.delete(webcamId);
          });
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [map, mapLoaded, webcams]);

  useEffect(() => {
    if (!map || !mapLoaded) return;
    if (!pendingAutoOpenRef.current) return;

    const activeId = options?.activeWebcamId ?? null;
    if (!activeId) return;

    const entry = markersRef.current.get(activeId);
    if (!entry) return;

    entry.popup.addTo(map);
    pendingAutoOpenRef.current = false;
  }, [map, mapLoaded, options?.activeWebcamId]);

  // Fly to + open a specific marker when the consumer sets focusWebcamId
  // (used by the My Cameras list when a row is clicked).
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const focusId = options?.focusWebcamId ?? null;
    if (focusId == null) return;
    const entry = markersRef.current.get(focusId);
    if (!entry) return; // marker not built yet (data not loaded) — silently no-op; no retry
    const lngLat = entry.marker.getLngLat();
    map.flyTo({
      center: [lngLat.lng, lngLat.lat],
      zoom: Math.max(map.getZoom(), 3),
      duration: 1200,
    });
    entry.popup.addTo(map);
  }, [map, mapLoaded, options?.focusWebcamId]);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((entry) => entry.cleanup());
      markers.clear();
    };
  }, []);
}
