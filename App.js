import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView,
  Image, RefreshControl, ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const C = { bg: '#0d0d12', card: '#1a1a22', text: '#ffffff', sub: '#9a9aa8', accent: '#7c5cff', danger: '#ff5c6c' };
const KEY = 'addons_v1';

// ---------- Addon helpers ----------
function toBase(input) {
  let u = input.trim().replace(/^stremio:\/\//i, 'https://');
  u = u.replace(/\/manifest\.json.*$/i, '').replace(/\/+$/, '');
  return u;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function loadAddons() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

async function saveAddons(list) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

async function addAddon(input) {
  const base = toBase(input);
  if (!/^https?:\/\//i.test(base)) throw new Error('লিংক http বা https দিয়ে শুরু হতে হবে');
  const m = await getJson(base + '/manifest.json');
  if (!m.id || !m.name) throw new Error('এটা সঠিক addon manifest না');
  const list = await loadAddons();
  if (list.some((a) => a.base === base)) throw new Error('এই addon আগেই যোগ করা আছে');
  const addon = {
    id: m.id,
    name: m.name,
    base,
    version: m.version || '',
    catalogs: m.catalogs || [],
    resources: (m.resources || []).map((r) => (typeof r === 'string' ? r : r.name)),
  };
  await saveAddons([...list, addon]);
  return addon;
}

function browsableCatalogs(addon) {
  return addon.catalogs.filter(
    (c) => !(c.extra || []).some((e) => e.isRequired) && !(c.extraRequired || []).length
  );
}

async function loadRows(addons) {
  const jobs = [];
  addons.forEach((a) =>
    browsableCatalogs(a).forEach((c) =>
      jobs.push(
        getJson(`${a.base}/catalog/${c.type}/${c.id}.json`).then((d) => ({
          key: `${a.id}:${c.type}:${c.id}`,
          title: c.name || c.id,
          sub: `${a.name} · ${c.type}`,
          items: d.metas || [],
        }))
      )
    )
  );
  const results = await Promise.allSettled(jobs);
  return results.filter((r) => r.status === 'fulfilled' && r.value.items.length).map((r) => r.value);
}

// ---------- Home ----------
function PosterCard({ item }) {
  return (
    <TouchableOpacity style={s.card} activeOpacity={0.8}>
      {item.poster ? (
        <Image source={{ uri: item.poster }} style={s.poster} />
      ) : (
        <View style={[s.poster, s.noPoster]}><Ionicons name="film-outline" size={28} color={C.sub} /></View>
      )}
      <Text style={s.cardTitle} numberOfLines={2}>{item.name}</Text>
    </TouchableOpacity>
  );
}

function HomeScreen({ navigation }) {
  const [rows, setRows] = useState([]);
  const [noAddons, setNoAddons] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const addons = await loadAddons();
    setNoAddons(addons.length === 0);
    setRows(await loadRows(addons));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  if (loading) return <View style={s.center}><ActivityIndicator color={C.accent} size="large" /></View>;

  if (noAddons) {
    return (
      <View style={s.center}>
        <Ionicons name="extension-puzzle-outline" size={48} color={C.sub} />
        <Text style={s.emptyTitle}>এখনো কোনো addon নেই</Text>
        <Text style={s.emptySub}>Addons ট্যাবে গিয়ে manifest লিংক যোগ করুন</Text>
        <TouchableOpacity style={s.btn} onPress={() => navigation.navigate('Addons')}>
          <Text style={s.btnText}>Addon যোগ করুন</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={s.screen}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.accent}
        onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {rows.length === 0 && <Text style={s.emptySub}>কোনো catalog পাওয়া যায়নি। নিচে টেনে রিফ্রেশ করুন।</Text>}
      {rows.map((row) => (
        <View key={row.key} style={{ marginBottom: 22 }}>
          <Text style={s.rowTitle}>{row.title}</Text>
          <Text style={s.rowSub}>{row.sub}</Text>
          <FlatList
            horizontal
            data={row.items}
            keyExtractor={(i, idx) => (i.id || '') + idx}
            renderItem={({ item }) => <PosterCard item={item} />}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12 }}
          />
        </View>
      ))}
    </ScrollView>
  );
}

// ---------- Addons ----------
function AddonsScreen() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);

  useFocusEffect(useCallback(() => { loadAddons().then(setList); }, []));

  const onAdd = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await addAddon(url);
      setUrl('');
      setList(await loadAddons());
    } catch (e) {
      Alert.alert('যোগ করা গেল না', e.message);
    }
    setBusy(false);
  };

  const onRemove = (addon) =>
    Alert.alert('মুছবেন?', addon.name, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'মুছুন', style: 'destructive', onPress: async () => {
          const next = list.filter((a) => a.base !== addon.base);
          await saveAddons(next);
          setList(next);
        } },
    ]);

  return (
    <View style={s.screen}>
      <View style={s.addBox}>
        <TextInput
          style={s.input}
          placeholder="Manifest লিংক পেস্ট করুন"
          placeholderTextColor={C.sub}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={s.btn} onPress={onAdd} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>যোগ করুন</Text>}
        </TouchableOpacity>
      </View>
      <FlatList
        data={list}
        keyExtractor={(a) => a.base}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={<Text style={s.emptySub}>এখনো কোনো addon যোগ করা হয়নি</Text>}
        renderItem={({ item }) => (
          <View style={s.addonItem}>
            <View style={{ flex: 1 }}>
              <Text style={s.addonName}>{item.name} {item.version ? `v${item.version}` : ''}</Text>
              <Text style={s.addonSub}>
                {item.catalogs.length} catalog · {item.resources.join(', ')}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onRemove(item)}>
              <Ionicons name="trash-outline" size={22} color={C.danger} />
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

// ---------- App ----------
const Tab = createBottomTabNavigator();
const icons = { Home: 'home', Addons: 'extension-puzzle' };

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: C.bg } }}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.text,
            tabBarStyle: { backgroundColor: C.bg, borderTopColor: C.card },
            tabBarActiveTintColor: C.accent,
            tabBarInactiveTintColor: C.sub,
            tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} size={size} color={color} />,
          })}
        >
          <Tab.Screen name="Home" component={HomeScreen} />
          <Tab.Screen name="Addons" component={AddonsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingTop: 12 },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '600', marginTop: 14 },
  emptySub: { color: C.sub, fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 16, paddingHorizontal: 16 },
  btn: { backgroundColor: C.accent, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
  rowTitle: { color: C.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 12 },
  rowSub: { color: C.sub, fontSize: 12, paddingHorizontal: 12, marginBottom: 8 },
  card: { width: 110, marginRight: 10 },
  poster: { width: 110, height: 165, borderRadius: 8, backgroundColor: C.card },
  noPoster: { alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: C.text, fontSize: 12, marginTop: 6 },
  addBox: { paddingHorizontal: 12, gap: 10 },
  input: { backgroundColor: C.card, color: C.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  addonItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10, padding: 14, marginBottom: 10 },
  addonName: { color: C.text, fontSize: 16, fontWeight: '600' },
  addonSub: { color: C.sub, fontSize: 12, marginTop: 3 },
});
