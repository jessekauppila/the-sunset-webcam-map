import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WindyWebcam } from '../../../lib/types';

import { createWebcamPopupContent } from './webcamPopup';

const baseWebcam: WindyWebcam = {
  webcamId: 1,
  title: 'Test cam',
  viewCount: 0,
  status: 'active',
  images: { current: { preview: 'https://example.com/img.jpg' } },
  location: { latitude: 10, longitude: 20 },
  categories: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-14T03:30:30Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createWebcamPopupContent — freshness label', () => {
  it('omits the "Captured ... ago" label for windy_bundle rows', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'windy_bundle',
      latestSnapshotCapturedAt: '2026-05-14T03:30:00Z',
    });

    expect(html).not.toMatch(/Captured\s+\d+s\s+ago/);
    expect(html).not.toMatch(/Captured\s+\d+m\s+ago/);
  });

  it('omits the label when latestSnapshotCapturedAt is missing', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      // latestSnapshotCapturedAt deliberately absent
    });

    expect(html).not.toMatch(/Captured/);
  });

  it('renders "Captured 30s ago" for a custom_snapshot captured 30s ago', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      latestSnapshotCapturedAt: '2026-05-14T03:30:00Z', // 30s before now
    });

    expect(html).toMatch(/Captured\s+30s\s+ago/);
  });

  it('renders "Captured 4m ago" for a custom_snapshot captured 4 minutes ago', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      latestSnapshotCapturedAt: '2026-05-14T03:26:30Z',
    });

    expect(html).toMatch(/Captured\s+4m\s+ago/);
  });

  it('renders "Captured 2h ago" for a custom_snapshot captured 2 hours ago', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      latestSnapshotCapturedAt: '2026-05-14T01:30:30Z',
    });

    expect(html).toMatch(/Captured\s+2h\s+ago/);
  });

  it('renders an absolute date for a custom_snapshot captured >=24h ago', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      latestSnapshotCapturedAt: '2026-05-10T03:30:30Z',
    });

    expect(html).toMatch(/Captured\s+2026-05-10/);
  });
});
