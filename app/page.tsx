import SimpleMap from './components/Map/SimpleMap';
import { useDBTerminatorWebcams } from './components/hooks/useDBTerminatorWebcams';

//import

const { terminatorWebcams, error, isLoading } =
  useDBTerminatorWebcams;

export default function Home() {
  // Bellingham, Washington location
  const userLocation = { lat: 48.7519, lng: -122.4787 };

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
