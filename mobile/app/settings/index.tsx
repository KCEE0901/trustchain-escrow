/**
 * Settings Screen
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Switch, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import {
  isBiometricAvailable,
  isBiometricEnabled,
  setBiometricEnabled,
  getSupportedBiometricTypes,
} from '../../services/biometrics';
import Card from '../../components/ui/Card';
import { useWalletStore } from '../../store/useWalletStore';
import { truncateAddress } from '../../lib/stellar';

// Tapping the version string this many times within DEV_TAP_WINDOW_MS enables
// the hidden developer menu (#456).
const DEV_TAP_COUNT = 5;
const DEV_TAP_WINDOW_MS = 3000;

// `nativeAppVersion`/`nativeBuildVersion` read the running native binary's
// actual metadata (set at build time), which stays correct even after an
// OTA JS update — unlike `Constants.expoConfig.version`, which reflects
// whatever app.json shipped with the JS bundle. Falls back to the config
// value (and "1") for environments without a native build, e.g. Expo Go.
const APP_VERSION =
  Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '0.0.0';
const BUILD_NUMBER = Constants.nativeBuildVersion ?? '1';

export default function SettingsScreen() {
  const address = useWalletStore((s) => s.address)!;
  const network = useWalletStore((s) => s.network);
  const [biometricOn, setBiometricOn] = useState(isBiometricEnabled());
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricTypes, setBiometricTypes] = useState<string[]>([]);
  const versionTapCount = useRef(0);
  const versionTapResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void isBiometricAvailable().then(setBiometricAvailable);
    void getSupportedBiometricTypes().then(setBiometricTypes);
    return () => {
      if (versionTapResetTimer.current) clearTimeout(versionTapResetTimer.current);
    };
  }, []);

  const toggleBiometric = (val: boolean) => {
    if (val && !biometricAvailable) {
      Alert.alert('Not Available', 'Biometric authentication is not set up on this device.');
      return;
    }
    setBiometricEnabled(val);
    setBiometricOn(val);
  };

  const handleVersionTap = () => {
    versionTapCount.current += 1;
    if (versionTapResetTimer.current) clearTimeout(versionTapResetTimer.current);

    if (versionTapCount.current >= DEV_TAP_COUNT) {
      versionTapCount.current = 0;
      Alert.alert('Developer Mode', 'Developer mode unlocked.');
      return;
    }

    versionTapResetTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
    }, DEV_TAP_WINDOW_MS);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Account */}
        <Text style={styles.section}>Account</Text>
        <Card style={styles.card}>
          <SettingRow label="Address" value={truncateAddress(address, 8, 6)} />
          <SettingRow label="Network" value={network} />
        </Card>

        {/* Security */}
        <Text style={styles.section}>Security</Text>
        <Card style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchLeft}>
              <Text style={styles.switchLabel}>
                {biometricTypes.length > 0 ? biometricTypes.join(' / ') : 'Biometric Auth'}
              </Text>
              <Text style={styles.switchSub}>
                {biometricAvailable
                  ? 'Require authentication to open the app'
                  : 'Not available on this device'}
              </Text>
            </View>
            <Switch
              value={biometricOn}
              onValueChange={toggleBiometric}
              trackColor={{ false: '#374151', true: '#4338ca' }}
              thumbColor={biometricOn ? '#6366f1' : '#9ca3af'}
              disabled={!biometricAvailable}
            />
          </View>
        </Card>

        {/* About */}
        <Text style={styles.section}>About</Text>
        <Card style={styles.card}>
          <SettingRow label="Network" value={network === 'mainnet' ? 'Mainnet' : 'Testnet'} />
        </Card>

        <TouchableOpacity
          onPress={handleVersionTap}
          activeOpacity={1}
          accessibilityRole="none"
          testID="app-version-text"
        >
          <Text style={styles.versionText}>
            Version {APP_VERSION} (Build {BUILD_NUMBER})
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { padding: 16, paddingBottom: 48 },
  section: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
  },
  card: { marginBottom: 4 },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  settingLabel: { fontSize: 14, color: '#d1d5db' },
  settingValue: { fontSize: 14, color: '#9ca3af', fontFamily: 'monospace' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  switchLeft: { flex: 1, marginRight: 16 },
  switchLabel: { fontSize: 14, color: '#d1d5db', fontWeight: '500' },
  switchSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  versionText: {
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 24,
  },
});
