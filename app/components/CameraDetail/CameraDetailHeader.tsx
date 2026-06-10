import type { CameraDetail } from '@/app/lib/cameraDetail';
import { healthVisual } from '@/app/components/Map/cameraHealthVisual';
import { relativeTime } from '@/app/components/MyCameras/CameraHealthHeader';

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        background: '#1e2636',
        color: '#aeb7c6',
        borderRadius: 5,
        padding: '3px 8px',
      }}
    >
      {children}
    </span>
  );
}

export function CameraDetailHeader({ detail }: { detail: CameraDetail }) {
  const visual = healthVisual(detail.health);
  return (
    <header
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        padding: 16,
        background: '#141b29',
        borderRadius: 10,
      }}
    >
      {detail.latestSnapshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={detail.latestSnapshotUrl}
          alt={detail.title}
          style={{
            width: 96,
            height: 72,
            objectFit: 'cover',
            borderRadius: 8,
            boxShadow: `0 0 0 3px ${visual.color}`,
            flex: 'none',
          }}
        />
      ) : (
        <div
          style={{
            width: 96,
            height: 72,
            borderRadius: 8,
            background: '#0b1019',
            boxShadow: `0 0 0 3px ${visual.color}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            flex: 'none',
          }}
        >
          🛰️
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: '#eaf0f8' }}>
            {detail.title}
          </h1>
          <span style={{ color: visual.color, fontWeight: 700, fontSize: 13 }}>
            {visual.label}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 8,
          }}
        >
          <Chip>snapshot {relativeTime(detail.lastSnapshotAt)}</Chip>
          <Chip>heartbeat {relativeTime(detail.lastHeartbeatAt)}</Chip>
          {detail.firmwareVersion && <Chip>fw {detail.firmwareVersion}</Chip>}
          <Chip>{detail.deviceClass}</Chip>
          <Chip>phase {detail.phase}</Chip>
          <Chip>
            {detail.lat.toFixed(3)}, {detail.lng.toFixed(3)}
          </Chip>
        </div>
      </div>
    </header>
  );
}
