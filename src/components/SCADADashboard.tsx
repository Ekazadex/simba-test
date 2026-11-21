/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebaseConfig';
import { playAlertPreviewChime } from '../utils/alarmAudio';
import { runLstmForecast } from '../ml/lstmEngine';
import { collection, query, orderBy, limit, onSnapshot, doc, getDocs, where } from 'firebase/firestore';
import { 
  SensorReading, 
  PredictionResult, 
  BMKGForecast, 
  SystemConfig 
} from '../types';
import { 
  Activity, 
  AlertTriangle, 
  Droplet, 
  CloudRain, 
  Thermometer, 
  Percent, 
  Rss, 
  RefreshCw, 
  Compass, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  BookOpen, 
  ShieldAlert,
  ChevronRight,
  Sparkles,
  Volume2,
  VolumeX,
  Download,
  Wind,
  Eye,
  Info,
  ClipboardCheck,
  Radio,
  CheckCircle2,
  RotateCcw,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ReferenceLine 
} from 'recharts';

import { extractReadingTimestamp, normalizeSensorReading } from '../utils/readingUtils';
import CiliwungHardwareLiveView from './CiliwungHardwareLiveView';
import { loadHardwareHistory24h } from '../hardware-history';
export { extractReadingTimestamp, normalizeSensorReading };

export function translateConditionToEn(c: string): string {
  if (!c) return 'Partly Cloudy';
  return c
    .replace('Cerah Berawan', 'Partly Cloudy')
    .replace('Cerah', 'Clear / Sunny')
    .replace('Berawan Tebal', 'Overcast')
    .replace('Berawan', 'Cloudy')
    .replace('Hujan Ringan', 'Light Rain')
    .replace('Hujan Sedang', 'Moderate Rain')
    .replace('Hujan Lebat', 'Heavy Rain')
    .replace('Hujan Petir', 'Thunderstorm')
    .replace('Udara Kabur', 'Haze')
    .replace('Kabut', 'Fog');
}

export function translateWindDirectionToEn(wd: string): string {
  if (!wd) return 'South';
  return wd
    .replace('Utara', 'North')
    .replace('Selatan', 'South')
    .replace('Timur Laut', 'Northeast')
    .replace('Barat Daya', 'Southwest')
    .replace('Barat Laut', 'Northwest')
    .replace('Tenggara', 'Southeast')
    .replace('Timur', 'East')
    .replace('Barat', 'West');
}

export function formatWeatherSummary(weather: any, lang: 'id' | 'en'): string {
  if (!weather) return '';
  const raw = weather.summary || '';
  if (lang === 'en') {
    if (/kondisi|cuaca|terpantau|kelembapan|kelembaban|suhu|hujan|angin|layanan/i.test(raw)) {
      const cond = weather.condition ? translateConditionToEn(weather.condition) : 'Partly Cloudy';
      const windD = weather.wind_direction ? translateWindDirectionToEn(weather.wind_direction) : 'South';
      return `Current weather in ${weather.location_name || 'Kukusan (Beji, Depok)'} is reported as ${cond} with ambient temperature ${weather.temperature_c ?? 28}°C, humidity ${weather.humidity_percent ?? 75}%, and wind at ${weather.wind_speed_kph ?? 6} km/h from ${windD}. Real-time monitoring active.`;
    }
    return raw;
  } else {
    if (/current weather|weather in|reported as|ambient temperature/i.test(raw)) {
      return `Kondisi cuaca saat ini di ${weather.location_name || 'Kukusan (Beji, Kota Depok)'} terpantau ${weather.condition || 'Cerah Berawan'} dengan suhu udara ${weather.temperature_c ?? 28}°C, kelembapan ${weather.humidity_percent ?? 75}%, dan arah angin dari ${weather.wind_direction || 'Selatan ↑'}. Pemantauan otomatis aktif.`;
    }
    return raw;
  }
}

interface SCADADashboardProps {
  config: SystemConfig | null;
  onRunAIPrediction: () => Promise<void>;
  isPredicting: boolean;
  onSearchNews: () => Promise<void>;
  newsMarkdown: string;
  newsLoading: boolean;
}

export default function SCADADashboard({
  config,
  theme = 'dark',
  prefSoundSiaga = true,
  prefSoundBahaya = true,
  prefPushSiaga = true,
  prefPushBahaya = true,
  onNavigateTab,
  onLatestReadingChange,
  language = 'id',
  soundEnabled: propSoundEnabled,
  onToggleSound,
  onResetSimulation,
  sharedReadings,
  hasSharedReadings,
}: {
  config: SystemConfig | null;
  theme?: 'light' | 'dark';
  prefSoundSiaga?: boolean;
  prefSoundBahaya?: boolean;
  prefPushSiaga?: boolean;
  prefPushBahaya?: boolean;
  onNavigateTab?: (tab: 'dashboard' | 'simulation' | 'admin') => void;
  onLatestReadingChange?: (reading: SensorReading | null) => void;
  language?: 'id' | 'en';
  soundEnabled?: boolean;
  onToggleSound?: () => void;
  onResetSimulation?: () => Promise<void>;
  sharedReadings?: SensorReading[];
  hasSharedReadings?: boolean;
}) {
  const [readingsList, setReadingsList] = useState<SensorReading[]>([]);
  const [latestReading, setLatestReading] = useState<SensorReading | null>(null);
  const [latestPrediction, setLatestPrediction] = useState<PredictionResult | null>(null);
  const [bmkgForecast, setBmkgForecast] = useState<BMKGForecast | null>(null);
  const [hasReceivedReadingsSnapshot, setHasReceivedReadingsSnapshot] = useState(false);
  const [isInjectingTestTelemetry, setIsInjectingTestTelemetry] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [advisory, setAdvisory] = useState<string>('');

  const handleInjectQuickTest = async () => {
    setIsInjectingTestTelemetry(true);
    try {
      await fetch('/api/sim-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry', water_level: 35 })
      });
    } catch (e) {
      console.error('Inject quick test failed:', e);
    } finally {
      setIsInjectingTestTelemetry(false);
    }
  };

  // Official BMKG Public API weather state (100% real data, zero fabricated defaults)
  const [liveWeather, setLiveWeather] = useState<{
    source: 'BMKG' | 'Open-Meteo';
    adm4: string | null;
    location_name: string;
    temperature_c: number;
    humidity_percent: number | null;
    precipitation_mm: string | number;
    condition: string;
    wind_speed_kph: number | null;
    wind_direction: string;
    visibility_km: string;
    cloud_cover_percent: number | null;
    weather_icon: string;
    valid_at: string;
    valid_hour_wib: string;
    analysis_date: string | null;
    last_updated: string;
    forecast_slots: Array<{
      time_wib: string;
      date_label: string;
      temperature_c: number;
      humidity_percent: number | null;
      precipitation_mm: number;
      condition: string;
      wind_speed_kph: number | null;
      wind_direction: string;
      weather_icon: string;
    }>;
  } | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [internalSoundEnabled, setInternalSoundEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('scada_sound_enabled') !== 'false';
    }
    return true;
  });

  const soundEnabled = propSoundEnabled !== undefined ? propSoundEnabled : internalSoundEnabled;

  const handleToggleSound = () => {
    if (onToggleSound) {
      onToggleSound();
    } else {
      const next = !internalSoundEnabled;
      setInternalSoundEnabled(next);
      localStorage.setItem('scada_sound_enabled', String(next));
      if (next) {
        playAlertPreviewChime();
      }
    }
  };

  const [chartRange, setChartRange] = useState<'realtime' | '24h'>('realtime');
  const [chartViewMode, setChartViewMode] = useState<'elevation' | 'raw_ultrasonic'>('elevation');
  const [useBatch360Mode, setUseBatch360Mode] = useState<boolean>(false);
  const [timeAgoText, setTimeAgoText] = useState<string>(language === 'en' ? 'Waiting for readings...' : 'Menunggu pembacaan data...');

  // Hardware status timeout detection: 15 minutes tolerance (900,000 ms)
  // ESP32 SoilWake transmits batch data every 6-8 minutes; 15 mins accommodates deep sleep & retry
  const TIMEOUT_TOLERANCE_MS = 15 * 60 * 1000; // 900.000 ms (15 menit)
  const [isDeviceOffline, setIsDeviceOffline] = useState<boolean>(false);

  // Client-Side Timeout Check running every 10 seconds
  useEffect(() => {
    const checkDeviceTimeout = () => {
      if (!latestReading) {
        setIsDeviceOffline(true);
        return;
      }
      const isSim = latestReading.source?.toLowerCase().includes('simulat') || latestReading.source?.toLowerCase().includes('scenario');
      if (isSim) {
        // Active simulation is live and should evaluate alert level
        setIsDeviceOffline(false);
        return;
      }
      const readingTs = extractReadingTimestamp(latestReading);
      if (!readingTs) {
        setIsDeviceOffline(true);
        return;
      }
      const now = Date.now();
      const diffMs = Math.max(0, now - readingTs);
      const timedOut = diffMs > TIMEOUT_TOLERANCE_MS;
      setIsDeviceOffline(timedOut);
    };

    // Run check immediately when latestReading changes or on mount
    checkDeviceTimeout();

    // Check automatically every 10 seconds
    const timeoutTimer = setInterval(checkDeviceTimeout, 10000);
    return () => clearInterval(timeoutTimer);
  }, [latestReading, config?.auto_simulation]);

  // Pure client-side elapsed timer for "Data received X min ago" without querying Firestore repeatedly
  useEffect(() => {
    const calculateTimeAgo = () => {
      const readingTs = extractReadingTimestamp(latestReading);
      if (!latestReading || !readingTs) {
        setTimeAgoText(language === 'en' ? 'Awaiting telemetry data...' : 'Menunggu data telemetri...');
        return;
      }
      const now = Date.now();
      const diffMs = Math.max(0, now - readingTs);
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);

      if (diffSec < 60) {
        setTimeAgoText(language === 'en' ? `Data received ${diffSec}s ago` : `Data diterima ${diffSec} detik yang lalu`);
      } else if (diffMin < 60) {
        setTimeAgoText(language === 'en' ? `Data received ${diffMin}m ago` : `Data diterima ${diffMin} menit yang lalu`);
      } else {
        setTimeAgoText(language === 'en' 
          ? `Data received ${diffHour}h ${diffMin % 60}m ago` 
          : `Data diterima ${diffHour} jam ${diffMin % 60} menit yang lalu`);
      }
    };

    calculateTimeAgo();
    const timer = setInterval(calculateTimeAgo, 5000); // 5s client-side local timer tick
    return () => clearInterval(timer);
  }, [latestReading, language]);

  const isDark = theme === 'dark';
  const themeCard = isDark ? 'bg-[#0D0D0F] border-white/5 shadow-xl text-slate-300' : 'bg-white border-slate-200 shadow-md text-slate-700';
  const themeTextHeader = isDark ? 'text-white' : 'text-slate-800';
  const themeTextMuted = isDark ? 'text-white/40' : 'text-slate-400';
  const themeTextSub = isDark ? 'text-white/50' : 'text-slate-500';
  const themeTextNormal = isDark ? 'text-slate-300' : 'text-slate-700';
  const themeBorder = isDark ? 'border-white/5' : 'border-slate-100';
  const themeGridColor = isDark ? '#1F2937' : '#E2E8F0';

  // Fast helper to query collections ordered by timestamp
  function getFirestoreQuery(colName: string, limitCount: number) {
    return query(
      collection(db, colName),
      orderBy('timestamp', 'desc'),
      limit(limitCount)
    );
  }

  // Sync shared sensor_readings from App.tsx when available so tab switching never drops or duplicates listeners
  useEffect(() => {
    if (!sharedReadings) return;
    if (hasSharedReadings) setHasReceivedReadingsSnapshot(true);
    setReadingsList(sharedReadings);
    if (sharedReadings.length > 0) {
      let chosen = sharedReadings[sharedReadings.length - 1];
      if (!config?.auto_simulation) {
        const espReading = sharedReadings
          .slice()
          .reverse()
          .find(
            (r) =>
              r.source?.includes('Hardware') ||
              r.source?.includes('ESP') ||
              !r.source?.toLowerCase().includes('simulat')
          );
        if (espReading) {
          chosen = espReading;
        }
      }
      setLatestReading(chosen);
      onLatestReadingChange?.(chosen);
    } else {
      setLatestReading(null);
      onLatestReadingChange?.(null);
    }
  }, [sharedReadings, hasSharedReadings, config?.auto_simulation, onLatestReadingChange]);

  // Bind real-time Firestore listeners for predictions, BMKG data (and readings fallback if sharedReadings absent)
  useEffect(() => {
    let unsubscribeReadings: (() => void) | null = null;
    if (sharedReadings === undefined) {
      unsubscribeReadings = onSnapshot(
        getFirestoreQuery('sensor_readings', 48),
        (snapshot) => {
          setHasReceivedReadingsSnapshot(true);
          const data: SensorReading[] = [];
          const refH = config?.reference_height || 300;
          snapshot.forEach((doc) => {
            const normalized = normalizeSensorReading(doc.id, doc.data(), refH);
            data.push(normalized);
          });
          const sorted = data.sort((a, b) => a.timestamp - b.timestamp);
          setReadingsList(sorted);
          if (sorted.length > 0) {
            let chosen = sorted[sorted.length - 1];
            if (!config?.auto_simulation) {
              const espReading = sorted
                .slice()
                .reverse()
                .find(
                  (r) =>
                    r.source?.includes('Hardware') ||
                    r.source?.includes('ESP') ||
                    !r.source?.toLowerCase().includes('simulat')
                );
              if (espReading) {
                chosen = espReading;
              }
            }
            setLatestReading(chosen);
            onLatestReadingChange?.(chosen);
          } else {
            setLatestReading(null);
            onLatestReadingChange?.(null);
          }
        },
        (error) => {
          setHasReceivedReadingsSnapshot(true);
          handleFirestoreError(error, OperationType.GET, 'sensor_readings');
        }
      );
    }

    // 2. Listen to the latest prediction
    const unsubscribePrediction = onSnapshot(
      getFirestoreQuery('predictions', 1),
      (snapshot) => {
        if (!snapshot.empty) {
          const pred = snapshot.docs[0].data() as PredictionResult;
          setLatestPrediction(pred);
          // Auto fill baseline reasoning if advisory is empty
          if (pred.reasoning && !advisory) {
            setAdvisory(pred.reasoning);
          }
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'predictions');
      }
    );

    // 3. Listen to BMKG Weather forecast
    const unsubscribeBMKG = onSnapshot(
      getFirestoreQuery('bmkg_forecast', 1),
      (snapshot) => {
        if (!snapshot.empty) {
          setBmkgForecast(snapshot.docs[0].data() as BMKGForecast);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'bmkg_forecast');
      }
    );

    setIsLoading(false);

    return () => {
      unsubscribeReadings?.();
      unsubscribePrediction();
      unsubscribeBMKG();
    };
  }, []);

  // Trigger Gemini Prognostic Analysis using High Thinking Mode
  const triggerAIEngine = async () => {
    setAiLoading(true);
    try {
      // Package recent telemetry data
      const payload = {
        readings: readingsList.slice(-10).map(r => ({
          time: new Date(r.timestamp).toLocaleTimeString('id-ID'),
          level: r.water_level,
          rain: r.local_rain,
          temp: r.temperature,
          humidity: r.humidity
        })),
        forecast: bmkgForecast ? {
          cuaca: bmkgForecast.cuaca,
          curah_hujan: bmkgForecast.curah_hujan,
          suhu: bmkgForecast.suhu,
          kelembapan: bmkgForecast.kelembapan
        } : null,
        config: config || {
          reference_height: 300,
          threshold_siaga: 60,
          threshold_bahaya: 90
        }
      };

      const res = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Prediction API failed');
      const data = await res.json();
      
      // Update latest advisory
      if (data.reasoning) {
        setAdvisory(data.reasoning);
      }
      
      // Update latest prediction to match Gemini output if desired
      if (data.prediction_30m !== undefined) {
        setLatestPrediction(prev => prev ? {
          ...prev,
          prediction_30m: data.prediction_30m,
          prediction_1h: data.prediction_1h,
          prediction_3h: data.prediction_3h,
          prediction_6h: data.prediction_6h,
          confidence_score: data.confidence_score,
          status: data.status,
          reasoning: data.reasoning
        } : {
          timestamp: Date.now(),
          prediction_30m: data.prediction_30m,
          prediction_1h: data.prediction_1h,
          prediction_3h: data.prediction_3h,
          prediction_6h: data.prediction_6h,
          confidence_score: data.confidence_score,
          status: data.status,
          reasoning: data.reasoning,
          node_id: config?.node_id || 'node-kukusan-01'
        });
      }
    } catch (e) {
      console.error(e);
      setAdvisory('⚠️ Gagal menghubungkan ke server Gemini High-Thinking. Menampilkan diagnosis pemodelan fisik standard.');
    } finally {
      setAiLoading(false);
    }
  };

  // Fetch genuine live weather directly from official BMKG public API via backend proxy
  const fetchLiveWeather = async (targetLang: string = language) => {
    setLoadingWeather(true);
    setWeatherError(null);
    try {
      const res = await fetch(`/api/live-weather?lang=${targetLang}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || (targetLang === 'en'
          ? 'Official BMKG weather API is currently unreachable.'
          : 'API prakiraan cuaca resmi BMKG sedang tidak dapat dijangkau.'));
      }
      setLiveWeather(data);
    } catch (err: any) {
      console.error('[BMKG] Live weather fetch failed:', err);
      setLiveWeather(null);
      setWeatherError(
        err?.message || (targetLang === 'en'
          ? 'Failed to fetch official BMKG weather data.'
          : 'Gagal mengambil data cuaca resmi BMKG.')
      );
    } finally {
      setLoadingWeather(false);
    }
  };

  // Run initial weather fetch on dashboard open and refetch when language changes
  useEffect(() => {
    fetchLiveWeather(language);
  }, [language]);

  // Determine alert status design tokens
  const isSim = latestReading?.source?.toLowerCase().includes('simulat') || latestReading?.source?.toLowerCase().includes('scenario');
  const currentLevel = (latestReading && (!isDeviceOffline || isSim)) ? latestReading.water_level : 0;
  const thresholdSiaga = config ? config.threshold_siaga : 60;
  const thresholdBahaya = config ? config.threshold_bahaya : 90;

  let alertStatus: 'Normal' | 'Siaga' | 'Bahaya' | 'Offline' = 'Normal';
  let alertBg = 'bg-[#3B82F6]/10 border border-[#3B82F6]/25 text-[#3B82F6]';
  let alertLed = 'bg-[#3B82F6]';
  let alertLabel = language === 'en' ? 'SYSTEM OPTIMAL / NORMAL' : 'SYSTEM OPTIMAL / AMAN';

  if (isDeviceOffline) {
    alertStatus = 'Offline';
    alertBg = isDark 
      ? 'bg-slate-800/50 border border-slate-700/60 text-slate-400' 
      : 'bg-slate-100 border border-slate-300 text-slate-600';
    alertLed = 'bg-slate-400';
    alertLabel = language === 'en' ? 'STANDBY (OFFLINE)' : 'STANDBY (OFFLINE)';
  } else if (currentLevel >= thresholdBahaya) {
    alertStatus = 'Bahaya';
    alertBg = 'bg-rose-500/10 border border-rose-500/20 text-rose-400';
    alertLed = 'bg-rose-500 scada-led-blink';
    alertLabel = language === 'en' ? 'DANGER / EVACUATE' : 'BAHAYA / SIAP EVAKUASI';
  } else if (currentLevel >= thresholdSiaga) {
    alertStatus = 'Siaga';
    alertBg = 'bg-amber-500/10 border border-amber-500/20 text-amber-400';
    alertLed = 'bg-amber-500 scada-led-blink';
    alertLabel = language === 'en' ? 'WARNING / ALERT' : 'SIAGA / WASPADA';
  }

  // Audio warning playback is managed globally by App.tsx across Dashboard, Simulasi 3D, and Kontrol PLC.

  // Request Browser Notification Permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          console.log(`[SCADA] Notification permission status: ${permission}`);
        });
      }
    }
  }, []);

  // Browser Push Notifications on alert transitions (respects user preferences)
  const lastAlertStatusRef = React.useRef<'Normal' | 'Siaga' | 'Bahaya' | 'Offline'>('Normal');

  useEffect(() => {
    if (alertStatus === lastAlertStatusRef.current) return;
    
    const prevStatus = lastAlertStatusRef.current;
    lastAlertStatusRef.current = alertStatus;

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      if (alertStatus === 'Bahaya' && prefPushBahaya) {
        new Notification("⚠️ BAHAYA: ELEVASI AIR KRITIS!", {
          body: `Tinggi air mencapai ${currentLevel} cm (melebihi ambang bahaya ${thresholdBahaya} cm). Segera lakukan evakuasi!`,
          icon: "/favicon.ico",
          tag: "scada-alert-bahaya"
        });
      } else if (alertStatus === 'Siaga' && prefPushSiaga && prevStatus === 'Normal') {
        new Notification("⚠️ WASPADA: STATUS SIAGA!", {
          body: `Tinggi air mencapai ${currentLevel} cm (melebihi ambang siaga ${thresholdSiaga} cm). Pantau secara berkala.`,
          icon: "/favicon.ico",
          tag: "scada-alert-siaga"
        });
      }
    }
  }, [alertStatus, prefPushSiaga, prefPushBahaya, currentLevel, thresholdSiaga, thresholdBahaya]);

  const [isExportingCSV, setIsExportingCSV] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // CSV Data Export Handler (queries last 24 hours of sensor logs from Firestore)
  const handleExportCSV = async () => {
    setIsExportingCSV(true);
    setExportNotice(null);
    try {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      let snap;
      try {
        const q = query(
          collection(db, 'sensor_readings'),
          where('timestamp', '>=', oneDayAgo),
          orderBy('timestamp', 'asc'),
          limit(1500)
        );
        snap = await getDocs(q);
      } catch (err) {
        // Fallback without compound where+order filter if index isn't created
        const fallbackQ = query(
          collection(db, 'sensor_readings'),
          orderBy('timestamp', 'desc'),
          limit(1000)
        );
        snap = await getDocs(fallbackQ);
      }

      let exportList: SensorReading[] = [];
      if (snap && !snap.empty) {
        const refH = config?.reference_height || 300;
        snap.forEach((d) => {
          exportList.push(normalizeSensorReading(d.id, d.data(), refH));
        });
        exportList.sort((a, b) => a.timestamp - b.timestamp);
      } else if (readingsList.length > 0) {
        exportList = [...readingsList];
      }

      if (exportList.length === 0) {
        setExportNotice(
          language === 'en' 
            ? 'No sensor logs found in database. Please wait for ESP32 transmission or run a simulation first.'
            : 'Belum ada rekaman log sensor di database. Silakan tunggu transmisi ESP32 atau jalankan simulasi terlebih dahulu.'
        );
        setTimeout(() => setExportNotice(null), 5000);
        return;
      }

      const headers = ['Timestamp', 'Waktu Lokal', 'Elevasi Air (cm)', 'Jarak Sensor JSN-SR04T (cm)', 'Deteksi Tetesan Hujan (Capacitive V2.0)', 'Sumber Data', 'Suhu BMKG (C)', 'Kelembapan BMKG (%)'];
      const rows = exportList.map(r => {
        const dateStr = new Date(r.timestamp).toISOString();
        const localTimeStr = new Date(r.timestamp).toLocaleString('id-ID');
        const rainLabel = r.local_rain === 0 ? 'Kering / Cerah' : r.local_rain === 1 ? 'Tetesan Hujan' : r.local_rain === 2 ? 'Basah Presipitasi' : 'Hujan Lebat';
        return [
          dateStr,
          `"${localTimeStr}"`,
          r.water_level,
          r.distance ?? '',
          `"${rainLabel}"`,
          `"${r.source || 'Hardware-ESP32'}"`,
          r.temperature,
          r.humidity
        ];
      });

      const csvContent = "\ufeff" + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `scada_sensor_logs_24h_${new Date().toISOString().slice(0,10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      setExportNotice(
        language === 'en'
          ? 'Failed to query database for CSV export.'
          : 'Gagal mengambil data dari database untuk ekspor CSV.'
      );
      setTimeout(() => setExportNotice(null), 5000);
    } finally {
      setIsExportingCSV(false);
    }
  };

  // Extract raw batch array from either 'readings' (ESP32 direct) or 'batch_data'
  const rawBatch: any[] = (latestReading as any)?.readings || (latestReading as any)?.batch_data || [];
  const hasBatchData = Boolean(Array.isArray(rawBatch) && rawBatch.length > 0);
  const activeReadings = chartRange === 'realtime' ? readingsList.slice(-20) : readingsList;
  const refHeight = config?.reference_height || 300;

  // Despiking helper: detects isolated single-reading spikes caused by ultrasonic acoustic reflections
  const cleanReadings = activeReadings.map((r, i, arr) => {
    let elev = typeof r.water_level === 'number' ? r.water_level : 0;
    const ultrasonicDistance = typeof r.distance === 'number' 
      ? r.distance 
      : Math.max(0, Math.round((refHeight - elev) * 10) / 10);

    // Automatic signal conditioning: filter out isolated obstacle spikes (e.g. 109cm/195cm reflections)
    // when neighboring data points are consistent, keeping the hydrograph true to physical reality
    if (arr.length >= 3) {
      const prev = i > 0 ? arr[i - 1].water_level : arr[i + 1]?.water_level ?? elev;
      const next = i < arr.length - 1 ? arr[i + 1].water_level : arr[i - 1]?.water_level ?? elev;
      const avgNeighbor = (prev + next) / 2;
      // If point jumps by > 40cm above neighbors while neighbors are close to each other
      if (Math.abs(prev - next) < 30 && (elev - avgNeighbor) > 40) {
        elev = Math.round(avgNeighbor * 10) / 10;
      }
    }

    const formattedTime = new Date(r.timestamp).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      ...(chartRange === 'realtime' ? { second: '2-digit' } : {})
    });

    return {
      time: formattedTime,
      elevasi: elev,
      raw_distance: ultrasonicDistance,
      local_rain: (r.local_rain || 0) * 30, // scaled for chart visibility
      suhu: r.temperature,
      source: r.source || 'Standard'
    };
  });

  const chartData = (useBatch360Mode && hasBatchData) 
    ? rawBatch.map((item: any, idx: number) => {
        let timeLabel = `T+${idx}s`;
        let val = 0;
        let rawDist = 0;

        if (Array.isArray(item)) {
          timeLabel = String(item[0]);
          val = Number(item[1]) || 0;
          rawDist = Math.max(0, Math.round((refHeight - val) * 10) / 10);
        } else if (item && typeof item === 'object') {
          const ts = item.timestamp ?? item.time;
          if (typeof ts === 'number') {
            timeLabel = new Date(ts < 10000000000 ? ts * 1000 : ts).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });
          } else if (typeof ts === 'string') {
            timeLabel = ts;
          }

          if (typeof item.distance === 'number') {
            rawDist = Math.round(item.distance * 10) / 10;
            val = Math.max(0, Math.round((refHeight - rawDist) * 10) / 10);
          } else if (typeof item.water_level === 'number') {
            val = Math.round(item.water_level * 10) / 10;
            rawDist = Math.max(0, Math.round((refHeight - val) * 10) / 10);
          }
        }

        return {
          time: timeLabel,
          elevasi: val,
          raw_distance: rawDist,
          local_rain: 0,
          suhu: latestReading?.temperature || 28,
          source: 'Batch 360'
        };
      })
    : cleanReadings;

  // Live 6-hour autoregressive LSTM inference using trained weights from model_lstm_banjir.h5
  const lstmForecast = useMemo(() => {
    const sourceFiltered = !config?.auto_simulation
      ? readingsList.filter(
          (r) =>
            r.source?.includes('Hardware') ||
            r.source?.includes('ESP') ||
            !r.source?.toLowerCase().includes('simulat')
        )
      : readingsList;

    const baseList = sourceFiltered.length > 0 ? sourceFiltered : readingsList;
    let series: number[] = baseList
      .map((r) => r.water_level)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    // If fewer than 24 Firestore records exist but ESP32 sent a 360-sample batch, downsample evenly to 24 steps
    if (series.length < 24 && hasBatchData) {
      const batchLevels: number[] = rawBatch
        .map((item: any) => {
          if (Array.isArray(item)) return Number(item[1]);
          if (item && typeof item === 'object') {
            if (typeof item.distance === 'number') return Math.max(0, refHeight - item.distance);
            if (typeof item.water_level === 'number') return item.water_level;
          }
          return NaN;
        })
        .filter((v: number) => Number.isFinite(v));

      if (batchLevels.length >= 2) {
        const targetCount = Math.min(24, batchLevels.length);
        const sampled: number[] = [];
        for (let i = 0; i < targetCount; i++) {
          const idx = Math.round((i * (batchLevels.length - 1)) / Math.max(1, targetCount - 1));
          sampled.push(batchLevels[idx]);
        }
        series = sampled;
      }
    }

    if (series.length === 0 && latestReading && typeof latestReading.water_level === 'number') {
      series = [latestReading.water_level];
    }

    if (series.length === 0) return null;

    return runLstmForecast(series, {
      thresholdSiaga,
      thresholdBahaya,
      maxReferenceHeight: refHeight,
    });
  }, [readingsList, rawBatch, hasBatchData, latestReading, config?.auto_simulation, thresholdSiaga, thresholdBahaya, refHeight]);

  // Future Prediction Points (prefer live trained LSTM output over static Firestore document)
  const predictionCurves = lstmForecast
    ? [
        { name: 'T+30m', prediksi: lstmForecast.prediction_30m },
        { name: 'T+1h', prediksi: lstmForecast.prediction_1h },
        { name: 'T+3h', prediksi: lstmForecast.prediction_3h },
        { name: 'T+6h', prediksi: lstmForecast.prediction_6h },
      ]
    : latestPrediction
      ? [
          { name: 'T+30m', prediksi: latestPrediction.prediction_30m },
          { name: 'T+1h', prediksi: latestPrediction.prediction_1h },
          { name: 'T+3h', prediksi: latestPrediction.prediction_3h },
          { name: 'T+6h', prediksi: latestPrediction.prediction_6h },
        ]
      : [];

  return (
    <div id="scada-dashboard-root" className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-12">
      
      {/* HARDWARE DATA PAUSE & REAL-TIME QUOTA SAVER BANNER */}
      <div id="scada-hardware-pause-banner" className={`col-span-12 p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        latestReading?.source?.includes('Hardware')
          ? isDark ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : isDark ? 'bg-black/40 border-white/10 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
      }`}>
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <div className="text-xs">
            <div className="flex items-center gap-2 font-mono font-bold tracking-wider uppercase">
              {config?.auto_simulation && (latestReading?.source?.includes('Simulator') || latestReading?.source?.includes('Scenario')) ? (
                <>
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span>{language === 'en' ? 'TELEMETRY SOURCE: SIMULATOR (CONTROLLED TEST MODE)' : 'SUMBER TELEMETRI: SIMULATOR (MODE PENGUJIAN)'}</span>
                </>
              ) : latestReading?.source?.includes('Hardware') && !isDeviceOffline ? (
                <>
                  <Radio className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{language === 'en' ? 'TELEMETRY SOURCE: ESP32 HARDWARE (360-SAMPLE BATCH)' : 'SUMBER TELEMETRI: HARDWARE ESP32 (BATCH 360 SAMPEL)'}</span>
                </>
              ) : (
                <>
                  <Activity className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>{language === 'en' ? 'MONITORING STATUS: STANDBY PAUSED (LATEST REPORT)' : 'STATUS MONITORING: STANDBY PAUSED (LAPORAN TERAKHIR)'}</span>
                </>
              )}
            </div>
            <span className="text-[11px] opacity-80 mt-0.5 block font-sans">
              {timeAgoText} — {language === 'en' 
                ? 'No repeated Firestore reads. System stays paused on latest report until new transmission arrives.' 
                : 'Tidak ada pembacaan Firestore berulang. Sistem tetap terjeda pada laporan terakhir hingga paket transmisi baru masuk.'}
            </span>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
          {hasBatchData && (
            <span className="px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-lg text-[10px] font-mono font-bold shrink-0 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {language === 'en' ? `Array of ${rawBatch.length || 360} Points Ready` : `Array ${rawBatch.length || 360} Titik Siap Ditampilkan`}
            </span>
          )}

          {/* Primary System Alert Level Badge (Neatly Integrated into Header Banner) */}
          <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider ${alertBg}`}>
            <span className={`w-2 h-2 rounded-full ${alertLed} inline-block`} />
            <span className="font-mono">{alertLabel}</span>
          </div>
        </div>
      </div>

      {/* ROW 2: PRIMARY GAUGE (4 COLS) & LIVE ELEVATION CURVE (8 COLS) — MATCHED HEIGHT */}
      <div id="measurement-grid" className="col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Core Gauge: Water Level Channel */}
        <div id="water-gauge" className={`col-span-12 lg:col-span-4 h-full ${themeCard} rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between`}>
          <div className="flex justify-between items-center mb-4">
            <span className={`text-[10px] font-bold uppercase tracking-[0.25em] ${themeTextMuted} font-mono`}>
              {language === 'en' ? 'Water Surface Elevation' : 'Tinggi Elevasi Air'}
            </span>
            <div className="flex items-center gap-1.5">
              {isDeviceOffline ? (
                <span className="px-2.5 py-1 bg-slate-500/20 border border-slate-500/40 rounded-lg text-[10px] font-mono text-slate-400 font-bold tracking-wider uppercase flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  {language === 'en' ? 'DEVICE OFFLINE' : 'PERANGKAT OFFLINE'}
                </span>
              ) : latestReading?.source?.includes('Manual') || latestReading?.source?.includes('Peil') ? (
                <span className="px-2.5 py-1 bg-amber-500/20 border border-amber-500/40 rounded-lg text-[10px] font-mono text-amber-400 font-bold tracking-wider uppercase flex items-center gap-1.5 shadow-sm">
                  <ClipboardCheck className="w-3 h-3 text-amber-400" />
                  MANUAL PEIL SCHAAL
                </span>
              ) : latestReading?.source?.includes('Hardware') ? (
                <span className="px-2.5 py-1 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-[10px] font-mono text-emerald-400 font-bold tracking-wider uppercase flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  LIVE HARDWARE
                </span>
              ) : !config?.auto_simulation ? (
                <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[9px] font-mono text-amber-400 tracking-wider uppercase flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  STANDBY (READY FOR ESP32)
                </span>
              ) : (
                <span className={`px-2 py-0.5 ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'} rounded text-[9px] font-mono text-[#3B82F6] tracking-wider uppercase`}>
                  {language === 'en' ? 'SIMULATOR ACTIVE' : 'SIMULATOR AKTIF'}
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex flex-col">
              <span className={`text-5xl font-sans font-light tracking-tighter leading-none tabular-nums ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {isDeviceOffline ? (
                  <>--<span className="text-lg font-normal text-slate-400"> cm</span></>
                ) : (
                  <>{latestReading ? latestReading.water_level : '0.0'}<span className="text-lg font-normal text-slate-400"> cm</span></>
                )}
              </span>
              <span className={`text-[11px] ${themeTextSub} mt-2 font-sans flex items-center gap-1.5`}>
                {isDeviceOffline ? (
                  <span className="text-slate-400 font-mono">
                    {language === 'en' ? 'Device offline (>15 mins). Telemetry paused on standby.' : 'Perangkat offline (>15 mnt). Data telemetri terakhir dibekukan.'}
                  </span>
                ) : (
                  <>
                    {latestReading && latestReading.water_level >= thresholdSiaga ? (
                      <TrendingUp className="w-3.5 h-3.5 text-rose-500 animate-bounce" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    {latestReading?.source?.includes('Manual') ? (
                      <span className="text-amber-400 font-bold">
                        {language === 'en' ? 'Staff: ' : 'Petugas: '}{latestReading.operator || (language === 'en' ? 'Field Staff' : 'Staf Lapangan')}
                      </span>
                    ) : latestReading?.distance != null ? (
                      language === 'en'
                        ? `Sensor Gap: ${latestReading.distance} cm (${latestReading.source || 'RTU'})`
                        : `Jarak Pantul Sensor: ${latestReading.distance} cm (${latestReading.source || 'RTU'})`
                    ) : (
                      language === 'en' ? 'Ultrasonic Echo Precision: ±0.1 cm' : 'Presisi Echo Ultrasonik: ±0.1 cm'
                    )}
                  </>
                )}
              </span>

              {/* Extra Field Notes if Manual Entry */}
              {latestReading?.source?.includes('Manual') && latestReading.notes && (
                <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] font-sans text-amber-300 leading-snug">
                  {latestReading.notes}
                </div>
              )}
            </div>
          </div>

          {/* PHYSICAL CROSS-SECTION GAUGE DIAGRAM */}
          <div className={`w-full h-60 ${isDark ? 'bg-black/50 border-white/5' : 'bg-slate-100/60 border-slate-200'} rounded-2xl border p-4 relative overflow-hidden flex flex-col justify-between mt-4 shadow-inner`}>
            
            {/* 1. Bridge/Beam concrete ceiling & Sensor Probe */}
            <div className="absolute top-0 left-0 right-0 h-7 bg-zinc-700 border-b border-zinc-600 flex items-center justify-center z-10 shadow-sm">
              <span className="text-[7px] font-mono text-zinc-300 tracking-widest uppercase">TIANG PIPA & LENGAN BOOM DRAINASE KUKUSAN</span>
              
              {/* JSN-SR04T Sensor Probe Visual */}
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-10 h-5 bg-zinc-800 rounded-b-md border-x border-b border-zinc-600 flex justify-around items-center px-1">
                <div className="w-3 h-3 rounded-full bg-zinc-700 border border-[#3B82F6]/30 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-ping" />
                </div>
                <div className="w-3 h-3 rounded-full bg-zinc-700 border border-[#3B82F6]/30 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse" />
                </div>
              </div>
            </div>

            {/* 2. Sonic Wave Ray (Dashed beam) */}
            <div className="absolute top-7 bottom-0 left-1/2 -translate-x-1/2 w-8 flex flex-col items-center justify-around pointer-events-none z-0">
              <div className="w-2.5 h-0.5 border-b-2 border-dashed border-[#3B82F6]/30 rounded-full animate-pulse" />
              <div className="w-3.5 h-0.5 border-b-2 border-dashed border-[#3B82F6]/30 rounded-full animate-pulse [animation-delay:0.1s]" />
              <div className="w-4.5 h-0.5 border-b-2 border-dashed border-[#3B82F6]/30 rounded-full animate-pulse [animation-delay:0.2s]" />
              <div className="w-5.5 h-0.5 border-b-2 border-dashed border-[#3B82F6]/30 rounded-full animate-pulse [animation-delay:0.3s]" />
            </div>

            {/* 3. The Water Body & Animated Surface */}
            <div 
              className="absolute bottom-0 left-0 right-0 z-20"
              style={{ 
                height: `${Math.min(85, Math.max(15, (currentLevel / (config?.reference_height || 300)) * 100))}%`,
                transition: 'height 1200ms cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              {/* Animated wave header */}
              <div className="absolute top-0 left-0 right-0 h-4 -mt-3.5 pointer-events-none overflow-hidden">
                <svg className="w-[200%] h-full fill-blue-500/30 animate-pulse" viewBox="0 0 1200 120" preserveAspectRatio="none">
                  <path d="M0,60 C150,100 350,20 500,60 C650,100 850,20 1000,60 L1200,60 L1200,120 L0,120 Z" />
                </svg>
              </div>

              {/* Main Water Body */}
              <div className={`w-full h-full ${
                alertStatus === 'Bahaya' ? 'bg-gradient-to-t from-rose-600/80 to-rose-500/70 border-t-2 border-rose-400' :
                alertStatus === 'Siaga' ? 'bg-gradient-to-t from-amber-600/80 to-amber-500/70 border-t-2 border-amber-400' :
                'bg-gradient-to-t from-blue-600/80 to-blue-500/70 border-t-2 border-blue-400'
              } flex flex-col justify-end border-t shadow-inner`}>
                
                {/* Sandy/Soil Riverbed ground at the absolute bottom */}
                <div className="w-full h-4 bg-amber-950/30 border-t border-amber-900/40 flex items-center justify-center">
                  <span className="text-[6px] font-mono text-amber-200/50 tracking-widest uppercase">
                    {language === 'en' ? 'RIVERBED BASELINE' : 'DASAR SUNGAI (RIVERBED)'}
                  </span>
                </div>
              </div>
            </div>

            {/* 4. Overlaid threshold markings (Siaga, Bahaya) */}
            <div 
              className="absolute left-0 right-0 border-t border-dashed border-amber-500/70 z-30 pointer-events-none"
              style={{ 
                bottom: `${(thresholdSiaga / (config?.reference_height || 300)) * 100}%` 
              }}
            >
              <div className="bg-amber-500 text-black text-[6px] font-mono font-bold px-1.5 py-0.5 rounded absolute right-3 -top-2.5 shadow-sm uppercase tracking-wider">
                {language === 'en' ? 'ALERT' : 'SIAGA'}: {thresholdSiaga} cm
              </div>
            </div>
            <div 
              className="absolute left-0 right-0 border-t border-dashed border-rose-500/80 z-30 pointer-events-none"
              style={{ 
                bottom: `${(thresholdBahaya / (config?.reference_height || 300)) * 100}%` 
              }}
            >
              <div className="bg-rose-600 text-white text-[6px] font-mono font-bold px-1.5 py-0.5 rounded absolute right-3 -top-2.5 shadow-sm uppercase tracking-wider">
                {language === 'en' ? 'DANGER' : 'BAHAYA'}: {thresholdBahaya} cm
              </div>
            </div>

            {/* 5. Dimensions & Annotations overlay */}
            <div className="absolute top-10 bottom-1 left-0 right-0 px-3 flex justify-between pointer-events-none z-30 font-mono">
              <div className="flex flex-col justify-start items-start w-1/2">
                <div className="bg-black/85 border border-white/10 rounded px-1.5 py-0.5 text-left shadow">
                  <span className="text-[6px] text-slate-400 block uppercase leading-none mb-0.5">
                    {language === 'en' ? 'Sensor Gap to Water (d)' : 'Jarak Sensor ke Air (d)'}
                  </span>
                  <span className="text-[10px] font-bold text-sky-400 leading-none">
                    {isDeviceOffline ? '-- cm' : `${config ? Math.max(0, config.reference_height - currentLevel) : 300 - currentLevel} cm`}
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-end items-end w-1/2">
                <div className="bg-black/85 border border-white/10 rounded px-1.5 py-0.5 text-right shadow">
                  <span className="text-[6px] text-slate-400 block uppercase leading-none mb-0.5">
                    {language === 'en' ? 'Water Elevation (h)' : 'Elevasi Air (h)'}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-400 leading-none">
                    {isDeviceOffline ? '-- cm' : `${currentLevel} cm`}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Height Tag */}
            <div className="absolute bottom-5 left-3 bg-zinc-800/90 border border-zinc-700 text-[6px] font-mono text-zinc-300 px-1.5 py-0.5 rounded z-30 shadow-md">
              H_REF: {config ? config.reference_height : 300} cm
            </div>

          </div>

          <div className={`grid grid-cols-2 gap-2 mt-4 pt-3 border-t ${themeBorder} text-[10px] font-mono`}>
            <div className="flex flex-col">
              <span className={themeTextMuted}>{language === 'en' ? 'Alert Threshold:' : 'Ambang Siaga:'}</span>
              <span className="text-amber-500 font-semibold mt-0.5">{thresholdSiaga} cm</span>
            </div>
            <div className="flex flex-col">
              <span className={themeTextMuted}>{language === 'en' ? 'Danger Threshold:' : 'Ambang Bahaya:'}</span>
              <span className="text-rose-500 font-semibold mt-0.5">{thresholdBahaya} cm</span>
            </div>
          </div>
        </div>

        {/* Real-time & Historical Plot */}
        <div id="scada-charts-forecasts" className="col-span-12 lg:col-span-8 flex flex-col">
          <div id="scada-plot-container" className={`h-full ${themeCard} rounded-2xl p-6 flex flex-col justify-between`}>
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-[0.25em] ${themeTextMuted} font-mono`}>
                  {language === 'en' ? 'Live Water Elevation Curve vs Critical Limits' : 'Kurva Elevasi Air Terkini vs Batas Kritis'}
                </span>

                <div className="flex items-center gap-3 flex-wrap">
                  {chartViewMode === 'elevation' ? (
                    <>
                      <span className={`text-[9px] ${themeTextMuted} flex items-center gap-1 font-mono uppercase tracking-wider`}>
                        <span className="w-2 h-2 rounded-full bg-[#3B82F6] inline-block" /> {language === 'en' ? 'Elevation (h)' : 'Elevasi Air (h)'}
                      </span>
                      <span className={`text-[9px] ${themeTextMuted} flex items-center gap-1 font-mono uppercase tracking-wider`}>
                        <span className="w-2.5 h-0.5 bg-amber-500/80 inline-block border-t border-dashed" /> {language === 'en' ? 'Alert Limit' : 'Batas Siaga'}
                      </span>
                      <span className={`text-[9px] ${themeTextMuted} flex items-center gap-1 font-mono uppercase tracking-wider`}>
                        <span className="w-2.5 h-0.5 bg-rose-500/80 inline-block border-t border-dashed" /> {language === 'en' ? 'Danger Limit' : 'Batas Bahaya'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[9px] text-emerald-400 flex items-center gap-1 font-mono uppercase tracking-wider">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" /> {language === 'en' ? 'Sensor Distance (d)' : 'Jarak Sensor ke Air (cm)'}
                      </span>
                      <span className={`text-[9px] ${themeTextMuted} flex items-center gap-1 font-mono uppercase tracking-wider`}>
                        <span className="w-2.5 h-0.5 bg-zinc-500 inline-block border-t border-dashed" /> H_REF: {config?.reference_height || 300}cm
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Toggle Mode: Elevasi vs Raw Ultrasonik */}
                  <div className={`flex items-center gap-1 border ${isDark ? 'border-white/5 bg-black/25' : 'border-slate-200 bg-slate-100'} rounded-lg p-0.5 text-[10px] font-mono`}>
                    <button
                      id="btn-mode-elevation"
                      onClick={() => setChartViewMode('elevation')}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                        chartViewMode === 'elevation'
                          ? 'bg-[#3B82F6] text-black font-bold'
                          : `${themeTextSub} hover:text-[#3B82F6]`
                      }`}
                      title={language === 'en' ? 'Show Water Surface Elevation (TMA) in cm' : 'Tampilkan grafik Tinggi Elevasi Muka Air (TMA) dalam cm'}
                    >
                      {language === 'en' ? 'Elevation (TMA)' : 'Elevasi Air (TMA)'}
                    </button>
                    <button
                      id="btn-mode-raw"
                      onClick={() => setChartViewMode('raw_ultrasonic')}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                        chartViewMode === 'raw_ultrasonic'
                          ? 'bg-emerald-500 text-black font-bold'
                          : `${themeTextSub} hover:text-emerald-400`
                      }`}
                      title={language === 'en' ? 'Show raw JSN-SR04T reflection distance in cm' : 'Tampilkan data mentah jarak pantul sensor ultrasonik JSN-SR04T (cm)'}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {language === 'en' ? 'Raw Ultrasonic (d)' : 'Raw Ultrasonik (d)'}
                    </button>
                  </div>

                  <div className={`flex items-center gap-1 border ${isDark ? 'border-white/5 bg-black/25' : 'border-slate-200 bg-slate-100'} rounded-lg p-0.5 text-[10px] font-mono`}>
                    <button 
                      id="btn-range-realtime"
                      onClick={() => {
                        setUseBatch360Mode(false);
                        setChartRange('realtime');
                      }}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${(!useBatch360Mode && chartRange === 'realtime') ? 'bg-[#3B82F6] text-black font-bold' : `${themeTextSub} hover:text-[#3B82F6]`}`}
                      title={language === 'en' ? 'High resolution chart showing last 20 telemetry readings' : 'Grafik resolusi tinggi menampilkan 20 pembacaan telemetri terakhir'}
                    >
                      {language === 'en' ? 'Real-time (20 Pts)' : 'Terkini (20 Poin)'}
                    </button>
                    <button 
                      id="btn-range-24h"
                      onClick={() => {
                        setUseBatch360Mode(false);
                        setChartRange('24h');
                      }}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${(!useBatch360Mode && chartRange === '24h') ? 'bg-[#3B82F6] text-black font-bold' : `${themeTextSub} hover:text-[#3B82F6]`}`}
                      title={language === 'en' ? 'Cumulative 24-hour water elevation trend' : 'Grafik histori elevasi air akumulatif dari 24 jam terakhir'}
                    >
                      {language === 'en' ? '24h Trend' : 'Tren 24 Jam'}
                    </button>
                    <button 
                      id="btn-range-batch360"
                      onClick={() => setUseBatch360Mode(!useBatch360Mode)}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1 ${useBatch360Mode ? 'bg-emerald-500 text-black font-bold' : `${themeTextSub} hover:text-emerald-400`}`}
                      title={language === 'en' ? 'Visualize 360 continuous sample array in 1 ESP32 batch' : 'Tampilkan visualisasi 360 array sampel kontinu dalam 1 siklus batch ESP32'}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${useBatch360Mode ? 'bg-black' : 'bg-emerald-400 animate-pulse'}`} />
                      {language === 'en' ? '360-Pt Batch' : 'Batch 360 Titik'}
                    </button>
                  </div>
                </div>

                {/* Export Data Button */}
                <div className="relative">
                  <button
                    id="btn-export-csv"
                    onClick={handleExportCSV}
                    disabled={isExportingCSV}
                    title={language === 'en' ? 'Export last 24 hours sensor logs to CSV' : 'Ekspor Log Sensor 24 Jam Terakhir ke format CSV'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border text-[10px] font-mono rounded-lg transition-all cursor-pointer ${
                      isDark 
                        ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300' 
                        : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-600 shadow-sm'
                    } ${isExportingCSV ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    {isExportingCSV ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3B82F6]" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-[#3B82F6]" />
                    )}
                    <span className="font-bold">
                      {isExportingCSV 
                        ? (language === 'en' ? 'QUERYING 24H...' : 'MENGAMBIL 24 JAM...') 
                        : (language === 'en' ? 'EXPORT CSV' : 'EXPORT DATA')}
                    </span>
                  </button>

                  {exportNotice && (
                    <div className="absolute right-0 top-full mt-2 w-72 p-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg text-[10px] font-sans shadow-xl z-50 animate-in fade-in slide-in-from-top-1">
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{exportNotice}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="w-full flex-1 min-h-[290px]">
              {!hasReceivedReadingsSnapshot ? (
                <div className={`w-full h-full min-h-[290px] flex flex-col items-center justify-center ${themeTextMuted} font-mono text-[10px] uppercase tracking-widest`}>
                  <RefreshCw className="w-5 h-5 animate-spin text-[#3B82F6] mb-3" />
                  {language === 'en' ? 'Connecting to telemetry database...' : 'Menghubungkan ke basis data telemetri...'}
                </div>
              ) : chartData.length === 0 ? (
                <div className={`w-full h-full min-h-[290px] flex flex-col items-center justify-center p-6 text-center rounded-xl border border-dashed ${isDark ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3 shadow-sm">
                    <Activity className="w-6 h-6 animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping inline-block" />
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400">
                      {language === 'en' ? 'TELEMETRY STANDBY — AWAITING ESP32' : 'STATUS TELEMETRI: STANDBY (MENUNGGU TRANSMISI ESP32)'}
                    </span>
                  </div>
                  <p className={`text-xs max-w-lg mb-4 font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {language === 'en'
                      ? 'Database is active and ready. Currently no telemetry packets in sensor database (device in standby or simulation was recently reset). The curve will automatically plot once ESP32 transmits data.'
                      : 'Database aktif dan siap menerima data. Saat ini belum ada data sensor yang masuk dari ESP32 (perangkat standby/offline atau simulasi baru saja direset). Grafik akan langsung tergambar otomatis saat ESP32 mengirim data.'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={handleInjectQuickTest}
                      disabled={isInjectingTestTelemetry}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[#3B82F6] hover:bg-blue-400 text-black transition-all shadow-md cursor-pointer disabled:opacity-50"
                    >
                      {isInjectingTestTelemetry ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                      <span>{language === 'en' ? 'Test Chart (Sample 35 cm)' : 'Uji Grafik (Sampel 35 cm)'}</span>
                    </button>
                    {onNavigateTab && (
                      <button
                        type="button"
                        onClick={() => onNavigateTab('admin')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                          isDark 
                            ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300' 
                            : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700 shadow-sm'
                        }`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-[#3B82F6]" />
                        <span>{language === 'en' ? 'Open PLC Simulation Panel' : 'Buka Kontrol PLC & Simulasi'}</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorLevel" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorRaw" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={themeGridColor} />
                    <XAxis dataKey="time" stroke="#52525B" style={{ fontSize: 9, fontFamily: 'monospace' }} />
                    <YAxis 
                      domain={chartViewMode === 'elevation' ? [0, 160] : [0, Math.max(300, (config?.reference_height || 300) + 20)]} 
                      stroke="#52525B" 
                      style={{ fontSize: 9, fontFamily: 'monospace' }} 
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: isDark ? '#0D0D0F' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0', borderRadius: '8px' }}
                      labelStyle={{ color: isDark ? '#94a3b8' : '#475569', fontWeight: 'bold', fontSize: 10, fontFamily: 'monospace' }}
                      itemStyle={{ color: isDark ? '#fff' : '#0f172a', fontSize: 11 }}
                    />
                    {chartViewMode === 'elevation' ? (
                      <>
                        <Area type="monotone" dataKey="elevasi" name={language === 'en' ? "Water Level (cm)" : "Elevasi Air (cm)"} stroke="#3B82F6" strokeWidth={1.5} fillOpacity={1} fill="url(#colorLevel)" />
                        <ReferenceLine y={thresholdSiaga} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.2} label={{ value: language === 'en' ? 'ALERT' : 'SIAGA', fill: '#f59e0b', fontSize: 8, position: 'right', fontFamily: 'monospace' }} />
                        <ReferenceLine y={thresholdBahaya} stroke="#f43f5e" strokeDasharray="4 4" strokeWidth={1.2} label={{ value: language === 'en' ? 'DANGER' : 'BAHAYA', fill: '#f43f5e', fontSize: 8, position: 'right', fontFamily: 'monospace' }} />
                      </>
                    ) : (
                      <>
                        <Area type="monotone" dataKey="raw_distance" name={language === 'en' ? "Raw Sensor Gap (cm)" : "Raw Jarak Ultrasonik (cm)"} stroke="#10B981" strokeWidth={1.5} fillOpacity={1} fill="url(#colorRaw)" />
                        <ReferenceLine y={config?.reference_height || 300} stroke="#71717A" strokeDasharray="3 3" strokeWidth={1} label={{ value: 'TIANG/REF', fill: '#71717A', fontSize: 8, position: 'right', fontFamily: 'monospace' }} />
                      </>
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ROW 3: SYMMETRICAL 4-COLUMN TRAINED LSTM PROGNOSTIC FORECAST HORIZONS */}
      <div id="processed-forecast-panel" className="col-span-12 flex flex-col gap-3">
        <div className={`flex flex-wrap items-center justify-between gap-2 px-1`}>
          <div className="flex flex-col">
            <span className={`text-[10px] font-bold uppercase tracking-[0.22em] ${themeTextMuted} font-mono`}>
              {language === 'en' ? 'LSTM Elevation Forecast (Trained Neural Network)' : 'Prediksi Elevasi LSTM (Model Terlatih)'}
            </span>
            <span className="font-mono text-[9px] text-[#3B82F6] tracking-wider mt-0.5">
              {lstmForecast
                ? `${lstmForecast.modelMeta.sourceFile} // ${lstmForecast.modelMeta.architecture} • ${lstmForecast.modelMeta.totalParams.toLocaleString('id-ID')} params • MAE ${lstmForecast.modelMeta.maeCm} cm`
                : 'model_lstm_banjir.h5 // Menunggu data telemetri sensor...'}
            </span>
          </div>
          {lstmForecast && (
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
              <span className={`px-2 py-0.5 rounded-md border ${isDark ? 'bg-white/[0.03] border-white/10 text-zinc-400' : 'bg-slate-50 border-slate-200 text-slate-600'} tabular-nums`}>
                WINDOW: {lstmForecast.inputCount}/24
              </span>
              <span className={`px-2 py-0.5 rounded-md border ${isDark ? 'bg-white/[0.03] border-white/10 text-zinc-400' : 'bg-slate-50 border-slate-200 text-slate-600'} tabular-nums`}>
                {lstmForecast.inferenceMs.toFixed(1)} ms
              </span>
              <span className={`px-2 py-0.5 rounded-md border font-bold uppercase tracking-wider ${
                lstmForecast.status === 'Bahaya'
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                  : lstmForecast.status === 'Siaga'
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              }`}>
                {language === 'en' ? `6H OUTLOOK: ${lstmForecast.status}` : `PROYEKSI 6J: ${lstmForecast.status === 'Normal' ? 'AMAN' : lstmForecast.status.toUpperCase()}`}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              label: 'Horizon T+30m',
              value: lstmForecast ? lstmForecast.prediction_30m : latestPrediction?.prediction_30m,
              conf: lstmForecast ? lstmForecast.confidence_30m : latestPrediction?.confidence_score,
              iconClass: themeTextMuted,
              badgeClass: 'text-[#3B82F6] bg-[#3B82F6]/5 border-[#3B82F6]/15',
            },
            {
              label: language === 'en' ? 'Horizon T+1 Hour' : 'Horizon T+1 Jam',
              value: lstmForecast ? lstmForecast.prediction_1h : latestPrediction?.prediction_1h,
              conf: lstmForecast ? lstmForecast.confidence_1h : (latestPrediction ? Math.round(latestPrediction.confidence_score * 0.95) : undefined),
              iconClass: 'text-[#3B82F6]',
              badgeClass: 'text-[#3B82F6] bg-[#3B82F6]/5 border-[#3B82F6]/15',
            },
            {
              label: language === 'en' ? 'Horizon T+3 Hours' : 'Horizon T+3 Jam',
              value: lstmForecast ? lstmForecast.prediction_3h : latestPrediction?.prediction_3h,
              conf: lstmForecast ? lstmForecast.confidence_3h : (latestPrediction ? Math.round(latestPrediction.confidence_score * 0.88) : undefined),
              iconClass: 'text-purple-400',
              badgeClass: 'text-purple-400 bg-purple-950/15 border-purple-800/20',
            },
            {
              label: language === 'en' ? 'Horizon T+6 Hours' : 'Horizon T+6 Jam',
              value: lstmForecast ? lstmForecast.prediction_6h : latestPrediction?.prediction_6h,
              conf: lstmForecast ? lstmForecast.confidence_6h : (latestPrediction ? Math.round(latestPrediction.confidence_score * 0.78) : undefined),
              iconClass: 'text-amber-400',
              badgeClass: 'text-amber-400 bg-amber-950/15 border-amber-800/20',
            },
          ].map((card) => {
            const delta =
              lstmForecast && typeof card.value === 'number'
                ? Math.round((card.value - lstmForecast.currentLevel) * 10) / 10
                : null;
            const deltaColor =
              delta === null
                ? themeTextMuted
                : delta > 0.5
                  ? 'text-amber-400'
                  : delta < -0.5
                    ? 'text-emerald-400'
                    : themeTextMuted;

            return (
              <div key={card.label} className={`${themeCard} rounded-2xl p-5 flex flex-col justify-between`}>
                <div className={`flex justify-between items-center ${themeTextMuted} font-mono text-[9px] uppercase tracking-widest`}>
                  <span>{card.label}</span>
                  <Clock className={`w-3.5 h-3.5 ${card.iconClass}`} />
                </div>
                <div className="my-3 flex items-baseline justify-between gap-2">
                  <span className={`text-3xl font-sans font-light tracking-tight tabular-nums ${isDark ? 'text-white' : 'text-slate-800'}`}>
                    {typeof card.value === 'number' ? card.value.toFixed(1) : '--'}{' '}
                    <span className="text-xs font-normal text-slate-400">cm</span>
                  </span>
                  {delta !== null && (
                    <span className={`font-mono text-[10px] tabular-nums ${deltaColor}`}>
                      {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} cm
                    </span>
                  )}
                </div>
                <div className={`text-[10px] font-mono border rounded py-1 text-center tabular-nums ${card.badgeClass}`}>
                  CONF: {typeof card.conf === 'number' ? `${card.conf}%` : '--%'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ROW 4: OFFICIAL BMKG PUBLIC API WEATHER FORECAST */}
      <div id="bmkg-gauge" className={`col-span-12 ${themeCard} rounded-2xl p-6 relative overflow-hidden`}>
        <div className={`flex flex-wrap justify-between items-center gap-3 pb-4 mb-5 border-b ${themeBorder}`}>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col">
              <span className={`text-[10px] font-bold uppercase tracking-[0.25em] ${themeTextMuted} font-mono`}>
                {language === 'en' ? 'Official BMKG Weather Forecast' : 'Prakiraan Cuaca Resmi BMKG'}
              </span>
              <span className="font-mono text-[8px] text-[#3B82F6] uppercase tracking-wider mt-0.5">
                {liveWeather?.source === 'Open-Meteo'
                  ? (language === 'en' ? 'Open-Meteo Fallback // BMKG Unreachable' : 'Fallback Open-Meteo // API BMKG Tidak Terjangkau')
                  : `API PUBLIK BMKG // ADM4 ${liveWeather?.adm4 || '32.76.06.1005'}`}
              </span>
            </div>
            {liveWeather?.valid_hour_wib && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-[9px] font-bold uppercase tracking-wider text-sky-500 font-mono">
                <span>
                  {language === 'en'
                    ? `SLOT ${liveWeather.valid_hour_wib}`
                    : `PRAKIRAAN ${liveWeather.valid_hour_wib}`}
                </span>
                <span
                  title={
                    language === 'en'
                      ? `Official BMKG 3-hourly forecast slot (${liveWeather.valid_at})`
                      : `Slot prakiraan 3-jaman resmi BMKG (${liveWeather.valid_at})`
                  }
                >
                  <Info className="w-3 h-3 text-sky-400 cursor-help" />
                </span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {liveWeather?.last_updated && (
              <span className={`text-[9px] font-mono ${themeTextMuted}`}>
                {language === 'en' ? 'Synced: ' : 'Disinkronkan: '}{liveWeather.last_updated}
              </span>
            )}
            <button
              id="btn-sync-weather"
              onClick={() => fetchLiveWeather(language)}
              disabled={loadingWeather}
              className={`p-2 rounded-lg border transition-all cursor-pointer ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'}`}
              title={language === 'en' ? 'Refresh Official BMKG Data' : 'Muat Ulang Data Resmi BMKG'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingWeather ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loadingWeather ? (
          <div className="py-6 flex flex-col items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-[#3B82F6] mb-2" />
            <span className={`text-[9px] font-mono uppercase tracking-wider ${themeTextMuted} text-center px-4`}>
              {language === 'en'
                ? 'Fetching official weather forecast from BMKG public API...'
                : 'Mengambil data prakiraan cuaca resmi dari API publik BMKG...'}
            </span>
          </div>
        ) : liveWeather ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Left Zone: Verbatim BMKG Temperature, Condition & Location */}
            <div className="lg:col-span-4 flex items-center gap-4">
              <div className="relative flex-shrink-0">
                {liveWeather.weather_icon ? (
                  <img
                    src={liveWeather.weather_icon}
                    alt={liveWeather.condition}
                    className="w-16 h-16 object-contain filter drop-shadow"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <CloudRain className="w-16 h-16 text-[#3B82F6] filter drop-shadow" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-baseline flex-wrap gap-x-2">
                  <span className={`text-4xl font-bold tracking-tight tabular-nums ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {liveWeather.temperature_c}°C
                  </span>
                  <span className={`text-sm font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    {liveWeather.condition}
                  </span>
                </div>
                <span className={`text-[11px] ${themeTextSub} block mt-1 truncate`}>
                  {language === 'en' ? 'in ' : 'di '}{liveWeather.location_name}
                </span>
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] ${themeTextMuted} font-mono mt-1`}>
                  <span>
                    {language === 'en' ? 'Precip: ' : 'Curah hujan: '}{liveWeather.precipitation_mm ?? '—'}
                  </span>
                  {typeof liveWeather.cloud_cover_percent === 'number' && (
                    <span>
                      {language === 'en' ? 'Cloud: ' : 'Tutupan awan: '}{liveWeather.cloud_cover_percent}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Middle Zone: 2x2 Verbatim Atmospheric Telemetry Grid */}
            <div className="lg:col-span-4 grid grid-cols-2 gap-2.5">
              <div className={`flex items-center gap-2.5 px-3 py-2.5 border ${isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'} rounded-xl`}>
                <div className="text-sky-500 p-1.5 bg-sky-500/10 rounded-lg shrink-0">
                  <Droplet className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col text-[9.5px] leading-tight min-w-0">
                  <span className={themeTextMuted}>{language === 'en' ? 'Humidity' : 'Kelembapan'}</span>
                  <span className={`font-bold mt-0.5 tabular-nums ${isDark ? 'text-white' : 'text-slate-800'}`}>
                    {typeof liveWeather.humidity_percent === 'number' ? `${liveWeather.humidity_percent}%` : '—'}
                  </span>
                </div>
              </div>

              <div className={`flex items-center gap-2.5 px-3 py-2.5 border ${isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'} rounded-xl`}>
                <div className="text-[#3B82F6] p-1.5 bg-blue-500/10 rounded-lg shrink-0">
                  <Wind className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col text-[9.5px] leading-tight min-w-0">
                  <span className={themeTextMuted}>{language === 'en' ? 'Wind Speed' : 'Kecepatan Angin'}</span>
                  <span className={`font-bold mt-0.5 tabular-nums ${isDark ? 'text-white' : 'text-slate-800'}`}>
                    {typeof liveWeather.wind_speed_kph === 'number'
                      ? `${liveWeather.wind_speed_kph.toLocaleString(language === 'en' ? 'en-US' : 'id-ID')} ${language === 'en' ? 'km/h' : 'km/j'}`
                      : '—'}
                  </span>
                </div>
              </div>

              <div className={`flex items-center gap-2.5 px-3 py-2.5 border ${isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'} rounded-xl`}>
                <div className="text-indigo-400 p-1.5 bg-indigo-500/10 rounded-lg shrink-0">
                  <Compass className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col text-[9.5px] leading-tight min-w-0">
                  <span className={themeTextMuted}>{language === 'en' ? 'Wind Direction' : 'Arah Angin'}</span>
                  <span className={`font-bold mt-0.5 truncate ${isDark ? 'text-white' : 'text-slate-800'}`}>
                    {liveWeather.wind_direction || '—'}
                  </span>
                </div>
              </div>

              <div className={`flex items-center gap-2.5 px-3 py-2.5 border ${isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'} rounded-xl`}>
                <div className="text-emerald-500 p-1.5 bg-emerald-500/10 rounded-lg shrink-0">
                  <Eye className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col text-[9.5px] leading-tight min-w-0">
                  <span className={themeTextMuted}>{language === 'en' ? 'Visibility' : 'Jarak Pandang'}</span>
                  <span className={`font-bold mt-0.5 tabular-nums ${isDark ? 'text-white' : 'text-slate-800'}`}>
                    {liveWeather.visibility_km || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Zone: Verbatim Upcoming 3-Hourly BMKG Forecast Slots */}
            <div className={`lg:col-span-4 flex flex-col gap-2 p-3.5 rounded-xl border ${isDark ? 'bg-white/[0.02] border-white/5' : 'bg-slate-50/80 border-slate-200/80'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[9px] font-bold uppercase tracking-[0.18em] font-mono ${themeTextMuted}`}>
                  {language === 'en' ? 'Upcoming BMKG Forecast (WIB)' : 'Prakiraan BMKG Berikutnya (WIB)'}
                </span>
                <span className={`text-[8.5px] font-mono ${themeTextMuted}`}>
                  {liveWeather.valid_at || '—'}
                </span>
              </div>

              {Array.isArray(liveWeather.forecast_slots) && liveWeather.forecast_slots.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {liveWeather.forecast_slots.map((slot, idx) => (
                    <div
                      key={`${slot.date_label}-${slot.time_wib}-${idx}`}
                      title={`${slot.date_label} ${slot.time_wib} WIB · ${slot.condition} · ${slot.wind_speed_kph ?? '—'} km/j (${slot.wind_direction})`}
                      className={`flex flex-col items-center justify-between py-2 px-1.5 rounded-lg border text-center ${
                        isDark ? 'bg-white/[0.03] border-white/5' : 'bg-white border-slate-200/70'
                      }`}
                    >
                      <span className={`text-[9.5px] font-mono font-bold tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        {slot.time_wib}
                      </span>
                      {slot.weather_icon ? (
                        <img
                          src={slot.weather_icon}
                          alt={slot.condition}
                          className="w-7 h-7 my-1 object-contain"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <CloudRain className="w-5 h-5 my-1.5 text-sky-400" />
                      )}
                      <span className={`text-xs font-bold tabular-nums ${isDark ? 'text-white' : 'text-slate-900'}`}>
                        {slot.temperature_c}°
                      </span>
                      <span className={`text-[9px] font-mono tabular-nums ${themeTextMuted}`}>
                        {typeof slot.humidity_percent === 'number' ? `${slot.humidity_percent}%` : '—'}
                      </span>
                      {typeof slot.precipitation_mm === 'number' && slot.precipitation_mm > 0 ? (
                        <span className="text-[8.5px] font-mono font-semibold text-sky-400 tabular-nums mt-0.5">
                          {slot.precipitation_mm.toLocaleString(language === 'en' ? 'en-US' : 'id-ID')} mm
                        </span>
                      ) : (
                        <span className={`text-[8px] truncate max-w-full mt-0.5 ${themeTextMuted}`}>
                          {slot.condition}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-[10px] font-mono py-3 text-center ${themeTextMuted}`}>
                  {language === 'en'
                    ? '3-hourly BMKG forecast slots unavailable in fallback mode.'
                    : 'Slot prakiraan 3-jaman BMKG tidak tersedia pada mode fallback.'}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={`flex flex-col items-center justify-center gap-2 py-6 text-center`}>
            <span className={`text-[10px] font-mono ${themeTextMuted}`}>
              {weatherError || (language === 'en'
                ? 'Official BMKG weather data is currently unavailable.'
                : 'Data prakiraan cuaca resmi BMKG sedang tidak tersedia.')}
            </span>
            <button
              onClick={() => fetchLiveWeather(language)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold border transition-colors cursor-pointer ${
                isDark
                  ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-200'
                  : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800'
              }`}
            >
              {language === 'en' ? 'Retry BMKG Sync' : 'Coba Muat Ulang BMKG'}
            </button>
          </div>
        )}
      </div>

      {/* KEMBARAN DIGITAL KORIDOR CILIWUNG 2D / 3D / GRAFIK PREDIKSI +30M */}
      <CiliwungHardwareLiveView
        theme={theme}
        language={language}
        latestReading={latestReading}
        readings={readingsList}
        config={config || {}}
        loadDayHistory={() => loadHardwareHistory24h(db, config?.reference_height || 300)}
        onEnterSimulation={onNavigateTab ? () => onNavigateTab('simulation') : undefined}
      />

    </div>
  );
}
