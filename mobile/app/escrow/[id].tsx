/**
 * Escrow Detail Screen — biometric-gated.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEscrow, useMilestones, useApproveMilestone } from '../../hooks/useEscrows';
import { useWalletStore } from '../../store/useWalletStore';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import MilestoneItem from '../../components/escrow/MilestoneItem';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { truncateAddress, stroopsToXlm, explorerUrl } from '../../lib/stellar';
import { authenticate, isBiometricAvailable, isBiometricEnabled } from '../../services/biometrics';
import type { Milestone } from '../../lib/api';

/**
 * Gates a sensitive action behind biometric re-authentication.
 * Runs on every call — approval must never be cached across invocations.
 * Falls back to an explicit warning when biometrics are unavailable/unenrolled,
 * since failing open would let anyone approve a milestone release unattended.
 */
async function requireBiometricApproval(reason: string): Promise<boolean> {
  const available = await isBiometricAvailable();

  if (!available) {
    return new Promise((resolve) => {
      Alert.alert(
        'Biometric authentication unavailable',
        'This device has no biometrics enrolled, so we can’t verify it’s you. ' +
          'Set up Face ID / Fingerprint in your device settings, or continue with reduced security.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Continue anyway', style: 'destructive', onPress: () => resolve(true) },
        ],
      );
    });
  }

  const ok = await authenticate(reason);
  if (!ok) {
    Alert.alert('Authentication failed', 'Biometric verification failed. The action was cancelled.');
  }
  return ok;
}

export default function EscrowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const address = useWalletStore((s) => s.address);
  const router = useRouter();
  const [authed, setAuthed] = useState(!isBiometricEnabled());
  const [approvingIndex, setApprovingIndex] = useState<number | null>(null);

  const { data: escrow, isLoading, refetch } = useEscrow(authed && id ? id : null);
  const { data: milestones = [], isLoading: milestonesLoading } = useMilestones(
    authed && escrow && id ? id : null,
  );
  const approveMilestone = useApproveMilestone(id ?? null);

  useEffect(() => {
    if (!authed && isBiometricEnabled()) {
      void authenticate('Authenticate to view escrow details').then((ok) => {
        if (ok) {
          setAuthed(true);
        } else {
          router.back();
        }
      });
    }
  }, [authed, router]);

  async function handleApproveMilestone(milestone: Milestone) {
    const ok = await requireBiometricApproval('Approve milestone release');
    if (!ok) return;

    setApprovingIndex(milestone.milestoneIndex);
    try {
      await approveMilestone.mutateAsync(milestone.milestoneIndex);
      Alert.alert('Milestone approved', 'The milestone release transaction was submitted.');
    } catch (err) {
      Alert.alert(
        'Approval failed',
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setApprovingIndex(null);
    }
  }

  // Render skeleton while biometric auth is pending
  if (!authed && isBiometricEnabled()) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <Card style={styles.headerCard}>
            <View style={[styles.skeleton, { height: 20, marginBottom: 12 }]} />
            <View style={[styles.skeleton, { height: 40, marginBottom: 8 }]} />
            <View style={[styles.skeleton, { height: 14 }]} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState icon="⏳" title="Loading escrow…" />
      </SafeAreaView>
    );
  }

  if (!escrow) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState
          icon="❌"
          title="Escrow not found"
          subtitle="It may have been removed or you're offline."
        />
      </SafeAreaView>
    );
  }

  const isClient = escrow.clientAddress === address;
  const isFreelancer = escrow.freelancerAddress === address;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isLoading || milestonesLoading}
            onRefresh={refetch}
            tintColor="#6366f1"
          />
        }
      >
        {/* Status + amount */}
        <Card style={styles.headerCard}>
          <View style={styles.row}>
            <Text style={styles.escrowId}>Escrow #{escrow.id}</Text>
            <Badge status={escrow.status} />
          </View>
          <Text style={styles.amount}>{stroopsToXlm(escrow.totalAmount)} XLM</Text>
          <Text style={styles.remaining}>
            Remaining: {stroopsToXlm(escrow.remainingBalance)} XLM
          </Text>
          {escrow.deadline && (
            <Text style={styles.deadline}>
              Deadline: {new Date(escrow.deadline).toLocaleDateString()}
            </Text>
          )}
        </Card>

        {/* Parties */}
        <Card style={styles.partiesCard}>
          <PartyRow label="Client" address={escrow.clientAddress} isYou={isClient} />
          <PartyRow label="Freelancer" address={escrow.freelancerAddress} isYou={isFreelancer} />
          {escrow.arbiterAddress && (
            <PartyRow label="Arbiter" address={escrow.arbiterAddress} isYou={false} />
          )}
        </Card>

        {/* Milestones */}
        <Text style={styles.sectionTitle}>Milestones ({milestones.length})</Text>
        <Card>
          {milestones.length === 0 ? (
            <Text style={styles.emptyMilestones}>No milestones yet.</Text>
          ) : (
            milestones.map((m, i) => (
              <View key={m.id}>
                <MilestoneItem milestone={m} index={i} />
                {isClient && m.status === 'Submitted' && (
                  <Button
                    title={
                      approvingIndex === m.milestoneIndex ? 'Approving…' : 'Approve Milestone'
                    }
                    onPress={() => void handleApproveMilestone(m)}
                    disabled={approvingIndex !== null}
                    style={styles.approveBtn}
                  />
                )}
              </View>
            ))
          )}
        </Card>

        {/* Actions */}
        {escrow.status === 'Active' && (
          <View style={styles.actionsSection}>
            <Text style={styles.sectionTitle}>Actions</Text>
            <Button
              title="View on Stellar Expert"
              onPress={() => void Linking.openURL(explorerUrl('account', escrow.clientAddress))}
              variant="ghost"
              style={styles.actionBtn}
            />
            {(isClient || isFreelancer) && (
              <Button
                title="Raise Dispute"
                onPress={() =>
                  Alert.alert(
                    'Raise Dispute',
                    'Disputes are handled on-chain. Sign a transaction in your Stellar wallet app.',
                    [{ text: 'OK' }],
                  )
                }
                variant="danger"
                style={styles.actionBtn}
              />
            )}
          </View>
        )}

        {escrow.status === 'Disputed' && (
          <Card style={styles.disputeCard}>
            <Text style={styles.disputeTitle}>⚠️ Dispute Active</Text>
            <Text style={styles.disputeText}>
              This escrow is under dispute. An arbiter will review and resolve it on-chain.
            </Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PartyRow({ label, address, isYou }: { label: string; address: string; isYou: boolean }) {
  return (
    <View style={styles.partyRow}>
      <Text style={styles.partyLabel}>{label}</Text>
      <View style={styles.partyRight}>
        <Text style={styles.partyAddress}>{truncateAddress(address, 8, 6)}</Text>
        {isYou && <Text style={styles.youBadge}>You</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { padding: 16, paddingBottom: 48 },
  skeleton: {
    backgroundColor: '#1f2937',
    borderRadius: 6,
  },
  headerCard: { marginBottom: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  escrowId: { fontSize: 14, fontWeight: '700', color: '#9ca3af' },
  amount: { fontSize: 32, fontWeight: '800', color: '#f9fafb', marginBottom: 4 },
  remaining: { fontSize: 13, color: '#6b7280' },
  deadline: { fontSize: 13, color: '#f59e0b', marginTop: 4 },
  partiesCard: { marginBottom: 20 },
  partyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  partyLabel: { fontSize: 13, color: '#6b7280', width: 80 },
  partyRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partyAddress: { fontSize: 13, color: '#f9fafb', fontFamily: 'monospace' },
  youBadge: {
    fontSize: 10,
    color: '#6366f1',
    backgroundColor: '#1e1b4b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#f9fafb', marginBottom: 10 },
  emptyMilestones: { color: '#6b7280', textAlign: 'center', padding: 16 },
  approveBtn: { marginBottom: 12, marginTop: -4 },
  actionsSection: { marginTop: 24 },
  actionBtn: { marginBottom: 10 },
  disputeCard: { marginTop: 16, borderColor: '#7c2d12', backgroundColor: '#1c0a00' },
  disputeTitle: { fontSize: 15, fontWeight: '700', color: '#fb923c', marginBottom: 6 },
  disputeText: { fontSize: 13, color: '#9ca3af', lineHeight: 20 },
});
