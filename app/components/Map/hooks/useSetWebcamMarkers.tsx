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
};

type FeedbackTone = RateResult['tone'];

const SNACKBAR_ID = 'webcam-rating-snackbar';

function createMarkerElement(webcam: WindyWebcam) {
  const element = document.createElement('div');
  element.className = 'webcam-marker';
  element.style.cssText = `
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: 1px solid rgba(87, 87, 87, 0.64);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0);
    overflow: hidden;
    cursor: pointer;
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
    element.appendChild(img);
  } else {
    element.textContent = '🌅';
  }

  return element;
}

function animateMarkerIn(element: HTMLElement, index: number) {
  const delay = Math.min(index, 30) * 25;
  setTimeout(() => {
    element.style.opacity = '1';
    element.style.transform = 'scale(1)';
  }, delay);
}

function animateMarkerOut(element: HTMLElement, onDone: () => void) {
  element.style.opacity = '0';
  element.style.transform = 'scale(0.88)';
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
  const optionsRef = useRef<UseSetWebcamMarkersOptions | undefined>(options);
  const pendingAutoOpenRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!map || !mapLoaded) return;

    let cancelled = false;

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
            root.unmount();
            popup.remove();
            marker.remove();
          },
        };

        entry.render = (cam: WindyWebcam) => {
          root.render(
            <RatingCard
              webcam={cam}
              initialRating={entry.latestRating ?? cam.rating ?? null}
              onRate={async (selected) => handleRate(cam, entry, selected)}
            />
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

  useEffect(() => {
    return () => {
      const markers = markersRef.current;
      markers.forEach((entry) => entry.cleanup());
      markers.clear();
    };
  }, []);
}

