import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEY = 'addons_v1';
export const HKEY = 'history_v1';
export const SKEY = 'settings_v1';
export const DEFAULT_SETTINGS = { subLang: 'off', subSize: 20 };

export async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

export async function writeJson(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

export const loadAddons = () => readJson(KEY, []);
export const saveAddons = (list) => writeJson(KEY, list);
export const loadSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await readJson(SKEY, {})) });
export const loadHistory = () => readJson(HKEY, {});

export async function saveProgress(entry) {
  const h = await loadHistory();
  h[entry.item.id] = entry;
  await writeJson(HKEY, h);
}

export const slim = (i) => ({
  id: i.id,
  type: i.type,
  name: i.name,
  poster: i.poster,
  background: i.background,
  addonBase: i.addonBase,
});
