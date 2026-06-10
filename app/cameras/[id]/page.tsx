import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isOwner } from '@/app/lib/owner';
import { fetchCameraDetail } from '@/app/lib/cameraDetail';
import { CameraDetailHeader } from '@/app/components/CameraDetail/CameraDetailHeader';
import { CameraBestStrip } from '@/app/components/CameraDetail/CameraBestStrip';
import { CameraImageHistory } from '@/app/components/CameraDetail/CameraImageHistory';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#7f8a9c',
  margin: '24px 0 8px',
};

export default async function CameraDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!isOwner(session)) redirect('/');

  const { id } = await params;
  const cameraId = Number(id);
  if (!Number.isInteger(cameraId) || cameraId <= 0) notFound();

  const detail = await fetchCameraDetail(cameraId);
  if (!detail) notFound();

  const webcamId = detail.webcamId;

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '24px 16px',
        color: '#e5e7eb',
        background: '#0b1220',
        minHeight: '100vh',
      }}
    >
      <div style={{ marginBottom: 16, fontSize: 13 }}>
        <Link href="/" style={{ color: '#60a5fa' }}>
          ← back to map
        </Link>
      </div>

      <CameraDetailHeader detail={detail} />

      {webcamId == null ? (
        <p style={{ color: '#7f8a9c', fontSize: 13, marginTop: 24 }}>
          No captures yet — this camera has not reported any snapshots.
        </p>
      ) : (
        <>
          <div style={sectionLabel}>★ Best from this camera</div>
          <CameraBestStrip webcamId={webcamId} />

          <div style={sectionLabel}>All captures · newest first</div>
          <CameraImageHistory webcamId={webcamId} />
        </>
      )}
    </main>
  );
}
