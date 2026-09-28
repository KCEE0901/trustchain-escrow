/**
 * Root layout — sets up providers, initialises services, handles deep links.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWalletStore } from '../store/useWalletStore';
import { initOfflineDb } from '../services/offlineCache';
import { setupNotificationListeners } from '../services/notifications';
import { isTestnet } from '../lib/stellar';

/** Small pill indicating the active Stellar network. Hidden on mainnet. */
function NetworkBadge() {
  const insets = useSafeAreaInsets();

  if (!isTestnet) return null;

  return (
    <View
      style={[styles.networkBadge, { top: insets.top + 6 }]}
      pointerEvents="none"
      accessibilityLabel="Connected to Stellar testnet"
    >
      <Text style={styles.networkBadgeText}>TESTNET</Text>
    </View>
  );
}

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

export default function RootLayout() {
  const hydrate = useWalletStore((s) => s.hydrate);
  const router = useRouter();

  useEffect(() => {
    hydrate();
    initOfflineDb();

    const cleanup = setupNotificationListeners(
      () => {}, // foreground — banner handles it
      (response) => {
        const data = response.notification.request.content.data as Record<string, string>;
        if (data?.escrowId) {
          // Validate escrowId: only numeric chars, reject path traversal
          const VALID_ESCROW_ID = /^[0-9]+$/;
          if (VALID_ESCROW_ID.test(data.escrowId)) {
            void router.push(`/escrow/${data.escrowId}`);
          } else {
            console.error(`[Security] Invalid escrowId in notification: ${data.escrowId}`);
          }
        }
      },
    );

    return cleanup;
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
          <NetworkBadge />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  networkBadge: {
    position: 'absolute',
    right: 12,
    backgroundColor: '#78350f',
    borderColor: '#fbbf24',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    zIndex: 999,
  },
  networkBadgeText: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
