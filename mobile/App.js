import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, StatusBar, SafeAreaView,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKEND_URL } from './config';

const C = { bg: '#F5F6F1', ink: '#12263A', mute: '#6B7A89', line: '#D9DED6', tape: '#E4005B', done: '#0E7C5A' };

// Monday 00:00 local time of the current week
function weekStart() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}
const fmtTime = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
const fmtPace = (m, s) => (m > 0 ? `${Math.floor(s / 60 / (m / 1000))}:${String(Math.round((s / (m / 1000)) % 60)).padStart(2, '0')} /km` : '-');

export default function App() {
  const [athlete, setAthlete] = useState(null);       // { id, name }
  const [goal, setGoal] = useState({ type: 'distance', target: 20 }); // km or minutes
  const [draft, setDraft] = useState('20');
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      const a = await AsyncStorage.getItem('athlete');
      const g = await AsyncStorage.getItem('goal');
      if (g) { const p = JSON.parse(g); setGoal(p); setDraft(String(p.target)); }
      if (a) setAthlete(JSON.parse(a));
      setLoading(false);
    })();
  }, []);

  const fetchRuns = useCallback(async (a = athlete) => {
    if (!a) return;
    try {
      const after = Math.floor(weekStart().getTime() / 1000);
      const r = await fetch(`${BACKEND_URL}/activities?after=${after}`, { headers: { Authorization: `Bearer ${a.token}` } });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setRuns(j.activities);
    } catch (e) {
      Alert.alert('Could not load runs', `${e.message}\n\nThe free Render server sleeps when idle, so the first request can take up to a minute. Pull down to try again.`);
    }
  }, [athlete]);

  useEffect(() => { if (athlete) fetchRuns(); }, [athlete]);

  async function connect() {
    try {
      const { loginId } = await (await fetch(`${BACKEND_URL}/auth/init`)).json();
      WebBrowser.openBrowserAsync(`${BACKEND_URL}/auth/start?loginId=${loginId}`);
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const j = await (await fetch(`${BACKEND_URL}/auth/claim?loginId=${loginId}`)).json();
        if (j.token) {
          const a = { id: j.athleteId, name: j.name, token: j.token };
          await AsyncStorage.setItem('athlete', JSON.stringify(a));
          try { WebBrowser.dismissBrowser(); } catch (_) {}
          setAthlete(a);
          return;
        }
      }
      Alert.alert('Timed out', 'Please tap Connect with Strava and try again.');
    } catch (e) {
      Alert.alert('Could not start login', `${e.message}\n\nThe free Render server may be waking up. Wait a moment and try again.`);
    }
  }

  async function disconnect() {
    try { await fetch(`${BACKEND_URL}/me`, { method: 'DELETE', headers: { Authorization: `Bearer ${athlete.token}` } }); } catch (_) {}
    await AsyncStorage.removeItem('athlete');
    setAthlete(null); setRuns([]);
  }

  async function saveGoal(type, targetStr) {
    const target = parseFloat(targetStr);
    if (!target || target <= 0) return Alert.alert('Enter a goal above zero');
    const g = { type, target };
    setGoal(g);
    await AsyncStorage.setItem('goal', JSON.stringify(g));
  }

  const totalKm = runs.reduce((s, r) => s + r.distanceM, 0) / 1000;
  const totalMin = runs.reduce((s, r) => s + r.movingTimeS, 0) / 60;
  const totalCal = runs.reduce((s, r) => s + (r.calories || 0), 0);
  const progress = goal.type === 'distance' ? totalKm : totalMin;
  const pct = Math.min(progress / goal.target, 1);
  const hit = pct >= 1;
  const unit = goal.type === 'distance' ? 'km' : 'min';

  if (loading) return <View style={s.center}><ActivityIndicator color={C.ink} /></View>;

  if (!athlete) {
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar barStyle="dark-content" />
        <View style={[s.pad, { flex: 1, justifyContent: 'center' }]}>
          <Text style={s.h1}>Run the week.{'\n'}Earn the finish.</Text>
          <Text style={s.body}>Connect Strava, set a weekly goal, and every run you record counts toward it automatically.</Text>
          <TouchableOpacity style={s.btn} onPress={connect}>
            <Text style={s.btnText}>Connect with Strava</Text>
          </TouchableOpacity>
          <Text style={s.small}>Powered by Strava</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={s.pad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchRuns(); setRefreshing(false); }} />}>
        <Text style={s.h2}>Hi {athlete.name}</Text>
        <Text style={s.small}>Week of {weekStart().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</Text>

        {/* Lane-style progress track */}
        <View style={s.hero}>
          <Text style={s.big}>{goal.type === 'distance' ? progress.toFixed(1) : Math.round(progress)}
            <Text style={s.bigUnit}> / {goal.target} {unit}</Text></Text>
          <View style={s.lane}>
            <View style={[s.laneFill, { width: `${pct * 100}%`, backgroundColor: hit ? C.done : C.tape }]} />
            {[0.25, 0.5, 0.75].map((m) => <View key={m} style={[s.tick, { left: `${m * 100}%` }]} />)}
          </View>
          <Text style={s.body}>
            {hit ? 'Goal complete. Finish tape broken!' : `${(goal.target - progress).toFixed(goal.type === 'distance' ? 1 : 0)} ${unit} to go`}
          </Text>
        </View>

        {hit && (
          <View style={s.reward}>
            <Text style={s.rewardTitle}>Reward unlocked</Text>
            <Text style={s.body}>Weekly {goal.type === 'distance' ? 'distance' : 'time'} badge earned. Partner rewards will appear here.</Text>
          </View>
        )}

        <View style={s.stats}>
          <Stat label="Runs" value={runs.length} />
          <Stat label="Time" value={fmtTime(totalMin * 60)} />
          <Stat label="Calories" value={Math.round(totalCal)} />
        </View>

        <Text style={s.h3}>Weekly goal</Text>
        <View style={s.row}>
          {['distance', 'time'].map((t) => (
            <TouchableOpacity key={t} style={[s.chip, goal.type === t && s.chipOn]}
              onPress={() => { const d = t === 'distance' ? '20' : '180'; setDraft(d); saveGoal(t, d); }}>
              <Text style={[s.chipText, goal.type === t && { color: '#fff' }]}>{t === 'distance' ? 'Distance (km)' : 'Time (min)'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.row}>
          <TextInput style={s.input} keyboardType="numeric" value={draft} onChangeText={setDraft} />
          <TouchableOpacity style={s.btnSmall} onPress={() => saveGoal(goal.type, draft)}>
            <Text style={s.btnText}>Save goal</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.h3}>Runs counted this week</Text>
        {runs.length === 0 && <Text style={s.body}>No runs yet this week. Record one on Strava, then pull down to refresh.</Text>}
        {runs.map((r) => (
          <View key={r.id} style={s.run}>
            <View style={{ flex: 1 }}>
              <Text style={s.runName}>{r.name}</Text>
              <Text style={s.small}>{new Date(r.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}  ·  {fmtPace(r.distanceM, r.movingTimeS)}{r.calories ? `  ·  ${Math.round(r.calories)} kcal` : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.runDist}>{(r.distanceM / 1000).toFixed(2)} km</Text>
              <Text style={s.small}>{fmtTime(r.movingTimeS)}</Text>
            </View>
          </View>
        ))}

        <TouchableOpacity onPress={disconnect}><Text style={[s.small, { textAlign: 'center', marginTop: 28 }]}>Disconnect Strava</Text></TouchableOpacity>
        <Text style={[s.small, { textAlign: 'center', marginTop: 8 }]}>Powered by Strava</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const Stat = ({ label, value }) => (
  <View style={s.stat}><Text style={s.statVal}>{value}</Text><Text style={s.small}>{label}</Text></View>
);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  pad: { padding: 22, paddingBottom: 48 },
  h1: { fontSize: 38, fontWeight: '800', color: C.ink, lineHeight: 42, marginBottom: 14 },
  h2: { fontSize: 24, fontWeight: '700', color: C.ink },
  h3: { fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 28, marginBottom: 10 },
  body: { fontSize: 15, color: C.ink, lineHeight: 21 },
  small: { fontSize: 13, color: C.mute },
  btn: { backgroundColor: C.tape, borderRadius: 10, paddingVertical: 15, alignItems: 'center', marginTop: 28, marginBottom: 12 },
  btnSmall: { backgroundColor: C.ink, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18, marginLeft: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hero: { marginTop: 18, paddingVertical: 8 },
  big: { fontSize: 52, fontWeight: '800', color: C.ink },
  bigUnit: { fontSize: 20, fontWeight: '500', color: C.mute },
  lane: { height: 18, backgroundColor: '#E6E9E1', borderRadius: 3, marginVertical: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  laneFill: { height: '100%' },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: C.bg },
  reward: { backgroundColor: '#E3F1EB', borderLeftWidth: 4, borderLeftColor: C.done, padding: 14, marginTop: 8 },
  rewardTitle: { fontWeight: '800', color: C.done, fontSize: 16, marginBottom: 4 },
  stats: { flexDirection: 'row', marginTop: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line },
  stat: { flex: 1, paddingVertical: 14 },
  statVal: { fontSize: 22, fontWeight: '700', color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: C.ink, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8 },
  chipOn: { backgroundColor: C.ink },
  chipText: { color: C.ink, fontWeight: '600' },
  input: { flex: 1, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 16 },
  run: { flexDirection: 'row', paddingVertical: 14, borderBottomWidth: 1, borderColor: C.line },
  runName: { fontSize: 16, fontWeight: '600', color: C.ink, marginBottom: 2 },
  runDist: { fontSize: 17, fontWeight: '700', color: C.ink },
});
