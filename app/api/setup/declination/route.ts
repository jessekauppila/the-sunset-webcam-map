import { NextResponse } from 'next/server';
import { declinationDeg } from '@/app/lib/declination';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Magnetic declination for the operator's current location (phone geolocation),
// so the setup wizard can convert the phone's magnetic compass heading to true
// north for the sun-arc overlay. WMM is a server-side dep, hence an endpoint.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const latRaw = searchParams.get('lat');
  const lngRaw = searchParams.get('lng');
  // Number(null) is 0, so guard the missing case explicitly before coercing.
  const lat = latRaw == null ? NaN : Number(latRaw);
  const lng = lngRaw == null ? NaN : Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng query params are required' }, { status: 400 });
  }
  return NextResponse.json({ declinationDeg: declinationDeg(lat, lng) });
}
