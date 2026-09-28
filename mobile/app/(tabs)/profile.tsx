/**
 * Profile Tab — connected user's reputation and stats.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useWalletStore } from '../../store/useWalletStore';
import { useReputation, getReputationBadge } from '../../hooks/useReputation';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { kycApi } from '../../lib/api';
import { stroopsToXlm, explorerUrl } from '../../lib/stellar';

type KycBadgeStatus = 'Verified' | 'Pending' | 'Unverified';

function mapKycStatus(status?: string): KycBadgeStatus {
  if (status === 'Approved') return 'Verified';
  if (status === 'Init' || status === 'Processing') return 'Pending';
  return 'Unverified';
}

export default function ProfileScreen() {
  const address = useWalletStore((s) => s.address)!;
  const disconnect = useWalletStore((s) => s.disconnect);
  const router = useRouter();
  const { data: rep, isLoading } = useReputation(address);
  const badge = rep ? getReputationBadge(Number(rep.totalScore)) : null;

  const [kycStatus, setKycStatus] = useState<KycBadgeStatus | null>(null);
  const [kycLoading, setKycLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setKycLoading(true);
    kycApi
      .getKycStatus(address)
      .then(({ data }) => {
        if (mounted) setKycStatus(mapKycStatus(data.status));
      })
      .catch(() => {
        if (mounted) setKycStatus('Unverified');
      })
      .finally(() => {
        if (mounted) setKycLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [address]);

  const handleKycPress = () => {
    if (kycStatus === 'Unverified') {
      void router.push('/kyc');
    }
  };

  const handleDisconnect = () => {
    Alert.alert('Disconnect Wallet', 'Are you sure you want to disconnect?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          disconnect();
          void router.replace('/(auth)/connect');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Address card */}
        <Card style={styles.addressCard}>
          <Text style={styles.addressLabel}>Connected Address</Text>
          <Text style={styles.address} selectable>
            {address}
          </Text>
          <TouchableOpacity
            onPress={() => void Linking.openURL(explorerUrl('account', address))}
            style={styles.explorerLink}
          >
            <Text style={styles.explorerLinkText}>View on Stellar Expert →</Text>
          </TouchableOpacity>
        </Card>

        {/* KYC status */}
        <Card style={styles.kycCard}>
          <View style={styles.kycRow}>
            <Text style={styles.kycLabel}>KYC Verification</Text>
            {kycLoading ? (
              <View style={styles.kycSkeleton} />
            ) : (
              <TouchableOpacity
                onPress={handleKycPress}
                disabled={kycStatus !== 'Unverified'}
                accessibilityRole="button"
              >
                <Badge status={kycStatus ?? 'Unverified'} />
              </TouchableOpacity>
            )}
          </View>
        </Card>

        {/* Reputation */}
        {isLoading ? (
          <Text style={styles.loading}>Loading reputation…</Text>
        ) : rep ? (
          <Card style={styles.repCard}>
            <View style={styles.repHeader}>
              <Text style={styles.repScore}>{rep.totalScore.toString()}</Text>
              {badge && (
                <View style={[styles.badge, { backgroundColor: `${badge.color}22` }]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              )}
            </View>
            <Text style={styles.repTitle}>Reputation Score</Text>
            <View style={styles.statsGrid}>
              <StatBox label="Completed" value={rep.completedEscrows} />
              <StatBox label="Disputed" value={rep.disputedEscrows} />
              <StatBox label="Won" value={rep.disputesWon} />
              <StatBox label="Volume" value={`${stroopsToXlm(rep.totalVolume)} XLM`} />
            </View>
          </Card>
        ) : null}

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            title="KYC Verification"
            onPress={() => void router.push('/kyc')}
            variant="secondary"
            style={styles.actionBtn}
          />
          <Button
            title="Settings"
            onPress={() => void router.push('/settings')}
            variant="secondary"
            style={styles.actionBtn}
          />
          <Button title="Disconnect Wallet" onPress={handleDisconnect} variant="danger" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { padding: 16, paddingBottom: 48 },
  addressCard: { marginBottom: 16 },
  kycCard: { marginBottom: 16 },
  kycRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kycLabel: { fontSize: 14, fontWeight: '600', color: '#f9fafb' },
  kycSkeleton: { width: 78, height: 24, borderRadius: 999, backgroundColor: '#1f2937' },
  addressLabel: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  address: { fontSize: 13, color: '#f9fafb', fontFamily: 'monospace', lineHeight: 20 },
  explorerLink: { marginTop: 10 },
  explorerLinkText: { fontSize: 13, color: '#6366f1' },
  loading: { color: '#6b7280', textAlign: 'center', padding: 24 },
  repCard: { marginBottom: 24 },
  repHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  repScore: { fontSize: 40, fontWeight: '800', color: '#f9fafb' },
  badge: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  badgeText: { fontSize: 14, fontWeight: '700' },
  repTitle: { fontSize: 13, color: '#6b7280', marginBottom: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700', color: '#f9fafb' },
  statLabel: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  actions: { gap: 12 },
  actionBtn: {},
});
