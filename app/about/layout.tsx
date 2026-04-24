import type { ReactNode } from 'react';
import './about.css';

export const metadata = {
  title: 'About — Sunrise / Sunset',
  description:
    'A project that streams live sunrises and sunsets from around the world, as they happen.',
};

export default function AboutLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
