/**
 * API route to fetch Cardano protocol parameters
 * This proxies the request to Koios API to avoid CORS issues
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Fetch protocol parameters from Koios API (latest epoch)
    // Koios uses POST with empty body for latest epoch params
    const response = await fetch(
      `https://preview.koios.rest/api/v1/epoch_params`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Koios epoch_params error:', response.status, errorText);
      return NextResponse.json(
        { error: `Koios API returned ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('Koios epoch_params response:', JSON.stringify(data).substring(0, 200));

    // Return the latest epoch parameters
    if (Array.isArray(data) && data.length > 0) {
      return NextResponse.json(data[0]);
    }

    // If it's a single object, return it directly
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: 'No protocol parameters found' },
      { status: 404 }
    );
  } catch (error) {
    console.error('Cardano protocol parameters API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Cardano protocol parameters' },
      { status: 500 }
    );
  }
}
