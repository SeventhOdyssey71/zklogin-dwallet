/**
 * API route to fetch Cardano UTXOs
 * This proxies the request to Koios API to avoid CORS issues
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json(
        { error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!address.startsWith('addr_test')) {
      return NextResponse.json(
        { error: 'Invalid Cardano testnet address' },
        { status: 400 }
      );
    }

    // Fetch UTXOs from Koios API (POST method with address in body)
    const response = await fetch(
      `https://preview.koios.rest/api/v1/address_utxos`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          _addresses: [address]
        })
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `Koios API returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Return the data
    return NextResponse.json(data);
  } catch (error) {
    console.error('Cardano UTXOs API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Cardano UTXOs' },
      { status: 500 }
    );
  }
}
