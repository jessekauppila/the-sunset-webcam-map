'use client';

import type { MosaicProps } from '@/app/components/mosaic/types';
import { Solo2Screen } from './Solo2Screen';
import { useGlassFollower } from './useGlassFollower';

/**
 * solo2 as a registered version (rhythm spec §5.3), now a follower like
 * every other screen (mirror spec §5): the projection carries the live
 * dials, so `settings` and `shared` are not read, and nothing here
 * advances, so `dozing` and `driveSchedule` have nothing to gate. Doze is
 * the kiosk page's overlay; behind it the follower keeps stepping.
 */
export function Solo2Kiosk(props: MosaicProps) {
  const glass = useGlassFollower(props.feed);
  const debug = props.allowDebugOverlays !== false && (props.search ?? '').includes('debug=1');
  if (!glass.dials) {
    return <div style={{ width: props.width, height: props.height, background: '#000' }} />;
  }
  return <Solo2Screen glass={glass} dials={glass.dials} width={props.width} height={props.height} feed={props.feed} debug={debug} />;
}
