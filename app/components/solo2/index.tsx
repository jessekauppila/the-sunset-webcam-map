'use client';

import type { MosaicProps } from '@/app/components/mosaic/types';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';
import { Solo2Screen } from './Solo2Screen';

/**
 * solo2 as a registered version (rhythm spec §5.3): solo's bins and
 * schedule, with rhythm decided on the server and the camera run, lead,
 * transition and local time drawn here.
 */
export function Solo2Kiosk(props: MosaicProps) {
  const dials = dialsFrom2(withCaption(mergeSettings(SOLO2_SETTINGS_SCHEMA, props.settings), props.shared));
  const glass = useSoloGlass({
    feed: props.feed,
    drive: props.driveSchedule !== false,
    dozing: props.dozing === true,
    version: 'solo2',
  });
  const debug = props.allowDebugOverlays !== false && (props.search ?? '').includes('debug=1');
  return <Solo2Screen glass={glass} dials={dials} width={props.width} height={props.height} feed={props.feed} debug={debug} />;
}
