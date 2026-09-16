import type { Metadata } from 'next';
import { MirrorPage } from '../MirrorPage';

export const metadata: Metadata = { title: 'Sunset' };

/** The gallery's right screen, for anyone with the link. */
export default function SunsetMirror() {
  return <MirrorPage feed="sunset" />;
}
