import type { Metadata } from 'next';
import { MirrorPage } from '../MirrorPage';

export const metadata: Metadata = { title: 'Sunrise' };

/** The gallery's left screen, for anyone with the link. */
export default function SunriseMirror() {
  return <MirrorPage feed="sunrise" />;
}
