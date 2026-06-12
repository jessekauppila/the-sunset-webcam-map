import type { WindyWebcam } from '@/app/lib/types';
import { healthVisual } from '@/app/components/Map/cameraHealthVisual';

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diffMs = Math.max(0, now.getTime() - then);
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * Small health banner shown above the reused RatingCard in the My Cameras popup.
 * Renders nothing for non-custom webcams (no cameraHealth field).
 */
export function CameraHealthHeader({ webcam }: { webcam: WindyWebcam }) {
  if (!webcam.cameraHealth) return null;
  const visual = healthVisual(webcam.cameraHealth);
  return (
    <div
      className="camera-health-header"
      style={{
        background: '#11151c',
        color: '#e8edf4',
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: visual.color,
            display: 'inline-block',
          }}
        />
        <strong style={{ fontSize: 13 }}>{visual.label}</strong>
      </div>
      <div style={{ fontSize: 11, opacity: 0.75 }}>
        Snapshot {relativeTime(webcam.lastSnapshotAt)} · heartbeat{' '}
        {relativeTime(webcam.lastHeartbeatAt)}
      </div>
      {webcam.cameraId != null && (
        <a
          href={`/cameras/${webcam.cameraId}`}
          style={{ fontSize: 11, color: '#60a5fa', marginTop: 4 }}
        >
          View all data →
        </a>
      )}
    </div>
  );
}
