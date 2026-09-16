import type { Metadata } from 'next';
import { PiecePage } from '../PiecePage';

export const metadata: Metadata = {
  title: 'Sunrise / Sunset',
  description: 'Both gallery screens, live: sunrise on the left, sunset on the right.',
};

/** Both screens, as they hang. The link to send someone. */
export default function Mirror() {
  return <PiecePage />;
}
