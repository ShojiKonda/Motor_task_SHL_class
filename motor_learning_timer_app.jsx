import React, { useEffect, useMemo, useRef, useState } from "react";
import {  Download,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SkipForward,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const PHASES = {
  START_HOLD: "START_HOLD",
  GO_AND_GOAL_WAIT: "GO_AND_GOAL_WAIT",
  RETURN: "RETURN",
  BLOCK_BREAK: "BLOCK_BREAK",
  READY: "READY",
  DONE: "DONE",
};

const PHASE_LABELS = {
  [PHASES.START_HOLD]: "STARTで待機",
  [PHASES.GO_AND_GOAL_WAIT]: "GO：軌跡をなぞる",
  [PHASES.RETURN]: "STARTに戻る",
  [PHASES.BLOCK_BREAK]: "ブロック間休憩",
  [PHASES.READY]: "開始待機",
  [PHASES.DONE]: "終了",
};

const DEFAULT_PROTOCOL = [
  { task: "直線", trials: 10, goSec: 5, note: "StartからGoalまで直線をなぞる。終わったらGoalで待つ" },
  { task: "S字", trials: 10, goSec: 8, note: "S字ガイドをなぞる。終わったらGoalで待つ" },
  { task: "melon プレテスト", trials: 5, goSec: 10, note: "汎化課題。練習前の性能を測る。終わったらGoalで待つ" },
  { task: "lemon 練習", trials: 40, goSec: 10, note: "主学習課題。10回ごとの変化を見る。終わったらGoalで待つ" },
  { task: "melon ポストテスト", trials: 10, goSec: 10, note: "汎化課題。lemon練習後の転移を見る。終わったらGoalで待つ" },
];

const DEFAULT_SETTINGS = {
  prepSec: 30,
  startHoldSec: 3,
  returnSec: 5,
  blockBreakSec: 20,
  sound: true,
};

function flattenProtocol(protocol, settings) {
  const events = [];

  protocol.forEach((block, blockIndex) => {
    for (let trial = 1; trial <= block.trials; trial += 1) {
      events.push({ blockIndex, trial, phase: PHASES.START_HOLD, duration: settings.startHoldSec });
      events.push({ blockIndex, trial, phase: PHASES.GO_AND_GOAL_WAIT, duration: block.goSec });
      events.push({ blockIndex, trial, phase: PHASES.RETURN, duration: settings.returnSec });
    }

    if (blockIndex < protocol.length - 1) {
      events.push({ blockIndex, trial: block.trials, phase: PHASES.BLOCK_BREAK, duration: settings.blockBreakSec });
    }
  });

  return events;
}

function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function secondsToClock(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);

  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function calculateProtocolDuration(protocol, settings) {
  return settings.prepSec + flattenProtocol(protocol, settings).reduce((sum, event) => sum + event.duration, 0);
}

export default function MotorLearningTimerApp() {
  const [protocol, setProtocol] = useState(DEFAULT_PROTOCOL);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [prepRemaining, setPrepRemaining] = useState(DEFAULT_SETTINGS.prepSec);
  const [eventIndex, setEventIndex] = useState(0);
  const [phaseRemaining, setPhaseRemaining] = useState(0);
  const [logs, setLogs] = useState([]);

  const audioRef = useRef(null);
  const intervalRef = useRef(null);
  const lastTickRef = useRef(null);

  const events = useMemo(() => flattenProtocol(protocol, settings), [protocol, settings]);
  const totalProtocolSec = useMemo(() => calculateProtocolDuration(protocol, settings), [protocol, settings]);
  const totalTrials = useMemo(() => protocol.reduce((sum, block) => sum + block.trials, 0), [protocol]);

  const elapsedBeforeEvent = useMemo(() => {
    let sum = settings.prepSec;
    return events.map((event) => {
      const before = sum;
      sum += event.duration;
      return before;
    });
  }, [events, settings.prepSec]);

  const currentEvent = events[eventIndex] || null;
  const currentBlock = currentEvent ? protocol[currentEvent.blockIndex] : null;
  const completed = started && eventIndex >= events.length;
  const inPrep = started && prepRemaining > 0 && !completed;
  const currentPhase = completed ? PHASES.DONE : inPrep ? PHASES.READY : currentEvent?.phase || PHASES.READY;
  const currentPhaseLabel = inPrep ? "準備時間：センサ記録・姿勢確認" : PHASE_LABELS[currentPhase];
  const currentTrial = currentEvent?.trial || 0;
  const blockTrials = currentBlock?.trials || 0;
  const hideCountdown = currentPhase === PHASES.GO_AND_GOAL_WAIT || currentPhase === PHASES.RETURN;

  const completedTrials = useMemo(() => {
    if (!started) return 0;
    let count = 0;
    for (let i = 0; i < Math.min(eventIndex, events.length); i += 1) {
      if (events[i].phase === PHASES.RETURN) count += 1;
    }
    return count;
  }, [eventIndex, events, started]);

  const absoluteElapsed = useMemo(() => {
    if (!started) return 0;
    if (inPrep) return settings.prepSec - prepRemaining;
    if (completed) return totalProtocolSec;

    const before = elapsedBeforeEvent[eventIndex] || settings.prepSec;
    const elapsedInPhase = (currentEvent?.duration || 0) - phaseRemaining;
    return before + elapsedInPhase;
  }, [completed, currentEvent, elapsedBeforeEvent, eventIndex, inPrep, phaseRemaining, prepRemaining, settings.prepSec, started, totalProtocolSec]);

  const progressPct = Math.min(100, totalProtocolSec > 0 ? (absoluteElapsed / totalProtocolSec) * 100 : 0);

  const phaseBg =
    currentPhase === PHASES.GO_AND_GOAL_WAIT
      ? "bg-emerald-50"
      : currentPhase === PHASES.START_HOLD
        ? "bg-amber-50"
        : currentPhase === PHASES.RETURN
          ? "bg-violet-50"
          : "bg-slate-50";

  const phaseText =
    currentPhase === PHASES.GO_AND_GOAL_WAIT
      ? "text-emerald-700"
      : currentPhase === PHASES.START_HOLD
        ? "text-amber-700"
        : currentPhase === PHASES.RETURN
          ? "text-violet-700"
          : "text-slate-700";

  useEffect(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioRef.current = new AudioContextClass();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      audioRef.current?.close?.();
    };
  }, []);

  function beep(type = "normal") {
    if (!settings.sound || !audioRef.current) return;

    const ctx = audioRef.current;
    if (ctx.state === "suspended") ctx.resume?.();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const freq = type === "go" ? 880 : type === "done" ? 660 : type === "warn" ? 440 : 520;
    const duration = type === "done" ? 0.55 : 0.22;

    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration - 0.02);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function makeLog(kind, event = currentEvent, elapsedOverride = absoluteElapsed) {
    const block = event ? protocol[event.blockIndex] : null;
    return {
      timestamp_iso: new Date().toISOString(),
      elapsed_sec: elapsedOverride.toFixed(3),
      event: kind,
      task: block?.task || "",
      block_index: event ? event.blockIndex + 1 : "",
      trial: event?.trial || "",
      phase: event?.phase || currentPhase,
    };
  }

  function addLog(kind, event = currentEvent, elapsedOverride = absoluteElapsed) {
    setLogs((prev) => [...prev, makeLog(kind, event, elapsedOverride)]);
  }

  function initializeSession() {
    setStarted(true);
    setRunning(true);
    setPrepRemaining(settings.prepSec);
    setEventIndex(0);
    setPhaseRemaining(events[0]?.duration || 0);
    setLogs([makeLog("SESSION_START", null, 0)]);
    beep("go");
  }

  function resetSession() {
    setStarted(false);
    setRunning(false);
    setPrepRemaining(settings.prepSec);
    setEventIndex(0);
    setPhaseRemaining(events[0]?.duration || 0);
    setLogs([]);
    lastTickRef.current = null;
  }

  function advancePhase(skipped = false) {
    if (inPrep) {
      setPrepRemaining(0);
      setPhaseRemaining(events[0]?.duration || 0);
      addLog(skipped ? "PREP_SKIPPED" : "PREP_END", null);
      beep("normal");
      return;
    }

    const event = events[eventIndex];
    if (!event) return;

    addLog(skipped ? "PHASE_SKIPPED" : "PHASE_END", event);

    const nextIndex = eventIndex + 1;
    if (nextIndex >= events.length) {
      setEventIndex(nextIndex);
      setRunning(false);
      addLog("SESSION_DONE", event);
      beep("done");
      return;
    }

    const nextEvent = events[nextIndex];
    setEventIndex(nextIndex);
    setPhaseRemaining(nextEvent.duration);
    setTimeout(() => addLog("PHASE_START", nextEvent), 0);

    if (nextEvent.phase === PHASES.GO_AND_GOAL_WAIT) beep("go");
    else if (nextEvent.phase === PHASES.RETURN) beep("warn");
    else beep("normal");
  }

  function skipPhase() {
    if (!started || completed) return;
    advancePhase(true);
  }

  useEffect(() => {
    if (!running || !started) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      lastTickRef.current = null;
      return undefined;
    }

    lastTickRef.current = performance.now();
    intervalRef.current = setInterval(() => {
      const now = performance.now();
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      if (prepRemaining > 0) {
        setPrepRemaining((prev) => {
          const next = prev - delta;
          if (next <= 0) {
            setTimeout(() => advancePhase(false), 0);
            return 0;
          }
          if (Math.ceil(next) !== Math.ceil(prev) && Math.ceil(next) <= 3) beep("normal");
          return next;
        });
      } else {
        setPhaseRemaining((prev) => {
          const next = prev - delta;
          if (next <= 0) {
            setTimeout(() => advancePhase(false), 0);
            return 0;
          }
          if (Math.ceil(next) !== Math.ceil(prev) && Math.ceil(next) <= 3 && currentPhase === PHASES.START_HOLD) {
            beep("normal");
          }
          return next;
        });
      }
    }, 100);

    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, started, prepRemaining, currentPhase, eventIndex, phaseRemaining]);

  function updateProtocol(index, key, value) {
    setProtocol((prev) =>
      prev.map((block, i) => {
        if (i !== index) return block;
        const nextValue = key === "task" || key === "note" ? value : Number(value);
        return { ...block, [key]: nextValue };
      })
    );
  }

  function downloadCsv() {
    const header = ["timestamp_iso", "elapsed_sec", "event", "task", "block_index", "trial", "phase"]; 
    const rows = logs.map((row) => header.map((field) => csvEscape(row[field])).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `motor_learning_timer_log_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  return (
    <div className={`min-h-screen ${phaseBg} text-slate-900 p-4 md:p-8 transition-colors duration-300`}>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-4xl">運動学習課題</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            {!started ? (
              <Button onClick={initializeSession} className="rounded-2xl px-5 py-5 text-base">
                <Play className="mr-2 h-5 w-5" />開始
              </Button>
            ) : (
              <Button onClick={() => setRunning((value) => !value)} className="rounded-2xl px-5 py-5 text-base">
                {running ? <Pause className="mr-2 h-5 w-5" /> : <Play className="mr-2 h-5 w-5" />}
                {running ? "一時停止" : "再開"}
              </Button>
            )}
            <Button variant="outline" onClick={skipPhase} className="rounded-2xl">
              <SkipForward className="mr-2 h-4 w-4" />スキップ
            </Button>
            <Button variant="outline" onClick={resetSession} className="rounded-2xl">
              <RotateCcw className="mr-2 h-4 w-4" />リセット
            </Button>
            <Button variant="outline" onClick={downloadCsv} className="rounded-2xl">
              <Download className="mr-2 h-4 w-4" />CSV
            </Button>
            <Button variant="outline" onClick={toggleFullscreen} className="rounded-2xl">
              <Maximize2 className="mr-2 h-4 w-4" />全画面
            </Button>
            <Button variant="outline" onClick={() => setShowSettings((value) => !value)} className="rounded-2xl">
              <Settings className="mr-2 h-4 w-4" />設定
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="border-0 shadow-lg rounded-3xl lg:col-span-2">
            <CardContent className="p-6 text-center md:p-10">
              <div className="mb-4 flex justify-center gap-2 text-sm text-slate-500">
                <span>経過 {secondsToClock(absoluteElapsed)}</span>
                <span>/</span>
                <span>全体 {secondsToClock(totalProtocolSec)}</span>
              </div>

              <div className="flex h-48 flex-col items-center justify-center md:h-64">
                <div className={`text-4xl font-black leading-tight md:text-7xl ${phaseText}`}>{currentPhaseLabel}</div>
                <div className="mt-4 flex h-10 items-center justify-center md:h-12">
                  {currentPhase === PHASES.GO_AND_GOAL_WAIT && (
                    <div className="text-2xl font-bold text-slate-700 md:text-3xl">ゴール後は停止して待機</div>
                  )}
                </div>
                <div className="mt-4 flex h-24 items-center justify-center md:h-32">
                  {!hideCountdown && (
                    <div className="text-7xl font-black tabular-nums md:text-9xl">
                      {formatTime(inPrep ? prepRemaining : phaseRemaining)}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-8 grid grid-cols-2 gap-3 text-left md:grid-cols-4">
                <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                  <div className="text-xs text-slate-500">現在ブロック</div>
                  <div className="text-xl font-bold">{currentBlock ? `${currentEvent.blockIndex + 1}/${protocol.length}` : "-"}</div>
                </div>
                <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                  <div className="text-xs text-slate-500">課題</div>
                  <div className="text-xl font-bold">{currentBlock?.task || "-"}</div>
                </div>
                <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                  <div className="text-xs text-slate-500">試行</div>
                  <div className="text-xl font-bold">{currentTrial ? `${currentTrial}/${blockTrials}` : "-"}</div>
                </div>
                <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                  <div className="text-xs text-slate-500">全試行</div>
                  <div className="text-xl font-bold">{completedTrials}/{totalTrials}</div>
                </div>
              </div>

              <div className="mt-8 h-4 w-full overflow-hidden rounded-full bg-white/80 shadow-inner">
                <div className="h-full bg-slate-900 transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg rounded-3xl">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">プロトコル</h2>
                <div className="flex items-center text-sm text-slate-500">
                  <Volume2 className="mr-1 h-4 w-4" />{settings.sound ? "音あり" : "音なし"}
                </div>
              </div>

              <div className="space-y-2">
                {protocol.map((block, index) => {
                  const active = currentEvent?.blockIndex === index && !inPrep && !completed;
                  const sec = block.trials * (settings.startHoldSec + block.goSec + settings.returnSec);
                  return (
                    <div
                      key={`${block.task}-${index}`}
                      className={`rounded-2xl border p-3 ${active ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-white/70"}`}
                    >
                      <div className="flex justify-between gap-2">
                        <div className="font-bold">{index + 1}. {block.task}</div>
                        <div className="text-sm tabular-nums text-slate-500">{block.trials}回 / {secondsToClock(sec)}</div>
                      </div>
                      <div className="mt-1 text-sm text-slate-600">GO枠 {block.goSec}秒：{block.note}</div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">
                <div className="mb-1 font-bold">1試行の構造</div>
                <div>START待機 {settings.startHoldSec}秒 → GO枠は直線5秒・S字8秒・文字10秒、終わったらGoalで待機 → STARTに戻る {settings.returnSec}秒、カウントなし → 次のSTART待機</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {showSettings && (
          <Card className="border-0 shadow-lg rounded-3xl">
            <CardContent className="space-y-5 p-5">
              <h2 className="text-xl font-bold">設定</h2>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ["prepSec", "準備時間 秒"],
                  ["startHoldSec", "Start待機 秒"],
                  ["returnSec", "Startへ戻る 秒"],
                  ["blockBreakSec", "ブロック休憩 秒"],
                ].map(([key, label]) => (
                  <label key={key} className="text-sm font-medium text-slate-700">
                    {label}
                    <input
                      type="number"
                      min="0"
                      value={settings[key]}
                      onChange={(event) => setSettings((prev) => ({ ...prev, [key]: Number(event.target.value) }))}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                      disabled={started}
                    />
                  </label>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.sound}
                  onChange={(event) => setSettings((prev) => ({ ...prev, sound: event.target.checked }))}
                />
                音を出す
              </label>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left">                      <th>課題</th>
                      <th>回数</th>
                      <th>GO枠 秒</th>
                      <th>メモ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {protocol.map((block, index) => (
                      <tr key={`${block.task}-settings-${index}`} className="border-b">                        <td>
                          <input
                            value={block.task}
                            onChange={(event) => updateProtocol(index, "task", event.target.value)}
                            className="w-40 rounded-lg border px-2 py-1"
                            disabled={started}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={block.trials}
                            onChange={(event) => updateProtocol(index, "trials", event.target.value)}
                            className="w-20 rounded-lg border px-2 py-1"
                            disabled={started}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={block.goSec}
                            onChange={(event) => updateProtocol(index, "goSec", event.target.value)}
                            className="w-20 rounded-lg border px-2 py-1"
                            disabled={started}
                          />
                        </td>
                        <td>
                          <input
                            value={block.note}
                            onChange={(event) => updateProtocol(index, "note", event.target.value)}
                            className="w-full rounded-lg border px-2 py-1"
                            disabled={started}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-slate-500">設定変更はセッション開始前のみ反映されます。開始後に変更したい場合はリセットしてください。</div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
