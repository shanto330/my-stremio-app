import React, { useState, useCallback, useEffect, useMemo, useRef, useContext, createContext } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView, Modal, Linking,
  Image, RefreshControl, ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import Video from 'react-native-video';
import { NavigationContainer, DefaultTheme, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const C = { bg: '#0d0d12', card: '#1a1a22', text: '#ffffff', sub: '#9a9aa8', accent: '#7c5cff', danger: '#ff5c6c' };
const KEY = 'addons_v1';
const HKEY = 'history_v1';
const SKEY = 'settings_v1';
const DEFAULT_SETTINGS = { subLang: 'off', subSize: 20 };
const AppCtx = createContext({ openDetails: () => {}, openStreams: () => {} });

// ---------- Storage ----------
async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
async function writeJson(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}
const loadAddons = () => readJson(KEY, []);
const saveAddons = (list) => writeJson(KEY, list);
const loadSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await readJson(SKEY, {})) });
const loadHistory = () => readJson(HKEY, {});
async function saveProgress(entry) {
  const h = await loadHistory();
  h[entry.item.id] = entry;
  await writeJson(HKEY, h);
}
const slim = (i) => ({ id: i.id, type: i.type, name: i.name, poster: i.poster, background: i.background, addonBase: i.addonBase });

// ---------- Helpers ----------
const L3 = { eng: 'en', ben: 'bn', hin: 'hi', ara: 'ar', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', tur: 'tr', ind: 'id', por: 'pt', rus: 'ru' };
const norm = (l) => {
  const x = String(l || '').toLowerCase().split(/[-_]/)[0];
  return L3[x] || x.slice(0, 2);
};
const sameLang = (a, b) => !!a && !!b && norm(a) === norm(b);
const encId = (id) => encodeURIComponent(id).replace(/%3A/gi, ':');
function fmt(t) {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

// ---------- Addon helpers ----------
function toBase(input) {
  let u = input.trim().replace(/^stremio:\/\//i, 'https://');
  u = u.replace(/\/manifest\.json.*$/i, '').replace(/\/+$/, '');
  return u;
}

async function getJson(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
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

function searchCatalogs(addon) {
  return addon.catalogs.filter(
    (c) => (c.extra || []).some((e) => e.name === 'search') || (c.extraSupported || []).includes('search')
  );
}

const toRow = (a, c, d, suffix = '') => ({
  key: `${a.id}:${c.type}:${c.id}${suffix}`,
  title: c.name || c.id,
  sub: `${a.name} · ${c.type}`,
  items: (d.metas || []).map((m) => ({ ...m, type: m.type || c.type, addonBase: a.base })),
});

async function loadRows(addons) {
  const jobs = [];
  addons.forEach((a) =>
    browsableCatalogs(a).forEach((c) =>
      jobs.push(getJson(`${a.base}/catalog/${c.type}/${c.id}.json`).then((d) => toRow(a, c, d)))
    )
  );
  const results = await Promise.allSettled(jobs);
  return results.filter((r) => r.status === 'fulfilled' && r.value.items.length).map((r) => r.value);
}

async function searchAll(addons, q) {
  const jobs = [];
  addons.forEach((a) =>
    searchCatalogs(a).forEach((c) =>
      jobs.push(
        getJson(`${a.base}/catalog/${c.type}/${c.id}/search=${encodeURIComponent(q)}.json`).then((d) => toRow(a, c, d, ':s'))
      )
    )
  );
  const results = await Promise.allSettled(jobs);
  return results.filter((r) => r.status === 'fulfilled' && r.value.items.length).map((r) => r.value);
}

async function loadMeta(item) {
  const addons = await loadAddons();
  const withMeta = addons.filter((a) => a.resources.includes('meta'));
  const ordered = [
    ...withMeta.filter((a) => a.base === item.addonBase),
    ...withMeta.filter((a) => a.base !== item.addonBase),
  ];
  for (const a of ordered) {
    try {
      const d = await getJson(`${a.base}/meta/${item.type}/${encId(item.id)}.json`);
      if (d.meta) return d.meta;
    } catch (e) {}
  }
  return null;
}

async function loadStreams(type, videoId) {
  const addons = (await loadAddons()).filter((a) => a.resources.includes('stream'));
  const res = await Promise.allSettled(
    addons.map((a) =>
      getJson(`${a.base}/stream/${type}/${encId(videoId)}.json`, 20000).then((d) =>
        (d.streams || []).map((st) => ({ ...st, addonName: a.name }))
      )
    )
  );
  return res.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
}

async function loadSubs(type, videoId) {
  const addons = (await loadAddons()).filter((a) => a.resources.includes('subtitles'));
  const res = await Promise.allSettled(
    addons.map((a) =>
      getJson(`${a.base}/subtitles/${type}/${encId(videoId)}.json`, 4000).then((d) =>
        (d.subtitles || []).map((x) => ({ url: x.url, lang: x.lang || 'und', addonName: a.name }))
      )
    )
  );
  return res.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
}

// ---------- Poster / rows ----------
function PosterCard({ item }) {
  const { openDetails } = useContext(AppCtx);
  return (
    <TouchableOpacity style={s.card} activeOpacity={0.8} onPress={() => openDetails(item)}>
      {item.poster ? (
        <Image source={{ uri: item.poster }} style={s.poster} />
      ) : (
        <View style={[s.poster, s.noPoster]}><Ionicons name="film-outline" size={28} color={C.sub} /></View>
      )}
      {item._p ? (
        <View style={s.progBg}><View style={[s.progFill, { width: `${Math.min(100, item._p * 100)}%` }]} /></View>
      ) : null}
      <Text style={s.cardTitle} numberOfLines={2}>{item.name}</Text>
      {!!item._label && <Text style={s.cardLabel}>{item._label}</Text>}
    </TouchableOpacity>
  );
}

function CatalogRow({ row }) {
  return (
    <View style={{ marginBottom: 22 }}>
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
  );
}

// ---------- Details ----------
function DetailsModal({ item, onClose }) {
  const insets = useSafeAreaInsets();
  const { openStreams } = useContext(AppCtx);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [season, setSeason] = useState(null);

  useEffect(() => {
    if (!item) return;
    let alive = true;
    setMeta(null);
    setMissing(false);
    setSeason(null);
    setLoading(true);
    loadMeta(item).then((m) => {
      if (!alive) return;
      if (m) {
        setMeta(m);
        const nums = [...new Set((m.videos || []).map((v) => v.season).filter((n) => n !== undefined && n !== null))].sort((x, y) => x - y);
        setSeason(nums.find((n) => n > 0) ?? nums[0] ?? null);
      } else {
        setMeta(item);
        setMissing(true);
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [item]);

  const data = meta || item || {};
  const videos = data.videos || [];
  const seasons = [...new Set(videos.map((v) => v.season).filter((n) => n !== undefined && n !== null))].sort((x, y) => x - y);
  const episodes = videos
    .filter((v) => v.season === season)
    .sort((x, y) => (x.episode || 0) - (y.episode || 0));
  const line = [data.releaseInfo || data.year, data.imdbRating ? `★ ${data.imdbRating}` : null, data.runtime]
    .filter(Boolean)
    .join(' · ');
  const bg = data.background || data.poster;

  return (
    <Modal visible={!!item} animationType="slide" onRequestClose={onClose}>
      <View style={s.detailsRoot}>
        <ScrollView>
          {bg ? <Image source={{ uri: bg }} style={s.backdrop} /> : <View style={s.backdrop} />}
          <View style={s.detailsBody}>
            <Text style={s.detailsTitle}>{data.name}</Text>
            {!!line && <Text style={s.detailsLine}>{line}</Text>}
            {!!(data.genres || []).length && <Text style={s.detailsLine}>{data.genres.join(', ')}</Text>}
            {loading && <ActivityIndicator color={C.accent} style={{ marginVertical: 16 }} />}
            {!!data.description && <Text style={s.detailsDesc}>{data.description}</Text>}
            {missing && !loading && (
              <Text style={s.emptySub}>এই addon থেকে বিস্তারিত তথ্য পাওয়া যায়নি</Text>
            )}

            {!loading && videos.length === 0 && item && (
              <TouchableOpacity
                style={[s.btn, { marginTop: 18, flexDirection: 'row', gap: 8 }]}
                onPress={() => openStreams({ item, videoId: item.id })}
              >
                <Ionicons name="play" size={18} color="#fff" />
                <Text style={s.btnText}>Play</Text>
              </TouchableOpacity>
            )}

            {seasons.length > 0 && (
              <View style={{ marginTop: 18 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {seasons.map((n) => (
                    <TouchableOpacity key={n} onPress={() => setSeason(n)} style={[s.chip, n === season && s.chipOn]}>
                      <Text style={s.btnText}>{n === 0 ? 'Specials' : `Season ${n}`}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {episodes.map((ep, idx) => (
                  <TouchableOpacity
                    key={(ep.id || '') + idx}
                    style={s.episode}
                    activeOpacity={0.8}
                    onPress={() =>
                      openStreams({
                        item,
                        videoId: ep.id,
                        season: ep.season,
                        episode: ep.episode,
                        epTitle: ep.title || ep.name,
                      })
                    }
                  >
                    {ep.thumbnail ? (
                      <Image source={{ uri: ep.thumbnail }} style={s.epThumb} />
                    ) : (
                      <View style={[s.epThumb, s.noPoster]}><Ionicons name="play" size={20} color={C.sub} /></View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.addonName} numberOfLines={2}>
                        {ep.episode ? `${ep.episode}. ` : ''}{ep.title || ep.name || 'Episode'}
                      </Text>
                      {!!ep.released && <Text style={s.addonSub}>{String(ep.released).slice(0, 10)}</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
        <TouchableOpacity style={[s.backBtn, { top: insets.top + 10 }]} onPress={onClose}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ---------- Streams ----------
function StreamsModal({ req, onClose, onPlay }) {
  const [streams, setStreams] = useState(null);

  useEffect(() => {
    if (!req) return;
    let alive = true;
    setStreams(null);
    loadStreams(req.item.type, req.videoId).then((r) => {
      if (!alive) return;
      r.sort((a, b) => (b.url ? 1 : 0) - (a.url ? 1 : 0));
      setStreams(r);
    });
    return () => { alive = false; };
  }, [req]);

  const choose = (st) => {
    if (st.url) {
      const rh = st.behaviorHints && st.behaviorHints.proxyHeaders && st.behaviorHints.proxyHeaders.request;
      onPlay({
        ...req,
        url: st.url,
        headers: rh || undefined,
        extraSubs: (st.subtitles || []).map((x) => ({ url: x.url, lang: x.lang || 'und', addonName: st.addonName })),
      });
    } else if (st.externalUrl) {
      Linking.openURL(st.externalUrl);
    } else if (st.ytId) {
      Linking.openURL('https://www.youtube.com/watch?v=' + st.ytId);
    } else {
      Alert.alert('সাপোর্ট নেই', 'এটা টরেন্ট স্ট্রিম। এই অ্যাপ এখনো টরেন্ট চালাতে পারে না।');
    }
  };

  return (
    <Modal visible={!!req} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.rowTitle}>স্ট্রিম বেছে নিন</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
          </View>
          {streams === null ? (
            <ActivityIndicator color={C.accent} style={{ marginVertical: 30 }} />
          ) : streams.length === 0 ? (
            <Text style={s.emptySub}>কোনো স্ট্রিম পাওয়া যায়নি। স্ট্রিম দেয় এমন addon যোগ করা আছে কিনা দেখুন।</Text>
          ) : (
            <FlatList
              data={streams}
              keyExtractor={(st, i) => i + (st.url || st.infoHash || '')}
              contentContainerStyle={{ padding: 12 }}
              renderItem={({ item: st }) => (
                <TouchableOpacity style={[s.addonItem, !st.url && !st.externalUrl && !st.ytId && { opacity: 0.5 }]} onPress={() => choose(st)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.addonName}>{st.name || st.addonName}</Text>
                    {!!(st.title || st.description) && (
                      <Text style={s.addonSub} numberOfLines={4}>{st.title || st.description}</Text>
                    )}
                    <Text style={s.addonSub}>
                      {st.addonName}{!st.url && st.infoHash ? ' · টরেন্ট (সাপোর্ট নেই)' : ''}
                    </Text>
                  </View>
                  <Ionicons name="play-circle" size={28} color={C.accent} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---------- Player ----------
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const RESIZE = [
  { mode: 'contain', label: 'Fit' },
  { mode: 'cover', label: 'Fill' },
  { mode: 'stretch', label: 'Stretch' },
];

function Player({ req, onClose }) {
  const ref = useRef(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [subs, setSubs] = useState(null);
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState(false);
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState(null);
  const [rate, setRate] = useState(1);
  const [resize, setResize] = useState('contain');
  const [textTracks, setTextTracks] = useState([]);
  const [audioTracks, setAudioTracks] = useState([]);
  const [subIdx, setSubIdx] = useState(null);
  const [audIdx, setAudIdx] = useState(null);
  const [toast, setToast] = useState('');
  const [barW, setBarW] = useState(1);
  const posRef = useRef(0);
  const durRef = useRef(0);
  const resumeRef = useRef(0);
  const hideT = useRef(null);
  const lastSave = useRef(0);
  const lastTap = useRef({ side: '', t: 0 });
  const pinch = useRef({ start: 0, done: false });

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await loadSettings();
      const h = await loadHistory();
      const e = h[req.item.id];
      if (e && e.videoId === req.videoId) resumeRef.current = e.position || 0;
      if (alive) setSettings(st);
      let fetched = [];
      try { fetched = await loadSubs(req.item.type, req.videoId); } catch (err) {}
      if (alive) setSubs([...(req.extraSubs || []), ...fetched].slice(0, 40));
    })();
    return () => { alive = false; };
  }, []);

  const showControls = useCallback(() => {
    setControls(true);
    clearTimeout(hideT.current);
    hideT.current = setTimeout(() => setControls(false), 3500);
  }, []);
  useEffect(() => {
    showControls();
    return () => clearTimeout(hideT.current);
  }, []);

  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(''), 1200);
  };

  const persist = (force) => {
    const now = Date.now();
    if (!force && now - lastSave.current < 5000) return;
    lastSave.current = now;
    if (durRef.current > 0) {
      saveProgress({
        item: slim(req.item),
        videoId: req.videoId,
        season: req.season,
        episode: req.episode,
        epTitle: req.epTitle,
        position: posRef.current,
        duration: durRef.current,
        updatedAt: now,
      });
    }
  };
  const close = () => {
    persist(true);
    onClose();
  };

  const seekTo = (t) => {
    const x = Math.max(0, durRef.current ? Math.min(t, durRef.current) : t);
    if (ref.current) ref.current.seek(x);
    posRef.current = x;
    setPos(x);
  };

  const onLoad = (d) => {
    durRef.current = d.duration || 0;
    setDur(d.duration || 0);
    setBuffering(false);
    const tt = d.textTracks || [];
    setTextTracks(tt);
    setAudioTracks(d.audioTracks || []);
    const pick = tt.find((t) => sameLang(t.language, settings.subLang));
    setSubIdx(settings.subLang !== 'off' && pick ? pick.index : null);
    const r = resumeRef.current;
    if (r > 10 && d.duration && r < d.duration - 30) seekTo(r);
  };

  const onProgress = (d) => {
    posRef.current = d.currentTime;
    setPos(d.currentTime);
    if (!durRef.current && d.seekableDuration) {
      durRef.current = d.seekableDuration;
      setDur(d.seekableDuration);
    }
    persist(false);
  };

  const tapSide = (side) => {
    const now = Date.now();
    if (lastTap.current.side === side && now - lastTap.current.t < 300) {
      seekTo(posRef.current + (side === 'r' ? 10 : -10));
      flash(side === 'r' ? '+10s' : '-10s');
      lastTap.current = { side: '', t: 0 };
    } else {
      lastTap.current = { side, t: now };
      if (controls) setControls(false);
      else showControls();
    }
  };

  const dist = (t) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
