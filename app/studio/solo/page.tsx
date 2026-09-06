import { redirect } from 'next/navigation';

/** The solo studio is now a version of the one /studio (one-studio spec §2). */
export default function SoloStudioPage() {
  redirect('/studio');
}
