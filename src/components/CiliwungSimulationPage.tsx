import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Curve } from 'recharts';
import {
  Map as MapIcon,
  LineChart as LineChartIcon,
  Info,
  Play,
  Square,
  RotateCcw,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Map2D } from './CiliwungHardwareLiveView';
import CiliwungOfficial3DView from './CiliwungOfficial3DView';
import graphScale from './ciliwung-graph-scale.json';
import { unlockAlertAudio } from '../utils/alarmAudio';
import { getApiBaseUrl } from '../utils/apiBase';

type ScenarioId = 'ringan' | 'sedang' | 'lebat';
type SpeedMultiplier = 1 | 10 | 25 | 50 | 150;
type SimulationView = 'map2d' | 'map3d' | 'graph';
type SimulationTab = 'map' | 'graph';
type MapLayer = 'map3d' | 'map2d';
type SimulationMode = 'legacy' | 'rain_replay';
type Episode = { episodeId: string; label?: string; name?: string };

type CiliwungNode = {
  id: string;
  name: string;
  cupcarbonNodeId: number;
  threeDNodeId: string | null;
  tmaCm: number;
  stageRiseM: number;
  status: 'AMAN' | 'SIAGA' | 'BANJIR_JAKARTA';
  rainRateMmH?: number | null;
  rainMm5m?: number | null;
  rainSource?: string;
  tmaSource?: string;
};

type CiliwungForecast = {
  runId: string | null;
  nodeId: string;
  mode?: string;
  status: 'available' | 'unavailable';
  reason?: string;
  issuedAt?: string;
  generatedAt?: string;
  clockBasis?: string;
  predictedTmaCm?: { '30': number; '60': number };
  crossingWithin?: { '30': boolean | null; '60': boolean | null };
  trajectoryCm?: number[];
  thresholdBanjirCm?: number | null;
  inputProvenance?: { upstreamFeature?: string; rain?: string; tma?: string; bmkgContext?: string };
  method?: string;
  modelVersion?: string;
  quality?: string;
};

type CiliwungState = {
  runId: string | null;
  mode?: 'legacy' | 'rain_replay' | 'synthetic_demo' | string;
  episodeId?: string | null;
  scenario: ScenarioId | null;
  status: 'idle' | 'running' | 'stopped' | 'completed';
  speedMultiplier: SpeedMultiplier;
  simTimeSeconds: number;
  timestampUtc?: string;
  targetNodeId: string | null;
  targetThresholdCm: number | null;
  cupcarbon: { status: string; warning: string; lastSeenAt: number | null; activeNodeCount: number };
  cupNodes: CiliwungNode[];
  threeDNodes: CiliwungNode[];
  pendingReachCount: number;
  updatedAt: number;
};

type LegacyProjection = {
  status: 'available';
  method: 'legacy_simulation_projection';
  runId: string;
  nodeId: string;
  issuedSimTimeSeconds: number;
  speedMultiplier: SpeedMultiplier;
  points: Array<{ afterSeconds: number; tmaCm: number }>;
  scenarioCompletes: boolean;
};

type HistoryPoint = {
  runId: string;
  time: number;
  values: Record<string, number>;
};

const SIMULATION_UPSTREAM = [
  { id: 'UP1', label: 'UP1 · Puncak', lat: -6.691768, lng: 106.9635388 },
  { id: 'UP2', label: 'UP2 · Katulampa', lat: -6.6336889, lng: 106.834688 },
  { id: 'UP3', label: 'UP3 · Sukaraja', lat: -6.5601124, lng: 106.809813 },
  { id: 'UP4', label: 'UP4 · Cibinong', lat: -6.4650414, lng: 106.8180795 },
];

const SCENARIOS: Array<{ id: ScenarioId; labelId: string; labelEn: string; descriptionId: string; descriptionEn: string }> = [
  {
    id: 'ringan',
    labelId: 'Hujan Ringan',
    labelEn: 'Light Rain',
    descriptionId: 'Skenario berakhir saat pos hulu Puncak (UP1) mencapai SIAGA.',
    descriptionEn: 'Scenario completes when Puncak (UP1) reaches ALERT.',
  },
  {
    id: 'sedang',
    labelId: 'Hujan Sedang',
    labelEn: 'Moderate Rain',
    descriptionId: 'Skenario berakhir saat Ciliwung Stage 2 (N3) mencapai SIAGA.',
    descriptionEn: 'Scenario completes when Stage 2 (N3) reaches ALERT.',
  },
  {
    id: 'lebat',
    labelId: 'Hujan Lebat',
    labelEn: 'Heavy Rain',
    descriptionId: 'Skenario berakhir saat Pintu Air Manggarai (N5) mencapai BANJIR.',
    descriptionEn: 'Scenario completes when Manggarai (N5) reaches FLOOD.',
  },
];

const MAIN_GRAPH_NODES = ['UP1', 'UP2', 'UP3', 'UP4', 'N1', 'N2', 'N3', 'N4', 'N5'];
const FORECAST_NODES = new Set(MAIN_GRAPH_NODES);
const SPEED_OPTIONS: SpeedMultiplier[] = [1, 10, 25, 50, 150];

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function statusLabel(status: CiliwungNode['status'], en = false) {
  if (status === 'BANJIR_JAKARTA') return en ? 'FLOOD' : 'BANJIR';
  if (status === 'SIAGA') return en ? 'ALERT' : 'SIAGA';
  return en ? 'SAFE' : 'AMAN';
}

function simStatusLabel(status: CiliwungState['status'] | undefined, en = false) {
  if (status === 'running') return en ? 'RUNNING' : 'BERJALAN';
  if (status === 'completed') return en ? 'COMPLETED' : 'SELESAI';
  if (status === 'stopped') return en ? 'STOPPED' : 'BERHENTI';
  return en ? 'IDLE' : 'STANDBY';
}

export default function CiliwungSimulationPage({
  theme = 'dark',
  language = 'id',
  onExit,
  onAlertStatusChange,
}: {
  theme?: 'light' | 'dark';
  language?: 'id' | 'en';
  onExit: () => void;
  onAlertStatusChange?: (status: 'Normal' | 'Siaga' | 'Bahaya') => void;
}) {
  const isDark = theme === 'dark';
  const en = language === 'en';
  const [selectedMode, setSelectedMode] = useState<SimulationMode>('legacy');
  const [selectedScenario, setSelectedScenario] = useState<ScenarioId>('ringan');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState('');
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  const [selectedSpeed, setSelectedSpeed] = useState<SpeedMultiplier>(1);
  const [simTab, setSimTab] = useState<SimulationTab>('map');
  const [mapLayer, setMapLayer] = useState<MapLayer>('map3d');
  const [showScenarioDetails, setShowScenarioDetails] = useState(false);
  const activeView: SimulationView = simTab === 'graph' ? 'graph' : mapLayer;
  const [state, setState] = useState<CiliwungState | null>(null);
  const [forecasts, setForecasts] = useState<Record<string, CiliwungForecast>>({});
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [legacyProjection, setLegacyProjection] = useState<LegacyProjection | null>(null);
  const [projectionError, setProjectionError] = useState(false);
  const [graphNodeId, setGraphNodeId] = useState('N1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const projectionRequestRef = useRef<symbol | null>(null);

  useEffect(() => () => { projectionRequestRef.current = null; }, []);

  useEffect(() => {
    if (!onAlertStatusChange) return;
    if (!state?.runId || (state.status !== 'running' && state.status !== 'completed')) {
      onAlertStatusChange('Normal');
      return;
    }
    const nodes = [
      ...(Array.isArray(state.cupNodes) ? state.cupNodes : []),
      ...(Array.isArray(state.threeDNodes) ? state.threeDNodes : []),
    ];
    const hasBahaya = nodes.some((n) => n.status === 'BANJIR_JAKARTA');
    const hasSiaga = nodes.some((n) => n.status === 'SIAGA');
    onAlertStatusChange(hasBahaya ? 'Bahaya' : hasSiaga ? 'Siaga' : 'Normal');
  }, [state, onAlertStatusChange]);

  useEffect(() => {
    return () => {
      onAlertStatusChange?.('Normal');
    };
  }, [onAlertStatusChange]);

  const apiBase = getApiBaseUrl();

  const handleSelectNode = (nodeId: string) => {
    setGraphNodeId(nodeId);
  };

  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/ciliwung-simulation/episodes`)
      .then(async (response) => {
        if (!response.ok) throw new Error('episodes_unavailable');
        return response.json() as Promise<Episode[]>;
      })
      .then((list) => {
        if (!active || !Array.isArray(list)) return;
        setEpisodes(list);
        if (list.length > 0) setSelectedEpisodeId((cur) => cur || list[0].episodeId);
      })
      .catch(() => {
        if (active) setEpisodeError(en ? 'Failed to load synthetic episodes.' : 'Gagal memuat daftar episode sintetis.');
      });
    return () => {
      active = false;
    };
  }, [apiBase, en]);

  useEffect(() => {
    const stream = new EventSource(`${apiBase}/api/ciliwung-simulation/stream`);
    eventSourceRef.current = stream;
    const handleState = (event: MessageEvent<string>) => {
      try {
        const next = JSON.parse(event.data) as CiliwungState;
        setState(next);
        setError(null);
        if (next.runId && next.status !== 'idle' && Array.isArray(next.cupNodes)) {
          const point: HistoryPoint = {
            runId: next.runId,
            time: next.simTimeSeconds,
            values: Object.fromEntries(
              next.cupNodes.filter((node) => Number.isFinite(node.tmaCm)).map((node) => [node.id, node.tmaCm])
            ),
          };
          setHistory((current) => {
            const matching = current.filter((item) => item.runId === point.runId && item.time < point.time);
            return [...matching, point].slice(-120);
          });
        } else {
          setHistory([]);
        }
        if (next.runId && next.status !== 'idle') {
          if (next.status === 'running') setSelectedSpeed(next.speedMultiplier);
          if (next.mode === 'rain_replay' || next.mode === 'synthetic_demo' || next.episodeId) {
            setSelectedMode('rain_replay');
            if (next.episodeId) setSelectedEpisodeId(next.episodeId);
          } else {
            setSelectedMode('legacy');
            if (SCENARIOS.some((scenario) => scenario.id === next.scenario)) setSelectedScenario(next.scenario!);
          }
        }
      } catch {
        setError(en ? 'Invalid simulation state from backend.' : 'State simulasi dari backend tidak valid.');
      }
    };

    stream.addEventListener('state', handleState as EventListener);
    stream.addEventListener(
      'forecast',
      ((event: MessageEvent<string>) => {
        try {
          const next = JSON.parse(event.data) as CiliwungForecast | null;
          if (next && typeof next.nodeId === 'string') {
            setForecasts((current) => ({ ...current, [next.nodeId]: next }));
          } else {
            setForecasts({});
          }
        } catch {
          setError(en ? 'Invalid forecast from backend.' : 'Forecast dari backend tidak valid.');
        }
      }) as EventListener
    );
    stream.onerror = () =>
      setError(en ? 'Simulation stream disconnected. Keep the backend running.' : 'Stream simulasi terputus. Pastikan backend Website tetap berjalan.');

    return () => {
      stream.close();
      eventSourceRef.current = null;
    };
  }, [apiBase, en]);

  useEffect(() => {
    if (!state?.runId || state.status === 'idle') return;
    const runId = state.runId;
    let active = true;
    fetch(`${apiBase}/api/ciliwung-simulation/history`)
      .then(async (response) => {
        if (!response.ok) throw new Error('simulation_history_unavailable');
        return response.json() as Promise<{ runId: string; points: HistoryPoint[] }>;
      })
      .then((payload) => {
        if (!active || payload.runId !== runId || !Array.isArray(payload.points)) return;
        const valid = payload.points.filter(
          (point) => point.runId === runId && Number.isFinite(point.time) && point.values && typeof point.values === 'object'
        );
        setHistory((current) => {
          const live = current.filter((point) => point.runId === runId);
          const byTime = new Map([...valid, ...live].map((point) => [point.time, point]));
          return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-120);
        });
      })
      .catch(() => {
        /* SSE continues to supply live points. */
      });
    return () => {
      active = false;
    };
  }, [apiBase, state?.runId, state?.mode, state?.status]);

  useEffect(() => {
    const replay = state?.mode === 'rain_replay' || state?.mode === 'synthetic_demo' || Boolean(state?.episodeId);
    if (!replay || state?.status !== 'running' || !state.runId || !FORECAST_NODES.has(graphNodeId)) return;
    let active = true;
    fetch(`${apiBase}/api/ciliwung-forecast/latest?nodeId=${encodeURIComponent(graphNodeId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('forecast_unavailable');
        const payload = await response.json();
        const next = (payload?.forecast ?? payload) as CiliwungForecast;
        if (active && next && typeof next.nodeId === 'string') {
          setForecasts((current) => {
            const previous = current[next.nodeId];
            return previous?.runId === next.runId && previous.status === 'available' && next.status === 'unavailable'
              ? current
              : { ...current, [next.nodeId]: next };
          });
        }
      })
      .catch(() => {
        if (active) {
          setForecasts((current) => ({
            ...current,
            [graphNodeId]: { runId: state.runId, nodeId: graphNodeId, status: 'unavailable', reason: 'forecast_unavailable' },
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [apiBase, state?.runId, state?.mode, state?.episodeId, state?.status, graphNodeId]);

  const availableNodes = state?.cupNodes ?? [];
  useEffect(() => {
    if (availableNodes.length && !availableNodes.some((node) => node.id === graphNodeId)) {
      setGraphNodeId(availableNodes[0].id);
    }
  }, [availableNodes, graphNodeId]);

  const selectedProfile = SCENARIOS.find((scenario) => scenario.id === selectedScenario) ?? SCENARIOS[0];
  const isRunning = state?.status === 'running';
  const isReplay = state?.mode === 'rain_replay' || state?.mode === 'synthetic_demo' || Boolean(state?.episodeId);
  const candidateForecast = forecasts[graphNodeId];
  const selectedForecast =
    isReplay &&
    isRunning &&
    candidateForecast?.runId === state?.runId &&
    (candidateForecast.issuedAt === state?.timestampUtc || (candidateForecast.status === 'unavailable' && !candidateForecast.issuedAt))
      ? candidateForecast
      : null;

  const thresholdCompatible =
    selectedForecast?.thresholdBanjirCm === null
      ? graphNodeId === 'UP1' && ([30, 60] as const).every((minutes) => selectedForecast.crossingWithin?.[minutes] === null)
      : graphNodeId !== 'UP1' &&
        Number.isFinite(selectedForecast?.thresholdBanjirCm) &&
        ([30, 60] as const).every((minutes) => typeof selectedForecast?.crossingWithin?.[minutes] === 'boolean');

  const forecastAvailable =
    selectedForecast?.status === 'available' &&
    Number.isFinite(selectedForecast.predictedTmaCm?.['30']) &&
    Number.isFinite(selectedForecast.predictedTmaCm?.['60']) &&
    selectedForecast.trajectoryCm?.length === 12 &&
    selectedForecast.trajectoryCm.every(Number.isFinite) &&
    thresholdCompatible;

  const cupCarbonActive = state?.cupcarbon?.status === 'active';
  const cupCarbonNodeCount = state?.cupcarbon?.activeNodeCount ?? 0;
  const currentNode = availableNodes.find((node) => node.id === graphNodeId);
  const currentTime = state?.simTimeSeconds ?? 0;
  const projectionOffset = legacyProjection ? currentTime - legacyProjection.issuedSimTimeSeconds : -1;

  const projectionPoint =
    isRunning &&
    !isReplay &&
    legacyProjection?.runId === state?.runId &&
    legacyProjection.nodeId === graphNodeId &&
    legacyProjection.speedMultiplier === state?.speedMultiplier
      ? legacyProjection.points.find(
          (point) =>
            Math.abs(point.afterSeconds - projectionOffset) < 0.001 &&
            Number.isFinite(currentNode?.tmaCm) &&
            Math.abs(point.tmaCm - currentNode!.tmaCm) < 0.011
        )
      : undefined;

  const projectionRemaining = legacyProjection
    ? legacyProjection.points[legacyProjection.points.length - 1].afterSeconds - projectionOffset
    : 0;
  const projectionHasFuture = Boolean(
    projectionPoint &&
      legacyProjection &&
      projectionRemaining > 0 &&
      (projectionRemaining >= 1800 || legacyProjection.scenarioCompletes)
  );

  useEffect(() => {
    if (
      activeView !== 'graph' ||
      !isRunning ||
      isReplay ||
      !state?.runId ||
      !currentNode ||
      projectionHasFuture ||
      projectionRequestRef.current
    )
      return;

    const requestId = Symbol('projection_request');
    projectionRequestRef.current = requestId;
    setProjectionError(false);

    fetch(`${apiBase}/api/ciliwung-simulation/projection?nodeId=${encodeURIComponent(graphNodeId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('projection_unavailable');
        return response.json() as Promise<LegacyProjection>;
      })
      .then((result) => {
        if (projectionRequestRef.current !== requestId) return;
        projectionRequestRef.current = null;
        if (
          result?.status !== 'available' ||
          result.method !== 'legacy_simulation_projection' ||
          result.runId !== state.runId ||
          result.nodeId !== graphNodeId ||
          !Number.isFinite(result.issuedSimTimeSeconds) ||
          !Array.isArray(result.points) ||
          result.points.length < 2 ||
          !result.points.every(
            (point, index) =>
              Number.isFinite(point.afterSeconds) &&
              Number.isFinite(point.tmaCm) &&
              point.tmaCm >= 0 &&
              (index === 0 ? point.afterSeconds === 0 : point.afterSeconds > result.points[index - 1].afterSeconds)
          )
        ) {
          setProjectionError(true);
          return;
        }
        setLegacyProjection(result);
      })
      .catch(() => {
        if (projectionRequestRef.current === requestId) {
          projectionRequestRef.current = null;
          setProjectionError(true);
        }
      });
  }, [
    activeView,
    apiBase,
    graphNodeId,
    isReplay,
    isRunning,
    state?.runId,
    state?.simTimeSeconds,
    state?.speedMultiplier,
    currentNode,
    legacyProjection,
    projectionHasFuture,
  ]);

  const currentLevel =
    state?.runId && state.status !== 'idle' && currentNode && Number.isFinite(currentNode.tmaCm) ? currentNode.tmaCm : null;

  const currentHistory =
    currentLevel === null
      ? []
      : [
          ...history.filter(
            (point) =>
              point.runId === state?.runId &&
              point.time < currentTime &&
              point.time >= currentTime - 1800 &&
              Number.isFinite(point.values[graphNodeId])
          ),
          { runId: state!.runId!, time: currentTime, values: { [graphNodeId]: currentLevel } },
        ];

  const projectedFuture =
    projectionHasFuture && legacyProjection
      ? legacyProjection.points
          .filter((point) => point.afterSeconds > projectionOffset && point.afterSeconds - projectionOffset <= 1800)
          .filter(
            (point, index, points) =>
              index === points.length - 1 ||
              index === 0 ||
              Math.floor((point.afterSeconds - projectionOffset) / 30) >
                Math.floor((points[index - 1].afterSeconds - projectionOffset) / 30)
          )
          .map((point) => ({ afterSeconds: point.afterSeconds - projectionOffset, tmaCm: point.tmaCm }))
      : [];

  const prediction =
    forecastAvailable && currentLevel !== null
      ? selectedForecast!.trajectoryCm!.slice(0, 6).map((tmaCm, index) => ({ afterSeconds: (index + 1) * 300, tmaCm }))
      : projectedFuture;

  const projectionEndsEarly = Boolean(
    projectionPoint &&
      legacyProjection?.scenarioCompletes &&
      prediction.length &&
      prediction[prediction.length - 1].afterSeconds < 1800
  );

  const graphLevels = [
    ...currentHistory.map((point) => point.values[graphNodeId]),
    ...prediction.map((point) => point.tmaCm),
  ];

  const reference = (graphScale.maxTmaCmByNode as Record<string, number>)[graphNodeId];
  const graphMax = Math.max(
    20,
    Math.ceil((Math.max(Number.isFinite(reference) ? reference : 0, 0, ...graphLevels) * 1.1 - 1e-9) / 20) * 20
  );
  const graphY = (level: number) => 190 - (level / graphMax) * 180;
  const livePoints = currentHistory.map((point) => ({
    x: 360 - ((currentTime - point.time) / 1800) * 352,
    y: graphY(point.values[graphNodeId]),
  }));
  const predictedPoints =
    prediction.length && currentLevel !== null
      ? [{ x: 360, y: graphY(currentLevel) }, ...prediction.map((point) => ({ x: 360 + (point.afterSeconds * 352) / 1800, y: graphY(point.tmaCm) }))]
      : [];

  async function request(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || (en ? 'Simulation request failed.' : 'Permintaan simulasi gagal.'));
      }
      return payload;
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : (en ? 'Simulation request failed.' : 'Permintaan simulasi gagal.');
      setError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    unlockAlertAudio();
    if (selectedMode === 'rain_replay') {
      if (!selectedEpisodeId) return;
      await request('/api/ciliwung-simulation/replay/start', { episodeId: selectedEpisodeId, speedMultiplier: selectedSpeed });
    } else {
      await request('/api/ciliwung-simulation/start', { scenario: selectedScenario, speedMultiplier: selectedSpeed });
    }
  }

  async function handleSpeedChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextSpeed = Number(event.target.value) as SpeedMultiplier;
    setSelectedSpeed(nextSpeed);
    if (isRunning) {
      const payload = await request('/api/ciliwung-simulation/speed', { speedMultiplier: nextSpeed });
      if (!payload) setSelectedSpeed(state?.speedMultiplier ?? 1);
    }
  }

  async function handleStop() {
    await request('/api/ciliwung-simulation/stop');
  }

  async function handleReset() {
    const payload = await request('/api/ciliwung-simulation/reset');
    if (payload) setSelectedSpeed(1);
  }

  async function handleExit() {
    if (isRunning) await request('/api/ciliwung-simulation/stop');
    eventSourceRef.current?.close();
    onExit();
  }

  const map2dSnapshot = useMemo(
    () =>
      state
        ? {
            mode: 'hardware' as const,
            runId: state.runId,
            status: (state.runId && state.status !== 'idle' ? 'running' : 'idle') as 'idle' | 'running',
            timestampUtc: state.timestampUtc,
            hardware: {
              nodeId: 'N1' as const,
              tmaCm: state.threeDNodes.find((node) => node.id === 'N1')?.tmaCm,
              freshness: (state.runId && state.status !== 'idle' ? 'live' : 'stale') as 'live' | 'stale',
              condition: (state.scenario === 'ringan' || state.scenario === 'sedang' || state.scenario === 'lebat'
                ? state.scenario
                : 'sedang') as 'ringan' | 'sedang' | 'lebat',
            },
            threeDNodes: state.threeDNodes.map((node) => ({
              ...node,
              valueType: 'simulation' as const,
              source: 'simulation',
            })),
            cupNodes: [],
          }
        : null,
    [state]
  );

  return (
    <div id="simulation-page-root" className={`${isDark ? 'text-slate-200' : 'text-slate-700'} flex flex-col gap-4 pb-6`}>
      {/* COMPACT SCENARIO & RUNTIME CONTROL BAR */}
      <section
        id="simulation-control-bar"
        className={`${isDark ? 'bg-[#0D0D0F] border-white/5' : 'bg-white border-slate-200 shadow-sm'} rounded-2xl border px-4 py-3.5 sm:px-5 flex flex-col gap-3`}
      >
        {/* Top Row: Compact Title + Status Telemetry + Back Button */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-amber-400 animate-ping' : 'bg-[#3B82F6]'}`} />
              <h1 className={`text-sm sm:text-base font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {en ? 'Ciliwung 9-Node Simulation' : 'Simulasi 9-Node DAS Ciliwung'}
              </h1>
            </div>

            {/* Live Compact Telemetry Chips */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono tabular-nums">
              <span
                className={`px-2 py-0.5 rounded-md border uppercase font-bold ${
                  state?.status === 'completed'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : state?.status === 'running'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : isDark
                        ? 'border-white/10 bg-white/[0.03] text-slate-400'
                        : 'border-slate-200 bg-slate-100 text-slate-600'
                }`}
              >
                {simStatusLabel(state?.status, en)} · {formatTime(state?.simTimeSeconds ?? 0)}
              </span>

              <span
                className={`px-2 py-0.5 rounded-md border ${
                  cupCarbonActive
                    ? isDark
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : isDark
                      ? 'border-white/10 bg-white/[0.03] text-slate-400'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}
              >
                CupCarbon {cupCarbonNodeCount}/9 · {cupCarbonActive ? (en ? 'ACTIVE' : 'AKTIF') : 'STANDBY'}
              </span>

              {state?.targetNodeId && (
                <span className={`hidden md:inline-flex px-2 py-0.5 rounded-md border ${isDark ? 'border-white/10 bg-white/[0.03] text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                  Target: {state.cupNodes.find((node) => node.id === state.targetNodeId)?.name ?? state.targetNodeId}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowScenarioDetails((prev) => !prev)}
              aria-expanded={showScenarioDetails}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                showScenarioDetails
                  ? 'border-[#3B82F6]/40 bg-[#3B82F6]/10 text-[#3B82F6]'
                  : isDark
                    ? 'border-white/10 bg-white/5 hover:bg-white/10 text-slate-300'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
              }`}
              title={en ? 'Toggle scenario explanation' : 'Tampilkan atau sembunyikan detail skenario'}
            >
              <Info className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{en ? 'Details' : 'Detail'}</span>
              {showScenarioDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            <button
              type="button"
              onClick={handleExit}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer ${
                isDark
                  ? 'border-white/10 bg-white/5 hover:bg-white/10 text-slate-300'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{en ? 'Live Hardware' : 'Hardware Live'}</span>
            </button>
          </div>
        </div>

        {/* Second Row: Inline Controls (Mode + Scenario/Episode + Speed + Run Controls) */}
        <div className={`pt-2.5 border-t ${isDark ? 'border-white/5' : 'border-slate-100'} flex flex-col xl:flex-row xl:items-center justify-between gap-2.5`}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap min-w-0">
            {/* Mode Switch */}
            <div
              className={`grid grid-cols-2 sm:inline-flex p-0.5 rounded-lg border text-[11px] font-bold ${
                isDark ? 'border-white/10 bg-black/40' : 'border-slate-200 bg-slate-100'
              }`}
            >
              <button
                type="button"
                disabled={busy || isRunning}
                onClick={() => setSelectedMode('legacy')}
                className={`px-2.5 py-1.5 rounded-md transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap ${
                  selectedMode === 'legacy'
                    ? 'bg-[#3B82F6] text-black shadow-sm'
                    : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {en ? 'Routing' : 'Skenario'}
              </button>
              <button
                type="button"
                disabled={busy || isRunning}
                onClick={() => setSelectedMode('rain_replay')}
                className={`px-2.5 py-1.5 rounded-md transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap ${
                  selectedMode === 'rain_replay'
                    ? 'bg-[#3B82F6] text-black shadow-sm'
                    : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {en ? 'Replay 24h' : 'Replay 24J'}
              </button>
            </div>

            {/* Scenario Pills OR Synthetic Replay Episode Selector */}
            {selectedMode === 'legacy' ? (
              <div
                className={`grid grid-cols-3 sm:inline-flex p-0.5 rounded-lg border text-[11px] font-bold ${
                  isDark ? 'border-white/10 bg-black/40' : 'border-slate-200 bg-slate-100'
                }`}
                role="group"
                aria-label={en ? 'Rainfall scenario' : 'Pilihan skenario hujan'}
              >
                {SCENARIOS.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => setSelectedScenario(scenario.id)}
                    disabled={busy || isRunning}
                    title={en ? scenario.descriptionEn : scenario.descriptionId}
                    className={`px-2 sm:px-3 py-1.5 rounded-md text-[10.5px] sm:text-[11px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                      selectedScenario === scenario.id
                        ? isDark
                          ? 'bg-white/15 text-white border border-[#3B82F6]/60'
                          : 'bg-white text-slate-900 border border-[#3B82F6]/60 shadow-sm'
                        : isDark
                          ? 'text-slate-400 hover:text-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {en ? scenario.labelEn : scenario.labelId}
                  </button>
                ))}
              </div>
            ) : (
              <select
                id="synthetic-episode"
                aria-label="Synthetic episode"
                value={selectedEpisodeId}
                onChange={(event) => setSelectedEpisodeId(event.target.value)}
                disabled={busy || isRunning || episodes.length === 0}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium min-w-[200px] sm:max-w-xs outline-none ${
                  isDark ? 'bg-black/40 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-800'
                }`}
              >
                {episodes.length === 0 && <option value="">{en ? 'No episodes available' : 'Tidak ada episode tersedia'}</option>}
                {episodes.map((episode) => (
                  <option key={episode.episodeId} value={episode.episodeId}>
                    {episode.label || episode.name || episode.episodeId}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Right Runtime Action Group: Speed + Start / Stop / Reset */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-mono uppercase ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                {en ? 'Speed' : 'Kecepatan'}
              </span>
              <select
                aria-label="Simulation speed"
                value={isRunning ? state?.speedMultiplier ?? selectedSpeed : selectedSpeed}
                onChange={handleSpeedChange}
                disabled={busy}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-mono font-bold outline-none ${
                  isDark ? 'border-white/10 bg-black/40 text-white' : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                {SPEED_OPTIONS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}x
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={handleStart}
                disabled={busy || isRunning || (selectedMode === 'rain_replay' && !selectedEpisodeId)}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#3B82F6] hover:bg-blue-400 text-black text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {isRunning
                    ? en
                      ? 'Running...'
                      : 'Berjalan...'
                    : selectedMode === 'rain_replay'
                      ? en
                        ? 'Start Replay'
                        : 'Mulai Replay'
                      : en
                        ? 'Start'
                        : 'Mulai'}
                </span>
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={busy || !isRunning}
                className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap ${
                  isDark ? 'border-white/10 bg-white/5 hover:bg-white/10' : 'border-slate-200 bg-white hover:bg-slate-100'
                }`}
              >
                <Square className="w-3 h-3" />
                <span>{en ? 'Stop' : 'Hentikan'}</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={busy}
                className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap ${
                  isDark ? 'border-white/10 bg-white/5 hover:bg-white/10' : 'border-slate-200 bg-white hover:bg-slate-100'
                }`}
                title="Reset"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            </div>
          </div>
        </div>

        {/* Optional Collapsible Scenario Explanation */}
        {showScenarioDetails && (
          <div
            className={`rounded-xl border p-3.5 text-xs leading-relaxed ${
              isDark ? 'border-white/10 bg-black/30 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <p className="mb-2">
              {en
                ? 'Deterministic propagation across 9 stations (Puncak UP1 → Manggarai N5) synchronized live across 3D visualization, 2D corridor map, and +30m prognostic forecasts.'
                : 'Propagasi hidrologi deterministik lintas 9 stasiun (Puncak UP1 → Manggarai N5) yang tersinkronisasi antara peta 3D, peta 2D, dan kurva prediksi +30 menit.'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {SCENARIOS.map((sc) => (
                <div
                  key={sc.id}
                  className={`rounded-lg border px-3 py-2 ${
                    selectedScenario === sc.id && selectedMode === 'legacy'
                      ? 'border-[#3B82F6]/50 bg-[#3B82F6]/10'
                      : isDark
                        ? 'border-white/5 bg-white/[0.02]'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  <strong className={`block text-[11px] ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {en ? sc.labelEn : sc.labelId}
                  </strong>
                  <span className="text-[11px] opacity-80">{en ? sc.descriptionEn : sc.descriptionId}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(error || episodeError) && (
          <div
            role="alert"
            className={`rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs ${
              isDark ? 'text-rose-300' : 'text-rose-700'
            }`}
          >
            {error || episodeError}
          </div>
        )}
      </section>

      {/* 2 CLEAN TOP-LEVEL SIMULATION TABS (VISUALISASI PETA 3D/2D & GRAFIK PREDIKSI +30M) */}
      <div
        id="simulation-subtabs"
        role="tablist"
        aria-label={en ? 'Simulation tabs' : 'Tab tampilan simulasi'}
        className={`grid grid-cols-2 gap-1.5 sm:gap-2 p-1.5 rounded-2xl border ${
          isDark ? 'bg-[#0D0D0F] border-white/10' : 'bg-white border-slate-200 shadow-sm'
        }`}
      >
        <button
          id="btn-sim-tab-map"
          type="button"
          role="tab"
          aria-selected={simTab === 'map'}
          onClick={() => setSimTab('map')}
          className={`flex items-center justify-center sm:justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            simTab === 'map'
              ? 'bg-[#3B82F6] text-black shadow-sm'
              : isDark
                ? 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <MapIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">{en ? 'Map Visualization (3D / 2D)' : 'Visualisasi Peta (3D / 2D)'}</span>
          </span>
          <span
            className={`hidden md:inline-flex font-mono text-[10px] font-bold px-2 py-0.5 rounded-md uppercase shrink-0 ${
              simTab === 'map' ? 'bg-black/15 text-black' : isDark ? 'bg-white/[0.05] text-sky-400' : 'bg-slate-100 text-sky-700'
            }`}
          >
            {mapLayer === 'map3d' ? (en ? '3D Mode' : 'Mode 3D') : (en ? '2D Mode' : 'Mode 2D')}
          </span>
        </button>

        <button
          id="btn-sim-tab-graph"
          type="button"
          role="tab"
          aria-selected={simTab === 'graph'}
          onClick={() => setSimTab('graph')}
          className={`flex items-center justify-center sm:justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            simTab === 'graph'
              ? 'bg-[#3B82F6] text-black shadow-sm'
              : isDark
                ? 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <LineChartIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">{en ? 'Forecast Graph (+30m)' : 'Grafik Prediksi (+30m)'}</span>
          </span>
          <span
            className={`hidden md:inline-flex font-mono text-[10px] font-bold px-2 py-0.5 rounded-md tabular-nums shrink-0 ${
              simTab === 'graph' ? 'bg-black/15 text-black' : isDark ? 'bg-white/[0.05] text-violet-400' : 'bg-slate-100 text-violet-700'
            }`}
          >
            {currentNode ? `${currentNode.id} · ${Number.isFinite(currentNode.tmaCm) ? currentNode.tmaCm.toFixed(1) : '—'} cm` : graphNodeId}
          </span>
        </button>
      </div>

      {/* MAIN VIEWPORT-FITTED CONTENT GRID (2FR VIEWER + 1FR 9-NODE LIST) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(270px,1fr)] gap-4 lg:gap-5 items-stretch">
        <div className="min-w-0 flex flex-col">
          {/* TAB 1: MAP VISUALIZATION (WITH INLINE 3D / 2D LAYER SWITCH) */}
          {simTab === 'map' && (
            <section
              className={`${isDark ? 'bg-[#0D0D0F] border-white/5' : 'bg-white border-slate-200 shadow-sm'} rounded-2xl border p-3.5 lg:p-4 flex flex-1 flex-col gap-3`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="min-w-0">
                  <span className={`block text-[10px] font-mono uppercase tracking-[0.14em] font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {mapLayer === 'map3d'
                      ? en
                        ? 'Ciliwung 3D Flood Explorer (UP1 Puncak → Java Sea)'
                        : 'Visualisasi 3D DAS Ciliwung (UP1 Puncak → Laut Jawa)'
                      : en
                        ? 'Ciliwung 2D Corridor Map (9 Monitoring Nodes)'
                        : 'Peta Koridor 2D DAS Ciliwung (9 Stasiun Pantau)'}
                  </span>
                  <span className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {selectedMode === 'legacy'
                      ? (en ? selectedProfile.labelEn : selectedProfile.labelId)
                      : en
                        ? 'Synthetic Replay'
                        : 'Replay Sintetis'}{' '}
                    · {state?.runId ? `run ${state.runId.slice(0, 8)}` : (en ? 'idle' : 'standby')}
                  </span>
                </div>

                {/* Compact Inline 3D | 2D Switcher */}
                <div
                  role="group"
                  aria-label={en ? 'Map projection' : 'Tampilan peta'}
                  className={`inline-flex p-0.5 rounded-lg border text-[11px] font-mono font-bold shrink-0 ${
                    isDark ? 'border-white/10 bg-black/40' : 'border-slate-200 bg-slate-100'
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={mapLayer === 'map3d'}
                    onClick={() => setMapLayer('map3d')}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                      mapLayer === 'map3d'
                        ? 'bg-[#3B82F6] text-black'
                        : isDark
                          ? 'text-slate-400 hover:text-white'
                          : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {en ? '3D View' : 'Peta 3D'}
                  </button>
                  <button
                    type="button"
                    aria-pressed={mapLayer === 'map2d'}
                    onClick={() => setMapLayer('map2d')}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                      mapLayer === 'map2d'
                        ? 'bg-[#3B82F6] text-black'
                        : isDark
                          ? 'text-slate-400 hover:text-white'
                          : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {en ? '2D Map' : 'Peta 2D'}
                  </button>
                </div>
              </div>

              {mapLayer === 'map3d' ? (
                <div
                  className={`relative flex-1 w-full overflow-hidden rounded-xl border ${
                    isDark ? 'border-white/10 bg-[#101916]' : 'border-slate-200 bg-[#b9d2d5]'
                  }`}
                >
                  <CiliwungOfficial3DView
                    mode="simulation"
                    nodes={state?.threeDNodes ?? []}
                    selectedNodeId={graphNodeId}
                    onSelectNode={setGraphNodeId}
                    isLive={isRunning || state?.status === 'completed'}
                    simTimeSeconds={state?.simTimeSeconds ?? 0}
                    theme={theme}
                    language={language}
                    heightClassName="h-[clamp(400px,56vh,560px)] lg:h-full lg:min-h-[510px]"
                  />
                </div>
              ) : (
                <div className="relative flex-1 min-h-[420px] lg:min-h-[510px] flex flex-col">
                  <Map2D
                    compact
                    fillHeight
                    simulation
                    extraNodes={SIMULATION_UPSTREAM}
                    fallbackLevel={null}
                    config={{}}
                    snapshot={map2dSnapshot}
                    language={language}
                  />
                </div>
              )}
            </section>
          )}

          {/* TAB 2: FORECAST GRAPH (+30M) */}
          {simTab === 'graph' && (
            <section className={`${isDark ? 'bg-[#0D0D0F] border-white/5' : 'bg-white border-slate-200 shadow-sm'} rounded-2xl border p-4 sm:p-5 lg:p-6 flex flex-1 flex-col justify-between`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold text-blue-400">
                    {en ? 'WATER LEVEL FORECAST (+30 MIN)' : 'PREDIKSI TINGGI AIR (+30 MENIT)'}
                  </p>
                  <h2 className={`mt-1 text-xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {currentNode ? `${currentNode.id} · ${currentNode.name}` : en ? 'Waiting for node' : 'Menunggu node'}
                  </h2>
                  <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {isReplay
                      ? en
                        ? 'Synthetic replay forecast'
                        : 'Prediksi replay sintetis'
                      : selectedMode === 'legacy'
                        ? `${en ? 'Routing simulation' : 'Simulasi propagasi'} · ${en ? selectedProfile.labelEn : selectedProfile.labelId}`
                        : en
                          ? 'Synthetic replay'
                          : 'Replay sintetis'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-lg px-3 py-1.5 text-xs font-mono font-bold tabular-nums ${
                      isDark ? 'bg-white/[0.04] border border-white/10 text-slate-200' : 'bg-slate-100 border border-slate-200 text-slate-800'
                    }`}
                  >
                    {en ? 'Now' : 'Saat ini'}: {currentLevel !== null ? `${currentLevel.toFixed(1)} cm` : '—'}
                  </span>
                  <span
                    className={`rounded-lg px-3 py-1.5 text-xs font-mono font-bold tabular-nums ${
                      isDark ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300' : 'bg-blue-50 border border-blue-200 text-blue-700'
                    }`}
                  >
                    {prediction.length && Math.abs(prediction[prediction.length - 1].afterSeconds - 1800) < 0.001
                      ? `${en ? 'Est.' : 'Estimasi'} +30m · ${prediction[prediction.length - 1].tmaCm.toFixed(1)} cm`
                      : '+30m · — cm'}
                  </span>
                </div>
              </div>

              {graphLevels.length ? (
                <div
                  className="mt-5 flex flex-1 flex-col justify-center"
                  role="img"
                  aria-label={`${en ? 'Water level forecast' : 'Grafik prediksi tinggi air'} ${currentNode?.name ?? ''}`}
                >
                  <div className="flex gap-3">
                    <div
                      aria-hidden="true"
                      className="flex h-56 sm:h-72 flex-col justify-between py-2 text-right text-xs font-mono text-slate-500"
                    >
                      {[4, 3, 2, 1, 0].map((step) => (
                        <span key={step}>{(graphMax * step) / 4}</span>
                      ))}
                    </div>
                    <svg viewBox="0 0 720 200" className="min-w-0 flex-1 h-56 sm:h-72" preserveAspectRatio="none" aria-hidden="true">
                      <defs>
                        <linearGradient id="simulation-graph-area" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity=".15" />
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[10, 55, 100, 145, 190].map((y) => (
                        <line key={y} x1="8" y1={y} x2="712" y2={y} stroke="currentColor" strokeDasharray="3 3" opacity=".18" />
                      ))}
                      {[8, 184, 360, 536, 712].map((x) => (
                        <line key={x} x1={x} y1="10" x2={x} y2="190" stroke="currentColor" strokeDasharray="3 3" opacity=".18" />
                      ))}
                      {currentHistory.length > 1 && (
                        <>
                          <Curve
                            type="monotoneX"
                            points={livePoints}
                            baseLine={190}
                            fill="url(#simulation-graph-area)"
                            stroke="none"
                          />
                          <Curve
                            data-testid="current-tma-trace"
                            type="monotoneX"
                            points={livePoints}
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="2"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        </>
                      )}
                      {currentLevel !== null && <circle data-testid="current-tma-point" cx="360" cy={graphY(currentLevel)} r="4" fill="#3B82F6" />}
                      {predictedPoints.length > 0 && (
                        <Curve
                          data-testid="forecast-tma-trace"
                          type="monotoneX"
                          points={predictedPoints}
                          fill="none"
                          stroke="#a78bfa"
                          strokeWidth="2.5"
                          strokeDasharray="1 7"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                      {prediction.length > 0 && (
                        <circle
                          cx={360 + (prediction[prediction.length - 1].afterSeconds * 352) / 1800}
                          cy={graphY(prediction[prediction.length - 1].tmaCm)}
                          r="3"
                          fill="#a78bfa"
                        />
                      )}
                    </svg>
                  </div>
                  <div className="ml-9 flex justify-between gap-2 text-xs font-mono text-slate-500">
                    <span>−30 {en ? 'min' : 'menit'}</span>
                    <span>
                      {en ? 'Now' : 'Saat ini'} · {formatTime(currentTime)}
                    </span>
                    <span>+30 {en ? 'min' : 'menit'}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>
                      <span className="text-blue-400">━━</span> {en ? 'Simulation state' : 'Kondisi simulasi'}
                    </span>
                    <span>
                      <span className="text-violet-400">┄┄</span> {en ? 'Forecast' : 'Prediksi'}
                    </span>
                    <span>{en ? 'Simulation time (mm:ss)' : 'Waktu simulasi (mm:ss)'}</span>
                  </div>
                </div>
              ) : (
                <div
                  role="status"
                  className={`mt-5 flex flex-1 min-h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center text-sm ${
                    isDark ? 'border-white/10 bg-black/20 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  <span>{en ? 'Start the simulation to see the +30m forecast graph.' : 'Mulai simulasi untuk melihat grafik prediksi +30 menit.'}</span>
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={busy || isRunning || (selectedMode === 'rain_replay' && !selectedEpisodeId)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#3B82F6] hover:bg-blue-400 text-black text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{en ? 'Start Simulation Now' : 'Mulai Simulasi Sekarang'}</span>
                  </button>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-1">
                {currentLevel !== null && prediction.length === 0 && (
                  <p role="status" className="text-xs text-amber-500">
                    {isReplay
                      ? !isRunning
                        ? en
                          ? 'Replay is not running; forecast unavailable.'
                          : 'Replay berhenti; prediksi tidak tersedia.'
                        : selectedForecast?.reason
                          ? `${en ? 'Forecast unavailable' : 'Prediksi tidak tersedia'}: ${selectedForecast.reason}`
                          : en
                            ? 'Waiting for the current forecast…'
                            : 'Menunggu prediksi untuk kondisi saat ini…'
                      : !isRunning
                        ? en
                          ? 'Simulation is not running.'
                          : 'Simulasi tidak berjalan.'
                        : projectionError
                          ? en
                            ? 'Scenario projection unavailable.'
                            : 'Proyeksi skenario tidak tersedia.'
                          : en
                            ? 'Calculating scenario projection…'
                            : 'Menghitung proyeksi skenario…'}
                  </p>
                )}
                {!isReplay && prediction.length > 0 && (
                  <p className="text-xs text-slate-500">
                    {en
                      ? 'Projection from the current simulation hydrological routing.'
                      : 'Proyeksi dari simulasi propagasi hidrologi saat ini.'}
                    {projectionEndsEarly &&
                      ` ${en ? 'Scenario ends at' : 'Skenario selesai pada'} +${formatTime(
                        prediction[prediction.length - 1].afterSeconds
                      )} ${en ? '(mm:ss); no later projection.' : '(mm:ss); tidak ada proyeksi setelahnya.'}`}
                  </p>
                )}
                <p className="text-[11px] text-slate-500">
                  {en
                    ? 'Synthetic demonstration for capstone hydrological routing visualization.'
                    : 'Demonstrasi sintetis untuk visualisasi propagasi banjir DAS Ciliwung.'}
                </p>
              </div>
            </section>
          )}
        </div>

        {/* COMPACT 9-NODE WATER LEVEL SELECTOR SIDEBAR */}
        <aside
          data-testid="simulation-node-levels"
          className={`${isDark ? 'bg-[#0D0D0F] border-white/5' : 'bg-white border-slate-200 shadow-sm'} rounded-2xl border p-4 flex flex-col gap-2.5`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {en ? 'Water Levels (9 Nodes)' : 'Tinggi Muka Air (9 Node)'}
              </h2>
              <p className="text-[11px] text-blue-400 mt-0.5">
                {simTab === 'map'
                  ? en
                    ? 'Click a node to focus camera'
                    : 'Klik node untuk fokus peta'
                  : en
                    ? 'Click a node to switch forecast'
                    : 'Klik node untuk ganti grafik'}
              </p>
            </div>
            <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-md ${isDark ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
              UP1 → N5
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1.5 content-start">
            {(state?.cupNodes ?? []).length ? (
              (state?.cupNodes ?? []).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={graphNodeId === node.id}
                  onClick={() => handleSelectNode(node.id)}
                  data-testid={`simulation-node-${node.id}`}
                  className={`w-full rounded-xl border px-3 py-1.5 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                    graphNodeId === node.id
                      ? isDark
                        ? 'border-blue-400 bg-blue-500/20 ring-1 ring-blue-400/50'
                        : 'border-blue-500 bg-blue-50 ring-1 ring-blue-400'
                      : isDark
                        ? 'bg-white/[0.03] border-white/10 hover:border-blue-400/50'
                        : 'bg-slate-50 border-slate-200 hover:border-blue-400/50'
                  }`}
                >
                  <span className="min-w-0">
                    <strong className={`block text-xs truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                      {node.id} · {node.name}
                    </strong>
                    <span
                      className={`text-[10px] font-mono font-semibold ${
                        node.status === 'BANJIR_JAKARTA'
                          ? 'text-rose-400'
                          : node.status === 'SIAGA'
                            ? 'text-amber-400'
                            : 'text-emerald-400/90'
                      }`}
                    >
                      {statusLabel(node.status, en)}
                    </span>
                  </span>
                  <strong className={`text-xs sm:text-sm font-mono tabular-nums whitespace-nowrap ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {Number.isFinite(node.tmaCm) ? node.tmaCm.toFixed(1) : '—'} cm
                  </strong>
                </button>
              ))
            ) : (
              <p className="text-xs opacity-70 py-4 text-center">{en ? 'Waiting for simulation data' : 'Menunggu data simulasi'}</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
