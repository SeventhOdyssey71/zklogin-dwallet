/**
 * API route to submit Cardano transaction
 * This proxies the request to Koios API to avoid CORS issues
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tx } = body;

    if (!tx) {
      return NextResponse.json(
        { error: 'Transaction hex is required' },
        { status: 400 }
      );
    }

    // Submit transaction to Koios API
    // Koios API expects CBOR bytes, but we need to send it correctly
    // Try sending as raw binary with correct content-type
    const txBytes = Buffer.from(tx, 'hex');

    console.log(`📡 Submitting ${txBytes.length} bytes to Koios...`);
    console.log(`📋 TX hex (first 100 chars): ${tx.substring(0, 100)}`);

    const response = await fetch(
      `https://preview.koios.rest/api/v1/submittx`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/cbor',
        },
        body: txBytes
      }
    );

    console.log(`📋 Koios response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Koios API returned ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const result = await response.json();

    // Return the result
    return NextResponse.json(result);
  } catch (error) {
    console.error('Cardano submit API error:', error);
    return NextResponse.json(
      { error: 'Failed to submit Cardano transaction' },
      { status: 500 }
    );
  }
}
