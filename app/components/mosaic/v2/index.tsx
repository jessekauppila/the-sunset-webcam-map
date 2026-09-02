'use client';

import type { MosaicProps } from '../types';

/**
 * v2 — latitude anchoring + depth-into-twilight arrangement. Built fresh;
 * v1 stays frozen as the reference. Body is filled in by later tasks.
 */
export function MosaicV2({ width, height, feed }: MosaicProps) {
  return (
    <div style={{ position: 'relative', width, height, background: '#000' }}>
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: 0.3,
          color: '#fff',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        {feed === 'sunrise' ? 'SUNRISE' : 'SUNSET'}
      </div>
    </div>
  );
}
