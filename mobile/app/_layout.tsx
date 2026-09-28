/**
 * Root layout — sets up providers, initialises services, handles deep links.
 */

import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useWalletStore } from '../store/useWalletStore';
import { initOfflineDb } from '../services/offlineCache';
import {
  setupNotificationListeners,
  resolveNotificationEscrowId,
  registerForPushNotifications,
} from '../services/notifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
});

// Max safe escrow ID: 2^53 - 1 (JS number precision limit for BigInt-as-string)
const MAX_SAFE_ESCROW_ID = Number.MAX_SAFE_INTEGER;

function resolveDeepLinkEscrowId(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!/^\d{1,16}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SAFE_ESCROW_ID) return null;
  return s;
}

/**
 * Extracts the escrow id from a `trustchain://escrow/:id` (or
 * `stellartrustescrow://escrow/:id`) deep link URL.
 */
function escrowIdFromDeepLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const { hostname, path } = Linking.parse(url);
    if (hostname === 'escrow' && path) return resolveDeepLinkEscrowId(path);
    if (path?.startsWith('escrow/')) return resolveDeepLinkEscrowId(path.slice('escrow/'.length));
    return null;
  } catch {
    return null;
  }
}

export default function RootLayout() {
  const hydrate = useWalletStore((s) => s.hydrate);
  const router = useRouter();

  useEffect(() => {
    hydrate();
    initOfflineDb();

    // Re-register the push token on every launch for an already-connected wallet
    // (connect.tsx registers it the first time a wallet is connected).
    const address = useWalletStore.getState().address;
    if (address) {
      void registerForPushNotifications(address);
    }

    const cleanup = setupNotificationListeners(
      () => {}, // foreground — banner handles it
      (response) => {
        const escrowId = resolveNotificationEscrowId(response);
        if (escrowId) {
          void router.push(`/escrow/${escrowId}`);
        }
      },
    );

    // Cold start: app was opened from a dead state via a trustchain:// link.
    void Linking.getInitialURL().then((url) => {
      const escrowId = escrowIdFromDeepLink(url);
      if (escrowId) void router.push(`/escrow/${escrowId}`);
    });

    // Warm: app is already open and a trustchain:// link is tapped.
    const linkingSub = Linking.addEventListener('url', ({ url }) => {
      const escrowId = escrowIdFromDeepLink(url);
      if (escrowId) void router.push(`/escrow/${escrowId}`);
    });

    return () => {
      cleanup();
      linkingSub.remove();
    };
  }, [hydrate, router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#0f0f0f' },
              headerTintColor: '#f9fafb',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: '#0f0f0f' },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="escrow/[id]" options={{ title: 'Escrow Details' }} />
            <Stack.Screen name="escrow/create" options={{ title: 'Create Escrow' }} />
            <Stack.Screen name="profile/[address]" options={{ title: 'Profile' }} />
            <Stack.Screen name="kyc/index" options={{ title: 'KYC Verification' }} />
            <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
