import SimpleMap from './components/Map/SimpleMap';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';

export default function Home() {
  // Bellingham, Washington location need to put in user's location eventually
  const userLocation = { lat: 48.7519, lng: -122.4787 };

  // Fetches sunrise/sunset webcams from database and stores in Zustand
  // Automatically refreshes every 60 seconds using SWR
  // Splits webcams into sunrise[] and sunset[] arrays by phase
  useLoadTerminatorWebcams();

  return (
    <main className="relative w-full">
      <SimpleMap userLocation={userLocation} />
      <div className="text-center text-gray-600">
        <p>
          This map will automatically center on the nearest sunset
          west of your location!
        </p>
        <p className="text-sm mt-2">
          Updates every minute as the sunset moves.
        </p>
      </div>
    </main>
  );
}
