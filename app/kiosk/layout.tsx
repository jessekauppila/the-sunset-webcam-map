import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sunset Webcam — Kiosk Display',
};

export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-black w-screen h-screen overflow-hidden"
      style={{ cursor: 'none' }}
    >
      {children}
    </div>
  );
}
