import { NextRequest, NextResponse } from 'next/server';

interface WindyWebcam {
  webcamId: number;
  title: string;
  images?: {
    current?: {
      preview?: string;
      thumbnail?: string;
      icon?: string;
    };
  };
  status: string;
  viewCount: number;
  urls: string;
  player: string;
  location: string;
}

// Updated: Windy API returns an array directly, not a wrapper object
type WindyResponse = WindyWebcam[];

export async function GET(request: NextRequest) {
  try {
    // 🔒 SECURITY: Use API key with fallback for development
    const apiKey = process.env.NEXT_PUBLIC_WINDY_ACCESS_TOKEN || '';
    console.log('🔑 API Key present:', apiKey ? 'Yes' : 'No');

    const { searchParams } = new URL(request.url);

    // Get coordinates from query params or use defaults (Eastern US - within Windy's limits)
    const northLat = searchParams.get('northLat') || '47.0'; // Northern US
    const southLat = searchParams.get('southLat') || '25.0'; // Florida Keys
    const eastLon = searchParams.get('eastLon') || '-65.0'; // Atlantic coast
    const westLon = searchParams.get('westLon') || '-100.0'; // Central US
    const zoom = searchParams.get('zoom') || '4'; // Minimum zoom level required by Windy

    console.log('🌐 Fetching webcams from Windy API...');

    // Call Windy API from the server (no CORS issues here!)
    const response = await fetch(
      `https://api.windy.com/webcams/api/v3/map/clusters?lang=en&northLat=${northLat}&southLat=${southLat}&eastLon=${eastLon}&westLon=${westLon}&zoom=${zoom}&include=images&include=urls&include=player&include=location&include=categories`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-windy-api-key': apiKey,
        },
      }
    );

    if (!response.ok) {
      console.error(
        '❌ Windy API error:',
        response.status,
        response.statusText
      );
      return NextResponse.json(
        { error: `Windy API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data: WindyResponse = await response.json();
    console.log(`✅ Found ${data.length || 0} webcams`);
    console.log('📋 First webcam:', data[0]?.title || 'None');

    return NextResponse.json({
      webcams: data || [],
      total: data.length || 0,
      source: 'windy',
    });
  } catch (error) {
    console.error('❌ API Route Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch webcams' },
      { status: 500 }
    );
  }
}
