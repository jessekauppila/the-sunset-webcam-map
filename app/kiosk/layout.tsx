import type { Metadata } from 'next';
import { soloFontClassName } from './soloFonts';

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
      className={`bg-black w-screen h-screen overflow-hidden ${soloFontClassName}`}
      style={{ cursor: 'none' }}
    >
      {children}
    </div>
  );
}
