const cfg = window.APP_CONFIG || {};
const statusEl = document.getElementById("connection-status");
const trackListEl = document.getElementById("track-list");
const addTrackForm = document.getElementById("add-track-form");
const openAddTrackBtn = document.getElementById("open-add-track");
const closeAddTrackBtn = document.getElementById("close-add-track");
const addTrackPanel = document.getElementById("add-track-panel");
const template = document.getElementById("track-template");
const playerAudioEl = document.getElementById("global-audio");
const playerTitleEl = document.getElementById("player-track-title");
const playerSubEl = document.getElementById("player-track-sub");
const playerPrevBtn = document.getElementById("player-prev");
const playerPlayBtn = document.getElementById("player-play");
const playerNextBtn = document.getElementById("player-next");
const playerRepeatBtn = document.getElementById("player-repeat");
const playerProgressEl = document.getElementById("player-progress");
const playerCurrentEl = document.getElementById("player-current");
const playerDurationEl = document.getElementById("player-duration");
const toastRoot = document.getElementById("toast-root");
const themeSelect = document.getElementById("theme-select");
const settingsToggleBtn = document.getElementById("settings-toggle");
const settingsCloseBtn = document.getElementById("settings-close");
const settingsPanel = document.getElementById("settings-panel");
const THEME_KEY = "nbre-theme";

const ICON_PLAY = "▶";
const ICON_PAUSE = "❚❚";

const hasSupabaseConfig = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const sbClient = hasSupabaseConfig
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const state = {
  tracks: [],
  versionsByTrack: new Map(),
  feedbackByTrack: new Map(),
  currentTrackId: null,
  repeatOne: false,
};

if (!sbClient) {
  statusEl.textContent =
    "Supabase 설정이 없습니다. config.local.js에 SUPABASE_URL / SUPABASE_ANON_KEY를 설정하세요.";
  statusEl.style.color = "#ff9ab8";
  trackListEl.innerHTML = `<p class="meta">설정 후 새로고침하면 팀 공유 대시보드가 활성화됩니다.</p>`;
} else {
  statusEl.textContent = "Supabase 연결됨 · 실시간 동기화 활성";
  bootstrap().catch((err) => {
    console.error(err);
    statusEl.textContent = `초기화 실패: ${err.message}`;
    statusEl.style.color = "#ff9ab8";
  });
}


openAddTrackBtn?.addEventListener("click", () => {
  addTrackPanel.hidden = false;
});

closeAddTrackBtn?.addEventListener("click", () => {
  addTrackPanel.hidden = true;
});

addTrackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!sbClient) return;

  const title = document.getElementById("track-title").value.trim();
  const owner = document.getElementById("track-owner").value.trim();
  const note = document.getElementById("track-note").value.trim();
  if (!title || !owner) return;

  const { error } = await sbClient.from("tracks").insert({ title, owner, note });
  if (error) {
    showToast(`곡 생성 실패: ${error.message}`, "error");
    return;
  }

  addTrackForm.reset();
  addTrackPanel.hidden = true;
  showToast("곡이 생성되었습니다.", "success");
  await loadData();
  render();
});


playerPrevBtn?.addEventListener("click", () => moveTrack(-1));
playerNextBtn?.addEventListener("click", () => moveTrack(1));
playerPlayBtn?.addEventListener("click", async () => {
  if (!playerAudioEl.src) {
    const queue = getLatestPlayableTracks();
    if (queue.length === 0) return;
    await playTrack(queue[0].track.id);
    return;
  }

  if (playerAudioEl.paused) {
    await playerAudioEl.play();
    playerPlayBtn.textContent = ICON_PAUSE;
  } else {
    playerAudioEl.pause();
    playerPlayBtn.textContent = ICON_PLAY;
  }
});

playerAudioEl?.addEventListener("play", () => {
  playerPlayBtn.textContent = ICON_PAUSE;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
});

playerAudioEl?.addEventListener("pause", () => {
  playerPlayBtn.textContent = ICON_PLAY;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
});


playerRepeatBtn?.addEventListener("click", () => {
  state.repeatOne = !state.repeatOne;
  playerRepeatBtn.classList.toggle("is-active", state.repeatOne);
  showToast(state.repeatOne ? "한 곡 반복 ON" : "한 곡 반복 OFF", "info");
});

playerProgressEl?.addEventListener("input", () => {
  if (!playerAudioEl.duration) return;
  const ratio = Number(playerProgressEl.value) / 100;
  playerAudioEl.currentTime = playerAudioEl.duration * ratio;
});

playerAudioEl?.addEventListener("timeupdate", syncPlayerTimeline);
playerAudioEl?.addEventListener("loadedmetadata", syncPlayerTimeline);
playerAudioEl?.addEventListener("ended", () => {
  if (state.repeatOne) {
    playerAudioEl.currentTime = 0;
    playerAudioEl.play();
    return;
  }

  moveTrack(1);
});


setupMediaSessionHandlers();
initThemeSelector();

async function bootstrap() {
  await loadData();
  render();
  subscribeRealtime();
}

async function loadData() {
  const [tracksRes, versionsRes, feedbackRes] = await Promise.all([
    sbClient.from("tracks").select("*").order("created_at", { ascending: false }),
    sbClient.from("versions").select("*").order("created_at", { ascending: false }),
    sbClient.from("feedback").select("*").order("created_at", { ascending: false }),
  ]);

  for (const res of [tracksRes, versionsRes, feedbackRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  state.tracks = tracksRes.data || [];
  state.versionsByTrack = groupBy(versionsRes.data || [], "track_id");
  state.feedbackByTrack = groupBy(feedbackRes.data || [], "track_id");

}

function subscribeRealtime() {
  const channel = sbClient
    .channel("music-dashboard-all")
    .on("postgres_changes", { event: "*", schema: "public", table: "tracks" }, syncNow)
    .on("postgres_changes", { event: "*", schema: "public", table: "versions" }, syncNow)
    .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, syncNow)
    .subscribe();

  async function syncNow() {
    await loadData();
    render();
  }

  window.addEventListener("beforeunload", () => {
    sbClient.removeChannel(channel);
  });
}

function render() {
  trackListEl.innerHTML = "";

  if (state.tracks.length === 0) {
    trackListEl.innerHTML = `<p class="meta">아직 등록된 곡이 없습니다.</p>`;
    return;
  }

  const sortedTracks = [...state.tracks].sort((a, b) => trackLastUpdatedAt(b) - trackLastUpdatedAt(a));

  for (const track of sortedTracks) {
    const versions = state.versionsByTrack.get(track.id) || [];
    const feedback = state.feedbackByTrack.get(track.id) || [];

    const fragment = template.content.cloneNode(true);
    const toggleBtn = fragment.querySelector(".track-toggle");
    const body = fragment.querySelector(".track-body");
    const latestBox = fragment.querySelector(".latest-box");
    const mrList = fragment.querySelector(".mr-list");
    const feedbackList = fragment.querySelector(".feedback-list");

    toggleBtn.innerHTML = `
      <span>
        <strong>${escapeHtml(track.title)}</strong> ${isRecentWithinDays(trackLastUpdatedAt(track), 7) ? `<span class="new-badge">NEW</span>` : ""}
        <span class="meta"> · by ${escapeHtml(track.owner)} · ${formatDate(trackLastUpdatedAt(track))}</span>
      </span>
      <span>열기 ▼</span>
    `;

    toggleBtn.addEventListener("click", () => {
      body.classList.toggle("hidden");
      const expanded = !body.classList.contains("hidden");
      toggleBtn.setAttribute("aria-expanded", String(expanded));
      toggleBtn.querySelector("span:last-child").textContent = expanded ? "닫기 ▲" : "열기 ▼";
    });

    const latestSong = versions.find((item) => item.type === "song");
    latestBox.innerHTML = latestSong
      ? `
      <p><span class="type-tag">최신 곡 버전</span> ${escapeHtml(latestSong.uploader)} · ${formatDate(latestSong.created_at)}</p>
      <audio controls src="${escapeHtml(latestSong.public_url)}"></audio>
      <button type="button" class="mini-toggle play-track-btn">이 곡 재생</button>`
      : `<p class="meta">아직 업로드된 곡 버전이 없습니다.</p>`;

    if (track.note) {
      latestBox.insertAdjacentHTML("beforeend", `<p class="meta">메모: ${escapeHtml(track.note)}</p>`);
    }

    const mrVersions = versions.filter((version) => version.type === "mr");
    mrList.innerHTML = mrVersions.length
      ? mrVersions
          .map(
            (version) => `
          <div class="version-item">
            <div>
              <span class="type-tag mr">MR</span>
              <strong>${escapeHtml(version.file_name)}</strong>
            </div>
            <span class="meta">${escapeHtml(version.uploader)} · ${formatDate(version.created_at)}</span>
            <audio controls src="${escapeHtml(version.public_url)}"></audio>
          </div>`
          )
          .join("")
      : `<p class="meta">등록된 MR이 없습니다.</p>`;

    const scopedFeedback = latestSong
      ? feedback.filter((fb) => !fb.version_id || fb.version_id === latestSong.id)
      : feedback;

    feedbackList.innerHTML = scopedFeedback.length
      ? scopedFeedback
          .map(
            (fb) =>
              `<li><strong>${escapeHtml(fb.author)}</strong> <span class="meta">${formatDate(fb.created_at)}</span><br/>${escapeHtml(fb.text)}</li>`
          )
          .join("")
            : `<li class="meta">아직 피드백이 없습니다.</li>`;

    const uploadPanel = fragment.querySelector(".panel-upload");
    const mrPanel = fragment.querySelector(".panel-mr");
    const lyricsPanel = fragment.querySelector(".panel-lyrics");

    bindPanelToggle(fragment.querySelector(".action-upload"), uploadPanel);
    bindPanelToggle(fragment.querySelector(".action-mr"), mrPanel);
    bindPanelToggle(fragment.querySelector(".action-lyrics"), lyricsPanel);

    const playTrackBtn = fragment.querySelector(".play-track-btn");
    playTrackBtn?.addEventListener("click", () => playTrack(track.id));

    const uploadForm = fragment.querySelector(".upload-form");

    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const uploader = uploadForm.querySelector(".uploader").value.trim();
      const type = uploadForm.querySelector(".version-type").value;
      const fileInput = uploadForm.querySelector(".audio-file");
      const submitBtn = uploadForm.querySelector(".upload-submit-btn");
      const statusEl = uploadForm.querySelector(".upload-status");
      const progressWrap = uploadForm.querySelector(".upload-progress");
      const progressBar = uploadForm.querySelector(".upload-progress-bar");
      const file = fileInput.files[0];
      if (!uploader || !file) return;

      submitBtn.disabled = true;
      progressWrap.hidden = false;
      statusEl.textContent = "업로드 중... 0%";

      const stopProgress = startUploadProgress(statusEl, progressBar);

      try {
        const path = `${track.id}/${Date.now()}-${sanitizeFileName(file.name)}`;
        const bucket = cfg.SUPABASE_STORAGE_BUCKET || "music-files";

        const uploadRes = await sbClient.storage.from(bucket).upload(path, file, { upsert: false });
        if (uploadRes.error) {
          showToast(`파일 업로드 실패: ${uploadRes.error.message}`, "error");
          stopProgress(false);
          return;
        }

        const publicUrlRes = sbClient.storage.from(bucket).getPublicUrl(path);
        const publicUrl = publicUrlRes.data.publicUrl;

        const { error } = await sbClient.from("versions").insert({
          track_id: track.id,
          type,
          uploader,
          file_name: file.name,
          file_path: path,
          public_url: publicUrl,
        });

        if (error) {
          showToast(`버전 저장 실패: ${error.message}`, "error");
          stopProgress(false);
          return;
        }

        stopProgress(true);
        await loadData();
        render();
        showToast("버전 업로드 완료", "success");
      } finally {
        submitBtn.disabled = false;
      }
    });

    const feedbackForm = fragment.querySelector(".feedback-form");
    feedbackForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const author = feedbackForm.querySelector(".feedback-author").value.trim();
      const text = feedbackForm.querySelector(".feedback-text").value.trim();
      if (!author || !text) return;

      const payload = {
        track_id: track.id,
        author,
        text,
      };

      if (latestSong?.id) {
        payload.version_id = latestSong.id;
      }

      let { error } = await sbClient.from("feedback").insert(payload);

      if (error && String(error.message).includes("version_id")) {
        const retryPayload = { track_id: track.id, author, text };
        const retryResult = await sbClient.from("feedback").insert(retryPayload);
        error = retryResult.error;
      }

      if (error) {
        showToast(`피드백 저장 실패: ${error.message}`, "error");
        return;
      }

      await loadData();
      render();
      showToast("피드백이 등록되었습니다.", "success");
    });

    const lyricsForm = fragment.querySelector(".lyrics-form");
    lyricsForm.querySelector(".lyrics-text").value = track.lyrics || "";
    lyricsForm.querySelector(".lyrics-editor").value = "";

    lyricsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const editor = lyricsForm.querySelector(".lyrics-editor").value.trim();
      const lyrics = lyricsForm.querySelector(".lyrics-text").value;
      if (!editor) return;

      const { error } = await sbClient
        .from("tracks")
        .update({ lyrics, lyrics_updated_by: editor, lyrics_updated_at: new Date().toISOString() })
        .eq("id", track.id);
      if (error) {
        showToast(`가사 업데이트 실패: ${error.message}`, "error");
        return;
      }

      await loadData();
      render();
      showToast("가사가 업데이트되었습니다.", "success");
    });

    const lyricsSection = lyricsForm.parentElement;
    lyricsSection.insertAdjacentHTML(
      "beforeend",
      `<p class="meta">마지막 수정: ${escapeHtml(track.lyrics_updated_by || "-")} · ${track.lyrics_updated_at ? formatDate(track.lyrics_updated_at) : "-"}</p>`
    );

    trackListEl.appendChild(fragment);
  }

  updatePlayerMeta();
}

async function playTrack(trackId) {
  const queue = getLatestPlayableTracks();
  const target = queue.find((item) => item.track.id === trackId);
  if (!target) return;

  state.currentTrackId = trackId;
  playerAudioEl.src = target.latestSong.public_url;
  updateMediaSessionMetadata(target.track, target.latestSong);
  await playerAudioEl.play();
  updatePlayerMeta();
}

function moveTrack(direction) {
  const queue = getLatestPlayableTracks();
  if (queue.length === 0) return;

  const currentIndex = queue.findIndex((item) => item.track.id === state.currentTrackId);
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + direction + queue.length) % queue.length;
  playTrack(queue[nextIndex].track.id);
}

function getLatestPlayableTracks() {
  return state.tracks
    .map((track) => ({ track, latestSong: (state.versionsByTrack.get(track.id) || []).find((v) => v.type === "song") }))
    .filter((entry) => Boolean(entry.latestSong));
}

function updatePlayerMeta() {
  const queue = getLatestPlayableTracks();
  const current = queue.find((item) => item.track.id === state.currentTrackId);

  const hasQueue = queue.length > 0;
  playerPrevBtn.disabled = !hasQueue;
  playerNextBtn.disabled = !hasQueue;

  if (!current) {
    playerTitleEl.textContent = "재생 대기 중";
    playerSubEl.textContent = "목록에서 곡을 선택하세요";
    playerPlayBtn.textContent = ICON_PLAY;
    playerPlayBtn.disabled = !hasQueue;
    playerRepeatBtn.disabled = !hasQueue;
    playerProgressEl.value = 0;
    playerCurrentEl.textContent = "00:00";
    playerDurationEl.textContent = "00:00";
    clearMediaSessionMetadata();
    return;
  }

  playerPlayBtn.disabled = false;
  playerRepeatBtn.disabled = false;
  playerTitleEl.textContent = current.track.title;
  playerSubEl.textContent = `최신 업로더: ${current.latestSong.uploader}`;
  updateMediaSessionMetadata(current.track, current.latestSong);
}



function syncPlayerTimeline() {
  const duration = Number.isFinite(playerAudioEl.duration) ? playerAudioEl.duration : 0;
  const current = Number.isFinite(playerAudioEl.currentTime) ? playerAudioEl.currentTime : 0;

  if (duration > 0) {
    playerProgressEl.value = String(Math.round((current / duration) * 100));
  } else {
    playerProgressEl.value = "0";
  }

  playerCurrentEl.textContent = formatClock(current);
  playerDurationEl.textContent = formatClock(duration);
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function setupMediaSessionHandlers() {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.setActionHandler("play", () => {
    playerAudioEl.play();
  });

  navigator.mediaSession.setActionHandler("pause", () => {
    playerAudioEl.pause();
  });

  navigator.mediaSession.setActionHandler("previoustrack", () => {
    moveTrack(-1);
  });

  navigator.mediaSession.setActionHandler("nexttrack", () => {
    moveTrack(1);
  });
}

function updateMediaSessionMetadata(track, latestSong) {
  if (!("mediaSession" in navigator) || !track || !latestSong) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: latestSong.uploader,
    album: "NBRE Dashboard",
  });

  navigator.mediaSession.playbackState = playerAudioEl.paused ? "paused" : "playing";
}

function clearMediaSessionMetadata() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = "none";
}



function initThemeSelector() {
  if (!themeSelect) return;

  const saved = localStorage.getItem(THEME_KEY) || "neon-purple";
  const available = Array.from(themeSelect.options).map((opt) => opt.value);
  const initial = available.includes(saved) ? saved : "neon-purple";

  document.body.dataset.theme = initial;
  themeSelect.value = initial;

  settingsToggleBtn?.addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
  });

  settingsCloseBtn?.addEventListener("click", () => {
    settingsPanel.hidden = true;
  });

  themeSelect.addEventListener("change", () => {
    const selected = themeSelect.value;
    document.body.dataset.theme = selected;
    localStorage.setItem(THEME_KEY, selected);
    showToast(`테마 변경: ${themeSelect.options[themeSelect.selectedIndex].text}`, "info");
  });
}

function trackLastUpdatedAt(track) {
  const versions = state.versionsByTrack.get(track.id) || [];
  const feedback = state.feedbackByTrack.get(track.id) || [];

  const candidateTimes = [
    track.created_at,
    track.lyrics_updated_at,
    ...versions.map((v) => v.created_at),
    ...feedback.map((f) => f.created_at),
  ]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  return candidateTimes.length ? Math.max(...candidateTimes) : 0;
}

function isRecentWithinDays(timestamp, days) {
  if (!timestamp) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return timestamp >= cutoff;
}

function bindPanelToggle(button, panel) {
  if (!button || !panel) return;

  const syncState = () => {
    const active = !panel.hidden;
    button.classList.toggle("is-active", active);
    button.dataset.state = active ? "on" : "off";
    button.setAttribute("aria-pressed", String(active));
  };

  syncState();
  button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    syncState();
  });
}


function showToast(message, type = "info") {
  if (!toastRoot) return;

  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  toastRoot.appendChild(item);

  setTimeout(() => {
    item.classList.add("hide");
    setTimeout(() => item.remove(), 250);
  }, 2200);
}

function startUploadProgress(statusEl, progressBar) {
  let value = 0;
  progressBar.style.width = "0%";

  const timer = setInterval(() => {
    value = Math.min(value + (value < 70 ? 9 : 3), 92);
    progressBar.style.width = `${value}%`;
    statusEl.textContent = `업로드 중... ${value}%`;
  }, 220);

  return (success) => {
    clearInterval(timer);
    const endValue = success ? 100 : value;
    progressBar.style.width = `${endValue}%`;
    statusEl.textContent = success ? "업로드 완료 100%" : "업로드 실패";
  };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const group = map.get(row[key]) || [];
    group.push(row);
    map.set(row[key], group);
  }
  return map;
}

function sanitizeFileName(fileName) {
  return fileName.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
