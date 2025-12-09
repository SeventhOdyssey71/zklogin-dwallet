import { NextRequest, NextResponse } from 'next/server';

/**
 * API route to fetch Bitcoin testnet balance
 * Proxies requests to Blockstream API to avoid CORS issues
 */
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

    // Fetch from Blockstream API
    const response = await fetch(
      `https://blockstream.info/testnet/api/address/${address}`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Blockstream API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Blockstream API returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Calculate balance: funded (received) - spent
    const funded = data.chain_stats?.funded_txo_sum || 0;
    const spent = data.chain_stats?.spent_txo_sum || 0;
    const satoshis = funded - spent;
    const balance = (satoshis / 1e8).toFixed(8); // Convert satoshis to BTC

    return NextResponse.json({
      balance,
      satoshis,
      funded,
      spent,
    });
  } catch (error) {
    console.error('Bitcoin balance API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Bitcoin balance' },
      { status: 500 }
    );
  }
}
