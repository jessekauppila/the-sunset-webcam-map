'use client';

import { useWebcamsStore } from './store/webcams';
import { WebcamDisplay } from './components/WebcamDisplay';
import { WebcamConsole } from './components/WebcamConsole';
import SimpleMap from './components/Map/SimpleMap';

//import

export default function Home() {
  // Bellingham, Washington location
  const userLocation = { lat: 48.7519, lng: -122.4787 };

  const nextWebcam = useWebcamsStore((s) => s.nextWebcam);
  const webcams = useWebcamsStore((s) => s.moreWebcams);

  return (
    <div className="min-h-screen p-8">
      <main className="max-w-4xl mx-auto">
        <SimpleMap userLocation={userLocation} />
        <div className="canvas-container">
          {nextWebcam && <WebcamDisplay webcam={nextWebcam} />}
        </div>
        <WebcamConsole webcams={webcams} />
      </main>
    </div>
  );
}
