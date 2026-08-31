'use client';

// Dim "dozing" state — a slow 2s fade so a deliberate doze reads as
// intentional, per the spec ("the pause is visible").
export function KioskDozeOverlay({ dozing }: { dozing: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        opacity: dozing ? 0.97 : 0,
        pointerEvents: 'none',
        transition: 'opacity 2s ease',
        zIndex: 50,
      }}
    />
  );
}
