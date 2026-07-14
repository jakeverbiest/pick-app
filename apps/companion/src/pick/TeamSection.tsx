/**
 * TeamSection — the team directory + create/join/leave UI for the You screen.
 *
 * Browsing and joining is instant (writes the user's team into their settings
 * immediately), independent of the screen's Edit/Save flow. Member and pickup
 * counts come from the team_stats leaderboard aggregate (Cloud Function), so a
 * brand-new team shows zeros until its first cleanup.
 */
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getDatabase } from '../services/database';
import type { TeamDirWithStats } from '../services/firebaseDatabase';
import { COLORS } from '../constants/colors';

export function TeamSection({
  userId,
  currentTeam,
  onChange,
}: {
  userId: string;
  currentTeam: string;
  onChange: (teamName: string) => void;
}) {
  const [teams, setTeams] = useState<TeamDirWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const db = await getDatabase();
      setTeams(await db.getTeamsWithStats());
    } catch (e) {
      console.error('Failed to load teams:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const join = async (team: { id: string; name: string }) => {
    if (busy) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      await db.joinTeam(userId, team);
      onChange(team.name);
      await load();
    } catch (e: any) {
      Alert.alert('Could not join', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const createOrJoin = async () => {
    if (busy || !newName.trim()) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      const res = await db.joinOrCreateTeam(userId, newName);
      onChange(res.name);
      setNewName('');
      await load();
    } catch (e: any) {
      Alert.alert('Could not create team', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    Alert.alert(
      'Leave team?',
      `You'll go back to cleaning solo. Your past cleanups stay counted toward ${currentTeam}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const db = await getDatabase();
              await db.leaveTeam(userId);
              onChange('');
              await load();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Please try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Team</Text>
      <Text style={styles.subtext}>
        Join a team — every cleanup you log counts toward its leaderboard total.
      </Text>

      {currentTeam ? (
        <View style={styles.currentCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.currentLabel}>YOUR TEAM</Text>
            <Text style={styles.currentName}>{currentTeam}</Text>
          </View>
          <TouchableOpacity style={styles.leaveBtn} onPress={leave} disabled={busy}>
            <Text style={styles.leaveText}>Leave</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.soloCard}>
          <Text style={styles.soloText}>You're cleaning solo — join or start a team below.</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={COLORS.sage} style={{ marginVertical: 16 }} />
      ) : teams.length > 0 ? (
        <View style={styles.list}>
          {teams.map((t) => {
            const mine = t.name === currentTeam;
            return (
              <View key={t.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{t.name}</Text>
                  <Text style={styles.rowMeta}>
                    {t.member_count} member{t.member_count === 1 ? '' : 's'} · {t.total_pickups} pickups
                  </Text>
                </View>
                {mine ? (
                  <View style={styles.joinedPill}>
                    <Text style={styles.joinedText}>Joined</Text>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.joinBtn} onPress={() => join(t)} disabled={busy}>
                    <Text style={styles.joinText}>Join</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.empty}>No teams yet — be the first to start one.</Text>
      )}

      <Text style={styles.createLabel}>Start a new team</Text>
      <View style={styles.createRow}>
        <TextInput
          style={styles.createInput}
          placeholder="Team name (school, work, group)"
          placeholderTextColor={COLORS.mutedSage}
          value={newName}
          onChangeText={setNewName}
          maxLength={60}
          autoCapitalize="words"
        />
        <TouchableOpacity
          style={[styles.createBtn, (!newName.trim() || busy) && styles.createBtnDisabled]}
          onPress={createOrJoin}
          disabled={!newName.trim() || busy}
        >
          <Text style={styles.createText}>Create</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#1B2E1A',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  subtext: { fontSize: 12, color: COLORS.mutedSage, marginBottom: 12, lineHeight: 17 },

  currentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.sage,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  currentLabel: {
    color: '#C7D6B4',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  currentName: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  leaveBtn: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  leaveText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },

  soloCard: {
    backgroundColor: COLORS.cream,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  soloText: { color: COLORS.mutedSage, fontSize: 13, lineHeight: 18 },

  list: { gap: 8, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  rowName: { fontSize: 15, fontWeight: '700', color: COLORS.darkSage },
  rowMeta: { fontSize: 12, color: COLORS.mutedSage, marginTop: 2 },
  joinBtn: {
    backgroundColor: COLORS.sage,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 18,
  },
  joinText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  joinedPill: {
    backgroundColor: COLORS.cream,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  joinedText: { color: COLORS.sage, fontWeight: '700', fontSize: 13 },
  empty: { color: COLORS.mutedSage, fontSize: 13, marginVertical: 10 },

  createLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.mutedSage,
    letterSpacing: 0.3,
    marginTop: 14,
    marginBottom: 8,
  },
  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  createInput: {
    flex: 1,
    backgroundColor: COLORS.light,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: COLORS.darkSage,
  },
  createBtn: {
    backgroundColor: COLORS.sage,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  createBtnDisabled: { opacity: 0.5 },
  createText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
});
