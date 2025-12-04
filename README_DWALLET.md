# dWallet Frontend - Multi-Chain Wallet Control

A modern, beautiful frontend for creating and managing dWallets across 15+ blockchains using the Ika Network's 2PC-MPC technology.

## 🎉 What's Built

### Pages
1. **Landing Page** (`/`) - Hero section with animated gradients, Bento grid features, CTA sections
2. **Create Wizard** (`/create`) - 4-step wizard for creating ECDSA or EdDSA wallets
3. **Dashboard** (`/dashboard`) - Portfolio overview with wallet cards and activity feed

### Features
- ✅ Custom animated cursor (desktop only)
- ✅ Full-screen navigation menu
- ✅ Dark/Light mode toggle
- ✅ Responsive design (mobile-first)
- ✅ Mock API with realistic delays
- ✅ Zustand state management
- ✅ TypeScript type safety
- ✅ Framer Motion animations
- ✅ Bento grid layout system

## 🚀 Getting Started

### Run Development Server

```bash
cd /Users/emmanuelosadebe/ika-dapp/dwallet-frontend
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## 🗂️ Project Structure

```
dwallet-frontend/
├── app/
│   ├── page.tsx              # Landing page
│   ├── create/page.tsx       # dWallet creation wizard
│   ├── dashboard/page.tsx    # Dashboard with wallet overview
│   ├── layout.tsx            # Root layout with providers
│   ├── globals.css           # Global styles & custom cursor
│   └── providers.tsx         # Theme & Query providers
├── components/
│   ├── ui/
│   │   └── BentoCard.tsx     # Reusable Bento grid card
│   └── layout/
│       ├── CustomCursor.tsx  # Animated cursor
│       ├── Navigation.tsx    # Full-screen menu
│       └── ThemeToggle.tsx   # Dark mode toggle
├── lib/
│   ├── store/
│   │   └── walletStore.ts    # Zustand wallet state
│   ├── api/
│   │   ├── dwallet.ts        # Mock API client
│   │   └── mockData.ts       # Mock wallets & chains
│   └── types/
│       ├── dwallet.ts        # dWallet types
│       └── blockchain.ts     # Blockchain types
└── package.json
```

## 🎨 Design System

Based on the Modern Web Design System Guide 2025:

- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS 4
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **Fonts**: Geist Sans & Geist Mono
- **Theme**: next-themes with dark/light mode
- **State**: Zustand + TanStack Query

### Key Patterns
- Bento grid layouts
- Custom animated cursor
- Gradient backgrounds (purple-pink-blue)
- Smooth scroll animations
- Responsive mobile-first design
- Reduced motion support

## 📱 Pages Overview

### 1. Landing Page (/)
- **Hero**: Animated gradient orbs, large title, dual CTAs
- **Stats**: 15+ blockchains, <1s signing, 100% zero-trust
- **Features**: Bento grid with 5 cards
  - Zero-Trust Security (large 2x2)
  - Lightning Fast (1x1)
  - Universal Compatibility (2x1)
  - Dual Algorithm Support (1x2)
- **CTA**: Gradient section with "Create Your dWallet Now"

### 2. Create Wizard (/create)
- **Step 1**: Choose ECDSA or EdDSA with interactive cards
- **Step 2**: Name your wallet (validation required)
- **Step 3**: Review details with security note
- **Step 4**: Success screen with wallet ID & public key
- **Features**:
  - Progress bar
  - Back/Continue navigation
  - Mock API integration (2s delay)
  - Automatic state update

### 3. Dashboard (/dashboard)
- **Header**: Title, description, "Create New" button
- **Stats Cards**: Portfolio value, wallet count, supported chains
- **Wallet Grid**: Individual cards for each wallet
  - Name, type, curve
  - Total balance in USD
  - Balances per chain (top 3)
  - Status indicator
  - Click to view details (link ready)
- **Activity Feed**: Recent actions with icons
- **Empty State**: CTA when no wallets exist

## 🔌 Mock API

All API calls use mock data with realistic delays:

```typescript
// lib/api/dwallet.ts
dwalletAPI.createDWallet()  // 2s delay
dwalletAPI.getDWallets()    // 500ms delay
dwalletAPI.signTransaction() // 3s delay
```

### Mock Data Includes:
- **3 pre-made wallets**: 2 ECDSA, 1 EdDSA
- **8 blockchains**: Ethereum, Bitcoin, Solana, Polygon, etc.
- **Multiple balances per wallet**
- **Transaction history**

## 🔄 Next Steps

To connect to the real backend:

1. **Update API client** (`lib/api/dwallet.ts`):
   ```typescript
   // Replace mock delays with real fetch calls
   const response = await fetch('http://localhost:3001/api/dwallet/create', {
     method: 'POST',
     body: JSON.stringify(request),
   });
   ```

2. **Backend endpoint** (already exists):
   - Location: `/ika-dwallet/cross-chain-wallet/server/`
   - Integration file: `dwallet/integration.js`

3. **Environment variables**:
   ```bash
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

## 🎯 Features to Add

- [ ] Individual wallet detail page (`/wallets/[id]`)
- [ ] Transaction signing interface
- [ ] Activity/history page with filters
- [ ] Settings page (network selection, etc.)
- [ ] Real-time balance updates
- [ ] Transaction notifications
- [ ] Wallet export/backup
- [ ] Multi-wallet selection
- [ ] Search and filters

## 🧪 Testing

### Manual Testing Flows

**Test 1: Create ECDSA Wallet**
1. Go to `/` → Click "Create dWallet"
2. Select ECDSA card → Click "Continue"
3. Enter name "My Test Wallet" → Click "Continue"
4. Review details → Click "Create dWallet"
5. Wait 2s → See success screen
6. Click "Go to Dashboard" → See new wallet

**Test 2: View Dashboard**
1. Go to `/dashboard`
2. See 3 mock wallets with balances
3. See portfolio stats and activity feed
4. Click on a wallet card → Navigate to detail page (not built yet)

**Test 3: Dark Mode**
1. Click moon icon (top right)
2. See dark theme applied
3. Click sun icon → See light theme

**Test 4: Navigation**
1. Click menu icon (top left)
2. See full-screen menu slide in
3. Click menu items to navigate
4. Click X to close

## 💾 Data Flow

```
User Action
    ↓
Component (React)
    ↓
Zustand Store (state management)
    ↓
API Layer (lib/api/dwallet.ts)
    ↓
Mock Data / Real Backend
    ↓
Response
    ↓
Store Update
    ↓
UI Re-render
```

## 🎨 Color Palette

```css
/* Light Mode */
Background: #ffffff
Foreground: #171717
Accent: #000000

/* Dark Mode */
Background: #0a0a0a
Foreground: #ededed
Accent: #ffffff

/* Brand Gradients */
Purple-Pink: from-purple-600 via-pink-600 to-blue-600
Purple-Pink (dark): from-purple-400 via-pink-400 to-blue-400
```

## 📚 Technologies

- **Next.js 16**: React framework with App Router
- **React 19**: UI library
- **TypeScript**: Type safety
- **Tailwind CSS 4**: Utility-first CSS
- **Framer Motion**: Animations
- **Zustand**: State management
- **TanStack Query**: Server state
- **Lucide React**: Icons
- **next-themes**: Theme management

## 🐛 Known Issues

None currently! 🎉

## 📖 Documentation

- **Design Guide**: `/ika-dapp/DESIGN_SYSTEM_GUIDE.md`
- **Project Plan**: `/ika-dapp/PROJECT_PLAN.md`
- **Progress Tracker**: `DEVELOPMENT_PROGRESS.md`
- **Backend Integration**: `/ika-dapp/ika-dwallet/cross-chain-wallet/`

## 🙏 Credits

Built following modern web design patterns from 2025, using:
- Bento grid layouts
- Experimental navigation
- Custom cursor interactions
- Gradient backgrounds
- Smooth animations
- Dark mode support

---

**Status**: ✅ MVP Complete - Ready for testing!
**Version**: 1.0.0
**Last Updated**: December 4, 2025
