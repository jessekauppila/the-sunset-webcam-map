import { readManifest } from '@/app/lib/modelRuns';
import { HomeClient } from './HomeClient';

export default function Page() {
  const manifest = readManifest();
  return <HomeClient manifestRuns={manifest.runs} />;
}
