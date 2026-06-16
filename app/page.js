"use client";

import { useEffect, useMemo, useState } from "react";

const PREDICT_API_URL = "http://127.0.0.1:8000/predict";
const YOUTUBE_API_URL = "http://127.0.0.1:8000/analyze-youtube";
const MAX_TEXT_LENGTH = 20000;
const MAX_YOUTUBE_URL_LENGTH = 2048;
const MAX_METADATA_VALUE = 1000000000000;
const WORD_CLOUD_THRESHOLD = 25;
const WORD_CLOUD_COLORS = ["#0f766e", "#0284c7", "#0891b2", "#f97316", "#0f172a"];
const YOUTUBE_PROGRESS_STAGES = [
  {
    label: "Checking the YouTube link",
    detail: "Validating the URL format before we call the backend.",
    progress: 12,
  },
  {
    label: "Fetching video details",
    detail: "Loading the title, description, thumbnail, and numeric metadata.",
    progress: 28,
  },
  {
    label: "Collecting top comments",
    detail: "Taking the top 20 comments that will be included in the analysis text.",
    progress: 46,
  },
  {
    label: "Loading transcript",
    detail: "Trying to fetch the video transcript if it is available.",
    progress: 64,
  },
  {
    label: "Building analysis text",
    detail: "Concatenating title, description, tags, transcript, and comments.",
    progress: 82,
  },
  {
    label: "Running the ML model",
    detail: "Sending the combined text and metadata into the inference engine.",
    progress: 90,
  },
  {
    label: "Generating AI summary",
    detail: "Membuat ringkasan singkat dengan Gemini tanpa memengaruhi hasil prediksi.",
    progress: 98,
  },
];

const metadataFields = [
  { key: "likes", label: "Likes Count", placeholder: "1200" },
  { key: "dislikes", label: "Dislikes Count", placeholder: "40" },
  { key: "views", label: "View Count", placeholder: "25000" },
  { key: "comments", label: "Total Comments", placeholder: "315" },
  { key: "duration", label: "Video Duration", placeholder: "540" },
];

const initialMetadata = metadataFields.reduce((accumulator, field) => {
  accumulator[field.key] = "";
  return accumulator;
}, {});

const uiPhases = [
  { key: "idle", label: "Start" },
  { key: "input", label: "Input" },
  { key: "processing", label: "Process" },
  { key: "result", label: "Explore" },
];

const phaseCopy = {
  idle: {
    title: "Youtube Moderation",
    description: "Start with a YouTube link or paste content with its metadata.",
  },
  input: {
    title: "Prepare the source",
    description: "Keep the focus on the content source before running the model.",
  },
  processing: {
    title: "Analysis in progress",
    description: "The request is running through the backend and model pipeline.",
  },
  result: {
    title: "Result exploration",
    description: "The main prediction stays first, with context and analytics tucked below.",
  },
};

const verdictStyles = {
  safe: {
    label: "Safe",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    accent: "bg-emerald-500",
    panel: "border-emerald-200 bg-emerald-50",
    text: "text-emerald-700",
    summary:
      "Safe score is clearly dominant, so this result is treated as safely passed.",
  },
  unsafe: {
    label: "Unsafe",
    badge: "border-red-200 bg-red-50 text-red-700",
    accent: "bg-red-500",
    panel: "border-red-200 bg-red-50",
    text: "text-red-700",
    summary: "Unsafe score is higher than Safe, so this result should be blocked.",
  },
};

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function isYoutubeHost(host) {
  return [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
  ].includes(host);
}

function extractYoutubeVideoId(value) {
  const candidate = value.trim();
  const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

  if (videoIdPattern.test(candidate)) {
    return candidate;
  }

  const parseTarget = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  let parsedUrl;
  try {
    parsedUrl = new URL(parseTarget);
  } catch {
    return "";
  }

  const host = parsedUrl.hostname.toLowerCase();
  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
  let videoId = "";

  if (["youtu.be", "www.youtu.be"].includes(host) && pathParts.length > 0) {
    videoId = pathParts[0];
  } else if (isYoutubeHost(host)) {
    if (parsedUrl.pathname === "/watch") {
      videoId = parsedUrl.searchParams.get("v") || "";
    } else if (
      pathParts.length > 1 &&
      ["embed", "shorts", "live", "v"].includes(pathParts[0])
    ) {
      videoId = pathParts[1];
    }
  }

  return videoIdPattern.test(videoId) ? videoId : "";
}

function validateYoutubeUrl(value) {
  const candidate = value.trim();

  if (!candidate) {
    return "Link YouTube wajib diisi.";
  }

  if (candidate.length > MAX_YOUTUBE_URL_LENGTH) {
    return "Link YouTube terlalu panjang.";
  }

  if (!extractYoutubeVideoId(candidate)) {
    return "Masukkan link YouTube yang valid, misalnya https://www.youtube.com/watch?v=VIDEO_ID.";
  }

  return "";
}

function validateManualInput(text, metadata) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return "Text manual wajib diisi.";
  }

  if (trimmedText.length > MAX_TEXT_LENGTH) {
    return `Text manual maksimal ${formatNumber(MAX_TEXT_LENGTH)} karakter.`;
  }

  for (const field of metadataFields) {
    const rawValue = String(metadata[field.key] ?? "").trim();

    if (!rawValue) {
      continue;
    }

    if (!/^\d+$/.test(rawValue)) {
      return `${field.label} harus berupa angka bulat positif.`;
    }

    const numericValue = Number(rawValue);
    if (!Number.isSafeInteger(numericValue) || numericValue > MAX_METADATA_VALUE) {
      return `${field.label} terlalu besar.`;
    }
  }

  return "";
}

function normalizeMetadataInput(value) {
  const nextValue = String(value ?? "").trim();

  if (!nextValue) {
    return "";
  }

  return /^\d+$/.test(nextValue) ? nextValue : null;
}

function toMetadataArray(metadata) {
  return metadataFields.map((field) => {
    const value = metadata[field.key];
    if (value === "" || value === null || value === undefined) {
      return 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function clampProbability(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numericValue));
}

function formatPercent(value) {
  return `${(clampProbability(value) * 100).toFixed(1)}%`;
}

function formatNumber(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US").format(numericValue);
}

function formatDuration(totalSeconds) {
  const numericValue = Number(totalSeconds);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "0s";
  }

  const roundedValue = Math.floor(numericValue);
  const hours = Math.floor(roundedValue / 3600);
  const minutes = Math.floor((roundedValue % 3600) / 60);
  const seconds = roundedValue % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getMetadataDisplay(fieldKey, value) {
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;

  if (fieldKey === "duration") {
    return {
      primary: formatDuration(safeValue),
      secondary: `${formatNumber(safeValue)} sec`,
    };
  }

  if (fieldKey === "dislikes") {
    return {
      primary: formatNumber(safeValue),
      secondary: "Unavailable from YouTube API",
    };
  }

  return {
    primary: formatNumber(safeValue),
    secondary: "",
  };
}

function getProbabilityPair(result) {
  const probabilities = Array.isArray(result?.probabilities)
    ? result.probabilities.map(clampProbability)
    : [];

  if (probabilities.length >= 2) {
    return [probabilities[0], probabilities[1]];
  }

  const predictedLabel = Number(result?.label ?? 0);
  const confidence = clampProbability(result?.confidence ?? 0);

  if (predictedLabel === 1) {
    return [1 - confidence, confidence];
  }

  return [confidence, 1 - confidence];
}

function getResultViewModel(result) {
  if (!result) {
    return null;
  }

  const predictedLabel = Number(result.label ?? 0);
  const confidence = clampProbability(result.confidence ?? 0);
  const [label0Probability, label1Probability] = getProbabilityPair(result);
  const margin = Math.abs(label1Probability - label0Probability);

  const verdictKey = label1Probability > label0Probability ? "unsafe" : "safe";

  return {
    predictedLabel,
    confidence,
    confidencePercent: formatPercent(confidence),
    label0Probability,
    label1Probability,
    label0Percent: formatPercent(label0Probability),
    label1Percent: formatPercent(label1Probability),
    marginPercent: formatPercent(margin),
    verdict: verdictStyles[verdictKey],
  };
}

function extractWords(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/gi) || []).map((word) =>
    word.toLowerCase()
  );
}

function buildWordCloudState(text) {
  const rawWords = extractWords(text);

  if (rawWords.length < WORD_CLOUD_THRESHOLD) {
    return {
      wordCount: rawWords.length,
      data: [],
    };
  }

  const frequencyMap = new Map();

  rawWords.forEach((word) => {
    frequencyMap.set(word, (frequencyMap.get(word) || 0) + 1);
  });

  const data = Array.from(frequencyMap.entries())
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .slice(0, 30)
    .map(([word, value]) => ({
      text: word,
      value,
    }));

  return {
    wordCount: rawWords.length,
    data,
  };
}

function getWordCloudWordStyle(word, index, maxValue, minValue) {
  const range = Math.max(maxValue - minValue, 1);
  const intensity = (word.value - minValue) / range;

  return {
    fontSize: `${18 + intensity * 28}px`,
    lineHeight: 1,
    fontWeight: 500 + Math.round(intensity * 300),
    color: WORD_CLOUD_COLORS[index % WORD_CLOUD_COLORS.length],
    opacity: 0.72 + intensity * 0.28,
    transform: `rotate(${((index % 5) - 2) * 4}deg)`,
  };
}

function getUiPhase({ isLoading, resultView, hasInput }) {
  if (isLoading) {
    return "processing";
  }

  if (resultView) {
    return "result";
  }

  if (hasInput) {
    return "input";
  }

  return "idle";
}

function Surface({ children, className = "" }) {
  return (
    <section
      className={cx(
        "rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_18px_55px_-42px_rgba(15,23,42,0.35)] transition-all duration-300",
        className
      )}
    >
      {children}
    </section>
  );
}

function TextLabel({ children, className = "" }) {
  return (
    <p className={cx("text-xs font-semibold uppercase text-slate-500", className)}>
      {children}
    </p>
  );
}

function StatusPill({ children, className = "" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm",
        className
      )}
    >
      {children}
    </span>
  );
}

function SecondaryButton({ children, className = "", disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        className
      )}
    >
      {children}
    </button>
  );
}

function LoadingSpinner({ className = "" }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900",
        className
      )}
      aria-hidden="true"
    />
  );
}

function PhaseHeader({ phase }) {
  const activeIndex = uiPhases.findIndex((item) => item.key === phase);
  const copy = phaseCopy[phase] ?? phaseCopy.idle;

  return (
    <header className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_50px_-42px_rgba(15,23,42,0.35)] sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="max-w-2xl">
        <TextLabel>Guided AI review</TextLabel>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">
          {copy.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{copy.description}</p>
      </div>

      <ol className="grid grid-cols-4 gap-2 sm:min-w-[420px]">
        {uiPhases.map((item, index) => {
          const isActive = item.key === phase;
          const isComplete = index < activeIndex;

          return (
            <li key={item.key}>
              <div
                className={cx(
                  "flex min-h-16 flex-col justify-between rounded-xl border px-3 py-3 text-xs transition-colors duration-200",
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : isComplete
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                )}
              >
                <span className="font-semibold">{index + 1}</span>
                <span>{item.label}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </header>
  );
}

function ModeButton({ active, label, caption, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex min-h-20 flex-1 flex-col justify-center rounded-xl border px-4 py-3 text-left transition-all duration-200",
        active
          ? "border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-950/10"
          : "border-transparent bg-transparent text-slate-700 hover:bg-white hover:shadow-sm",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className={cx("mt-1 text-xs leading-5", active ? "text-slate-300" : "text-slate-500")}>
        {caption}
      </span>
    </button>
  );
}

function FieldShell({ children, className = "" }) {
  return (
    <div className={cx("rounded-xl border border-slate-200 bg-slate-50 p-4", className)}>
      {children}
    </div>
  );
}

function ParentGuideDropdown() {
  const guideSteps = [
    "Buka video YouTube yang ingin diperiksa, lalu salin link dari tombol Bagikan.",
    "Tempel link video ke kolom YouTube URL di atas.",
    "Tekan Analyze YouTube Video dan tunggu sampai proses selesai.",
    "Baca hasilnya: Safe berarti relatif aman dan Unsafe sebaiknya tidak diberikan ke anak. Periksa juga nilai Confidence margin untuk melihat seberapa tipis selisih probabilitasnya.",
    "Gunakan ringkasan dan konteks video sebagai bahan pendampingan sebelum anak menonton.",
  ];

  return (
    <details open className="group mt-4 border-t border-slate-200 pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-1 py-1 text-sm font-semibold text-slate-800 outline-none transition-colors duration-200 hover:text-slate-950 focus-visible:ring-4 focus-visible:ring-sky-100 [&::-webkit-details-marker]:hidden">
        <span>Bagaimana cara menggunakannya?</span>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg leading-none text-slate-700 transition-all duration-200 group-open:rotate-45 group-open:border-slate-950 group-open:bg-slate-950 group-open:text-white"
          aria-hidden="true"
        >
          +
        </span>
      </summary>
      <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
        {guideSteps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function InputSection({
  url,
  isLoading,
  error,
  hasSession,
  onUrlChange,
  onAnalyze,
  onReset,
}) {
  const inputClassName =
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition duration-200 placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

  return (
    <Surface className="self-start">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <TextLabel>Input</TextLabel>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            Analyze a YouTube video
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Paste a video link and let the backend assemble the analysis text.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill>YouTube URL</StatusPill>
          {hasSession ? (
            <SecondaryButton
              disabled={isLoading}
              onClick={onReset}
              className="min-h-8 px-3 py-1 text-xs"
            >
              Mulai Baru
            </SecondaryButton>
          ) : null}
        </div>
      </div>

      <div className="mt-6 space-y-5">
        <FieldShell>
          <label
            htmlFor="youtube-url"
            className="block text-sm font-semibold text-slate-800"
          >
            YouTube URL
          </label>
          <input
            id="youtube-url"
            type="url"
            value={url}
            disabled={isLoading}
            required
            maxLength={MAX_YOUTUBE_URL_LENGTH}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className={cx(inputClassName, "mt-3")}
          />
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Title, description, tags, transcript, and top comments are combined for inference.
          </p>
          <ParentGuideDropdown />
        </FieldShell>

        <button
          type="button"
          onClick={onAnalyze}
          disabled={isLoading}
          className={cx(
            "inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all duration-200",
            isLoading
              ? "cursor-not-allowed bg-slate-400"
              : "bg-slate-950 shadow-lg shadow-slate-950/10 hover:-translate-y-0.5 hover:bg-slate-800"
          )}
        >
          {isLoading ? (
            <>
              <LoadingSpinner className="h-4 w-4 border-white/40 border-t-white" />
              Analyzing...
            </>
          ) : (
            "Analyze YouTube Video"
          )}
        </button>

        {error ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </div>
    </Surface>
  );
}

function ProcessingSection({ isYoutubeMode, currentYoutubeStage, youtubeProgressStep }) {
  return (
    <Surface className="border-sky-200 bg-white" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50">
            <LoadingSpinner className="border-sky-200 border-t-sky-600" />
          </div>
          <div>
            <TextLabel className="text-sky-700">Processing</TextLabel>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">
              {isYoutubeMode ? currentYoutubeStage.label : "Running the ML model"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {isYoutubeMode
                ? currentYoutubeStage.detail
                : "Preparing request data and waiting for the inference response."}
            </p>
          </div>
        </div>

        {isYoutubeMode ? (
          <StatusPill className="border-sky-200 text-sky-700">
            {currentYoutubeStage.progress}%
          </StatusPill>
        ) : null}
      </div>

      {isYoutubeMode ? (
        <>
          <div className="mt-6 h-3 overflow-hidden rounded-full bg-sky-100">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-700"
              style={{ width: `${currentYoutubeStage.progress}%` }}
            />
          </div>

          <div className="mt-6 grid gap-2">
            {YOUTUBE_PROGRESS_STAGES.map((stage, index) => (
              <div
                key={stage.label}
                className={cx(
                  "flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors duration-200",
                  index <= youtubeProgressStep
                    ? "border-sky-100 bg-sky-50 text-slate-700"
                    : "border-slate-200 bg-slate-50 text-slate-400"
                )}
              >
                <span
                  className={cx(
                    "h-2.5 w-2.5 rounded-full",
                    index <= youtubeProgressStep ? "bg-sky-500" : "bg-slate-300"
                  )}
                />
                <span>{stage.label}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-6 grid gap-3">
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-slate-300" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
          </div>
        </div>
      )}
    </Surface>
  );
}

function SidebarStat({ label, value, tone = "default" }) {
  return (
    <div
      className={cx(
        "rounded-xl border px-3 py-3",
        tone === "dark"
          ? "border-white/10 bg-white/10 text-white"
          : "border-slate-200 bg-slate-50 text-slate-950"
      )}
    >
      <p
        className={cx(
          "text-xs font-medium",
          tone === "dark" ? "text-slate-300" : "text-slate-500"
        )}
      >
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function SessionOverview({
  phase,
  isYoutubeMode,
  isLoading,
  resultView,
  currentYoutubeStage,
  url,
  text,
  videoInfo,
  summary,
  summaryMode,
  summaryError,
  analysisWordCount,
  canShowWordCloud,
  onReset,
}) {
  const sourceTitle = isYoutubeMode
    ? videoInfo?.title || url.trim() || "YouTube video"
    : text.trim()
      ? "Manual text"
      : "Manual input";
  const stageLabel = isLoading
    ? currentYoutubeStage.label
    : resultView
      ? resultView.verdict.label
      : "Ready";
  const stageMeta = isLoading
    ? `${currentYoutubeStage.progress}%`
    : resultView
      ? resultView.confidencePercent
      : "Waiting";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-950 shadow-[0_18px_55px_-42px_rgba(15,23,42,0.35)] transition-all duration-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <TextLabel>Sesi analisis</TextLabel>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">{stageLabel}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {phase === "processing"
              ? "Status proses tetap terlihat saat analisis berjalan."
              : "Konteks utama tetap terlihat saat hasil dieksplorasi."}
          </p>
        </div>
        <StatusPill>{stageMeta}</StatusPill>
      </div>

      <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cx(
            "h-full rounded-full transition-all duration-700",
            resultView ? resultView.verdict.accent : "bg-sky-400"
          )}
          style={{
            width: isLoading
              ? `${currentYoutubeStage.progress}%`
              : resultView
                ? resultView.confidencePercent
                : "8%",
          }}
        />
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-medium text-slate-500">Source</p>
        <p className="mt-2 line-clamp-3 text-sm font-semibold leading-6 text-slate-950">
          {sourceTitle}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          {isYoutubeMode
            ? "YouTube URL analysis"
            : "Manual text and metadata analysis"}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <SidebarStat
          label="Words"
          value={formatNumber(analysisWordCount)}
        />
        <SidebarStat
          label="Analytics"
          value={canShowWordCloud ? "Ready" : "Short"}
        />
      </div>

      {isYoutubeMode ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <SidebarStat
            label="Summary"
            value={
              summaryError
                ? "Failed"
                : summary
                ? summaryMode === "limited"
                  ? "Limited"
                  : "Ready"
                : isLoading
                  ? "Pending"
                  : "Empty"
            }
          />
          <SidebarStat
            label="Video"
            value={videoInfo ? "Loaded" : isLoading ? "Fetching" : "None"}
          />
        </div>
      ) : null}

      <SecondaryButton
        disabled={isLoading}
        onClick={onReset}
        className="mt-5 w-full border-slate-950 text-slate-950 hover:bg-slate-950 hover:text-white"
      >
        Reset & Mulai Analisis Baru
      </SecondaryButton>
    </section>
  );
}

function ResultHero({ resultView, isVisible }) {
  return (
    <Surface
      className={cx(
        "overflow-hidden transition-all duration-500",
        resultView.verdict.panel,
        isVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      )}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <TextLabel>Latest result</TextLabel>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className={cx(
                "inline-flex rounded-full border px-3 py-1 text-sm font-semibold",
                resultView.verdict.badge
              )}
            >
              {resultView.verdict.label}
            </span>
            <span className="text-sm text-slate-600">
              Predicted label {resultView.predictedLabel}
            </span>
          </div>
          <h2
            className={cx(
              "mt-5 text-5xl font-semibold text-slate-950 sm:text-6xl",
              resultView.verdict.text
            )}
          >
            {resultView.confidencePercent}
          </h2>
          <p className="mt-3 text-base leading-7 text-slate-700">
            {resultView.verdict.summary}
          </p>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white/80 p-5 shadow-sm lg:min-w-56">
          <TextLabel>Confidence</TextLabel>
          <p className="mt-3 text-4xl font-semibold text-slate-950">
            {resultView.confidencePercent}
          </p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cx(
                "h-full rounded-full transition-all duration-700",
                resultView.verdict.accent
              )}
              style={{ width: resultView.confidencePercent }}
            />
          </div>
        </div>
      </div>
    </Surface>
  );
}

function CollapsiblePanel({ title, description, meta, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_14px_45px_-38px_rgba(15,23,42,0.28)]">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left transition-colors duration-200 hover:bg-slate-50"
      >
        <div>
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {meta ? <StatusPill>{meta}</StatusPill> : null}
          <span
            className={cx(
              "flex h-9 w-9 items-center justify-center rounded-xl border text-xl font-semibold leading-none transition-colors duration-200",
              isOpen
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-200 bg-white text-slate-700"
            )}
          >
            {isOpen ? "-" : "+"}
          </span>
        </div>
      </button>
      <div
        className={cx(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-200 px-5 py-5">{children}</div>
        </div>
      </div>
    </section>
  );
}

function DecisionDetails({ resultView }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-800">Decision rule</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          The verdict follows the class with the highest predicted probability.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-800">Confidence margin</p>
        <p className="mt-3 text-3xl font-semibold text-slate-950">
          {resultView.marginPercent}
        </p>
      </div>
    </div>
  );
}

function VideoContext({ videoInfo, youtubeMetadata }) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {videoInfo.thumbnailUrl ? (
          <div
            role="img"
            aria-label={`Thumbnail preview for ${videoInfo.title}`}
            className="aspect-video w-full bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${videoInfo.thumbnailUrl})` }}
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center px-4 text-center text-sm text-slate-500">
            Thumbnail not available
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">
            {videoInfo.title || "Untitled video"}
          </p>
          <div className="mt-3 max-h-48 overflow-auto text-sm leading-7 text-slate-600">
            {videoInfo.description || "No description available."}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metadataFields.map((field, index) => {
            const metadataValue = youtubeMetadata[index] ?? 0;
            const display = getMetadataDisplay(field.key, metadataValue);

            return (
              <ResultMetric
                key={field.key}
                label={field.label}
                value={display.primary}
                subvalue={display.secondary}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummarySection({
  isYoutubeMode,
  summary,
  summaryMode,
  summaryError,
  videoInfo,
  youtubeMetadata,
  youtubeAnalysisText,
  analysisWordCount,
  resultView,
}) {
  return (
    <section className="space-y-4">
      <CollapsiblePanel
        title="Why this result appeared"
        description="Decision thresholds and score separation."
        meta="Context"
        defaultOpen
      >
        <DecisionDetails resultView={resultView} />
      </CollapsiblePanel>

      {videoInfo ? (
        <CollapsiblePanel
          title="Video context"
          description="Fetched YouTube details and numeric metadata."
          meta="YouTube"
          defaultOpen
        >
          <VideoContext videoInfo={videoInfo} youtubeMetadata={youtubeMetadata} />
        </CollapsiblePanel>
      ) : null}

      {isYoutubeMode ? (
        <CollapsiblePanel
          title="Video Summary"
          description="Gemini summary based only on video content."
          meta={
            summaryError
              ? "Failed"
              : summaryMode === "limited"
                ? "Limited"
                : summary
                  ? "Full"
                  : "Not available"
          }
          defaultOpen
        >
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            {summaryMode === "limited" ? (
              <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
                Summary is limited (no transcript available)
              </p>
            ) : null}
            {summaryError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium leading-6 text-red-700">
                {summaryError}
              </p>
            ) : summary ? (
              <p className="text-sm leading-7 text-slate-700">{summary}</p>
            ) : (
              <p className="text-sm leading-7 text-slate-500">
                Ringkasan video belum tersedia.
              </p>
            )}
          </div>
        </CollapsiblePanel>
      ) : null}

      {isYoutubeMode && youtubeAnalysisText ? (
        <CollapsiblePanel
          title="Text used for inference"
          description="Combined source text sent to the model."
          meta={`${analysisWordCount} words`}
          defaultOpen
        >
          <textarea
            readOnly
            value={youtubeAnalysisText}
            rows={11}
            className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none"
          />
        </CollapsiblePanel>
      ) : null}
    </section>
  );
}

function ScoreBar({ label, value, barClassName, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white">
        <div
          className={cx("h-full rounded-full transition-all duration-500", barClassName)}
          style={{ width: value }}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
    </div>
  );
}

function ResultMetric({ label, value, subvalue }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
      {subvalue ? <p className="mt-1 text-xs text-slate-500">{subvalue}</p> : null}
    </div>
  );
}

function WordCloud({
  wordCloudState,
  canShowWordCloud,
  hasWordCloudKeywords,
  maxWordValue,
  minWordValue,
}) {
  if (!canShowWordCloud) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        Text too short for word cloud visualization.
      </div>
    );
  }

  if (!hasWordCloudKeywords) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        No words available for visualization.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
      <div className="flex min-h-64 flex-wrap items-center justify-center gap-x-4 gap-y-3 text-center">
        {wordCloudState.data.map((word, index) => (
          <span
            key={`${word.text}-${index}`}
            style={getWordCloudWordStyle(word, index, maxWordValue, minWordValue)}
            className="inline-block select-none transition-transform duration-300 hover:scale-105"
          >
            {word.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function AnalyticsSection({
  isYoutubeMode,
  resultView,
  wordCloudState,
  canShowWordCloud,
  hasWordCloudKeywords,
  maxWordValue,
  minWordValue,
}) {
  return (
    <section className="space-y-4">
      <CollapsiblePanel
        title="Probability details"
        description="Safe and Unsafe probability scores."
        defaultOpen
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ScoreBar
            label="Safe score"
            value={resultView.label0Percent}
            barClassName="bg-slate-800"
          />
          <ScoreBar
            label="Unsafe score"
            value={resultView.label1Percent}
            barClassName="bg-orange-500"
          />
        </div>
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-slate-800">Confidence margin</p>
            <p className="text-3xl font-semibold text-slate-950">
              {resultView.marginPercent}
            </p>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Absolute difference between Safe score and Unsafe score.
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Margin = | Safe score − Unsafe score |
          </p>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        title={
          isYoutubeMode
            ? "Keyword cloud from YouTube text"
            : "Keyword cloud from manual input"
        }
        description="High-frequency terms from the text used for analysis."
        meta={`${wordCloudState.wordCount} words`}
        defaultOpen
      >
        <WordCloud
          wordCloudState={wordCloudState}
          canShowWordCloud={canShowWordCloud}
          hasWordCloudKeywords={hasWordCloudKeywords}
          maxWordValue={maxWordValue}
          minWordValue={minWordValue}
        />
      </CollapsiblePanel>
    </section>
  );
}

function ResultSkeleton() {
  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="h-4 w-40 animate-pulse rounded-full bg-slate-200" />
      <div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}

export default function Page() {
  const [mode, setMode] = useState("youtube");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [metadata, setMetadata] = useState(initialMetadata);
  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState("");
  const [summaryMode, setSummaryMode] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [videoInfo, setVideoInfo] = useState(null);
  const [youtubeMetadata, setYoutubeMetadata] = useState([]);
  const [youtubeAnalysisText, setYoutubeAnalysisText] = useState("");
  const [youtubeProgressStep, setYoutubeProgressStep] = useState(0);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResultVisible, setIsResultVisible] = useState(false);

  const isYoutubeMode = mode === "youtube";
  const resultView = useMemo(() => getResultViewModel(result), [result]);
  const activeAnalysisText = isYoutubeMode ? youtubeAnalysisText : text;
  const wordCloudState = useMemo(
    () => buildWordCloudState(activeAnalysisText),
    [activeAnalysisText]
  );
  const analysisWordCount = wordCloudState.wordCount;
  const canShowWordCloud = wordCloudState.wordCount >= WORD_CLOUD_THRESHOLD;
  const hasWordCloudKeywords = wordCloudState.data.length > 0;
  const maxWordValue = hasWordCloudKeywords
    ? Math.max(...wordCloudState.data.map((word) => word.value))
    : 1;
  const minWordValue = hasWordCloudKeywords
    ? Math.min(...wordCloudState.data.map((word) => word.value))
    : 1;
  const currentYoutubeStage =
    YOUTUBE_PROGRESS_STAGES[
      Math.min(youtubeProgressStep, YOUTUBE_PROGRESS_STAGES.length - 1)
    ];
  const hasInput = isYoutubeMode
    ? Boolean(url.trim())
    : Boolean(text.trim()) ||
      Object.values(metadata).some((value) => String(value).trim());
  const phase = getUiPhase({ isLoading, resultView, hasInput });
  const hasSession = Boolean(isLoading || resultView);
  const showResultExploration = Boolean(resultView && isResultVisible);

  useEffect(() => {
    const revealTimerId = window.setTimeout(() => {
      setIsResultVisible(Boolean(result));
    }, result ? 180 : 0);

    return () => {
      window.clearTimeout(revealTimerId);
    };
  }, [result]);

  function handleModeChange(nextMode) {
    setMode(nextMode);
    setResult(null);
    setSummary("");
    setSummaryMode("");
    setSummaryError("");
    setVideoInfo(null);
    setError("");
    setYoutubeProgressStep(0);
  }

  function handleMetadataChange(fieldKey, value) {
    const nextValue = normalizeMetadataInput(value);
    if (nextValue === null) {
      return;
    }

    setMetadata((current) => ({
      ...current,
      [fieldKey]: nextValue,
    }));
  }

  function handleReset() {
    setMode("youtube");
    setText("");
    setUrl("");
    setMetadata({ ...initialMetadata });
    setResult(null);
    setSummary("");
    setSummaryMode("");
    setSummaryError("");
    setVideoInfo(null);
    setYoutubeMetadata([]);
    setYoutubeAnalysisText("");
    setYoutubeProgressStep(0);
    setError("");
    setIsLoading(false);
    setIsResultVisible(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleAnalyze() {
    const activeMode = mode;
    const apiUrl = activeMode === "youtube" ? YOUTUBE_API_URL : PREDICT_API_URL;
    let progressTimerId = null;
    const validationError =
      activeMode === "youtube"
        ? validateYoutubeUrl(url)
        : validateManualInput(text, metadata);

    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setResult(null);
    setSummary("");
    setSummaryMode("");
    setSummaryError("");
    setVideoInfo(null);
    setIsLoading(true);

    if (activeMode === "youtube") {
      setYoutubeMetadata([]);
      setYoutubeAnalysisText("");
      setYoutubeProgressStep(0);

      progressTimerId = window.setInterval(() => {
        setYoutubeProgressStep((currentStep) =>
          currentStep < YOUTUBE_PROGRESS_STAGES.length - 1
            ? currentStep + 1
            : currentStep
        );
      }, 1600);
    }

    try {
      const response =
        activeMode === "youtube"
          ? await fetch(apiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ url: url.trim() }),
            })
          : await fetch(apiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                text: text.trim(),
                metadata: toMetadataArray(metadata),
              }),
            });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload?.detail || "The analyzer could not process your request.";
        throw new Error(message);
      }

      if (activeMode === "youtube") {
        if (!payload?.result) {
          throw new Error("The analyzer returned an incomplete YouTube response.");
        }

        const nextAnalysisText =
          typeof payload.analysisText === "string" ? payload.analysisText : "";

        setYoutubeProgressStep(YOUTUBE_PROGRESS_STAGES.length - 1);
        setResult(payload.result);
        setSummary(typeof payload.summary === "string" ? payload.summary : "");
        setSummaryMode(
          typeof payload.summary_mode === "string" ? payload.summary_mode : ""
        );
        setSummaryError(
          typeof payload.summary_error === "string" ? payload.summary_error : ""
        );
        setVideoInfo(payload.video ?? null);
        setYoutubeMetadata(Array.isArray(payload.metadata) ? payload.metadata : []);
        setYoutubeAnalysisText(nextAnalysisText);
      } else {
        setResult(payload);
      }
    } catch (requestError) {
      if (
        requestError instanceof Error &&
        requestError.message === "Failed to fetch"
      ) {
        setError(
          `Tidak bisa terhubung ke backend (${apiUrl}). Pastikan FastAPI sedang jalan dan cek ${apiUrl.replace(/\/[^/]+$/, "/docs")}.`
        );
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Something went wrong while contacting the API."
        );
      }
    } finally {
      if (progressTimerId) {
        window.clearInterval(progressTimerId);
      }

      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <PhaseHeader phase={phase} />

        <div
          className={cx(
            "mt-8 grid gap-6",
            hasSession
              ? "lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]"
              : "mx-auto max-w-3xl"
          )}
        >
          <aside
            className={cx(
              "space-y-6",
              hasSession &&
                "lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
            )}
          >
            <InputSection
              url={url}
              isLoading={isLoading}
              error={error}
              hasSession={hasSession}
              onUrlChange={setUrl}
              onAnalyze={handleAnalyze}
              onReset={handleReset}
            />

            {hasSession ? (
              <SessionOverview
                phase={phase}
                isYoutubeMode={isYoutubeMode}
                isLoading={isLoading}
                resultView={resultView}
                currentYoutubeStage={currentYoutubeStage}
                url={url}
                text={text}
                videoInfo={videoInfo}
                summary={summary}
                summaryMode={summaryMode}
                summaryError={summaryError}
                analysisWordCount={analysisWordCount}
                canShowWordCloud={canShowWordCloud}
                onReset={handleReset}
              />
            ) : null}
          </aside>

          {hasSession ? (
            <div className="space-y-6">
              {isLoading ? (
                <ProcessingSection
                  isYoutubeMode={isYoutubeMode}
                  currentYoutubeStage={currentYoutubeStage}
                  youtubeProgressStep={youtubeProgressStep}
                />
              ) : null}

              {resultView ? (
                <div>
                  <ResultHero resultView={resultView} isVisible={isResultVisible} />
                  {showResultExploration ? (
                    <div className="mt-6 space-y-6">
                      <SummarySection
                        isYoutubeMode={isYoutubeMode}
                        summary={summary}
                        summaryMode={summaryMode}
                        summaryError={summaryError}
                        videoInfo={videoInfo}
                        youtubeMetadata={youtubeMetadata}
                        youtubeAnalysisText={youtubeAnalysisText}
                        analysisWordCount={analysisWordCount}
                        resultView={resultView}
                      />
                      <AnalyticsSection
                        isYoutubeMode={isYoutubeMode}
                        resultView={resultView}
                        wordCloudState={wordCloudState}
                        canShowWordCloud={canShowWordCloud}
                        hasWordCloudKeywords={hasWordCloudKeywords}
                        maxWordValue={maxWordValue}
                        minWordValue={minWordValue}
                      />
                    </div>
                  ) : (
                    <ResultSkeleton />
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
