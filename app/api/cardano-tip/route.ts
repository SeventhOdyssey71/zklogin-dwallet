/**
 * API route to fetch Cardano chain tip (current slot)
 * This proxies the request to Koios API to avoid CORS issues
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Fetch current chain tip from Koios API
    const response = await fetch(
      `https://preview.koios.rest/api/v1/tip`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Koios tip error:', response.status, errorText);
      return NextResponse.json(
        { error: `Koios API returned ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Return the first (and only) tip object
    if (Array.isArray(data) && data.length > 0) {
      return NextResponse.json(data[0]);
    }

    // If it's a single object, return it directly
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: 'No chain tip found' },
      { status: 404 }
    );
  } catch (error) {
    console.error('Cardano chain tip API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Cardano chain tip' },
      { status: 500 }
    );
  }
}
