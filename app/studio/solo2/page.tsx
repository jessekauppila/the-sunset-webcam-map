import { redirect } from 'next/navigation';

/** The solo2 studio is now a version of the one /studio (one-studio spec §2). */
export default function Solo2StudioPage() {
  redirect('/studio');
}
