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
import { C, Fonts } from './theme';

export function TeamSection({
  userId,
  currentTeam,
  onChange,
  bare,
}: {
  userId: string;
  currentTeam: string;
  onChange: (teamName: string) => void;
  /** Embed inside an existing card (no own card chrome / title) — e.g. a
   *  collapsible "Team" row on the You page. */
  bare?: boolean;
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
    <View style={bare ? styles.bare : styles.section}>
      {!bare && <Text style={styles.sectionTitle}>Team</Text>}
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
        <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />
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
          placeholderTextColor={C.muted}
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
    backgroundColor: C.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  bare: { marginTop: 4 },
  sectionTitle: {
    fontFamily: Fonts.headlineBold,
    fontSize: 17,
    color: C.dark,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  subtext: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 17 },

  currentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  currentLabel: {
    color: C.heroSub,
    fontFamily: Fonts.bodySemibold,
    fontSize: 11,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  currentName: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 18 },
  leaveBtn: {
    backgroundColor: 'rgba(254,252,221,0.18)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  leaveText: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 13 },

  soloCard: {
    backgroundColor: C.tint,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  soloText: { color: C.text2, fontFamily: Fonts.body, fontSize: 13, lineHeight: 18 },

  list: { gap: 8, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  rowName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: C.dark },
  rowMeta: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 2 },
  joinBtn: {
    backgroundColor: C.primary,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 18,
  },
  joinText: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 13 },
  joinedPill: {
    backgroundColor: C.tint,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  joinedText: { color: C.primary, fontFamily: Fonts.bodyBold, fontSize: 13 },
  empty: { color: C.muted, fontFamily: Fonts.body, fontSize: 13, marginVertical: 10 },

  createLabel: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 11,
    color: C.muted,
    letterSpacing: 0.3,
    marginTop: 14,
    marginBottom: 8,
  },
  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  createInput: {
    flex: 1,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: C.dark,
  },
  createBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  createBtnDisabled: { opacity: 0.5 },
  createText: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 14 },
});
