import SimpleSunsetMap from './components/Map/SunsetMap';
import TestWebcamFetch from './components/SimpleWebcamFetch';
import SimpleMap from './components/Map/SimpleMap';

//Key for Windy API...1wv9Q9Az1pdk4XGAAw6xzvolzyohzhlO

export default function Home() {
  // Example user location (NYC)
  const userLocation = { lat: 40.7128, lng: -74.006 };

  return (
    <div className="min-h-screen p-8">
      <main className="max-w-4xl mx-auto">
        <SimpleMap userLocation={userLocation} />
        <SimpleSunsetMap userLocation={userLocation} />
        <TestWebcamFetch />
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
    </div>
  );
}
