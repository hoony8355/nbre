const cfg = window.APP_CONFIG || {};
const statusEl = document.getElementById("connection-status");
const trackListEl = document.getElementById("track-list");
const addTrackForm = document.getElementById("add-track-form");
const template = document.getElementById("track-template");

const hasSupabaseConfig = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const supabase = hasSupabaseConfig
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const state = {
  tracks: [],
  versionsByTrack: new Map(),
  feedbackByTrack: new Map(),
  latestLyricsByTrack: new Map(),
};

if (!supabase) {
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

addTrackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;

  const title = document.getElementById("track-title").value.trim();
  const owner = document.getElementById("track-owner").value.trim();
  const note = document.getElementById("track-note").value.trim();
  if (!title || !owner) return;

  const { error } = await supabase.from("tracks").insert({ title, owner, note });
  if (error) {
    alert(`곡 생성 실패: ${error.message}`);
    return;
  }

  addTrackForm.reset();
  await loadData();
  render();
});

async function bootstrap() {
  await loadData();
  render();
  subscribeRealtime();
}

async function loadData() {
  const [tracksRes, versionsRes, feedbackRes, lyricsRes] = await Promise.all([
    supabase.from("tracks").select("*").order("created_at", { ascending: false }),
    supabase.from("versions").select("*").order("created_at", { ascending: false }),
    supabase.from("feedback").select("*").order("created_at", { ascending: false }),
    supabase
      .from("lyrics_history")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  for (const res of [tracksRes, versionsRes, feedbackRes, lyricsRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  state.tracks = tracksRes.data || [];
  state.versionsByTrack = groupBy(versionsRes.data || [], "track_id");
  state.feedbackByTrack = groupBy(feedbackRes.data || [], "track_id");

  const latestLyrics = new Map();
  for (const lyrics of lyricsRes.data || []) {
    if (!latestLyrics.has(lyrics.track_id)) latestLyrics.set(lyrics.track_id, lyrics);
  }
  state.latestLyricsByTrack = latestLyrics;
}

function subscribeRealtime() {
  const channel = supabase
    .channel("music-dashboard-all")
    .on("postgres_changes", { event: "*", schema: "public", table: "tracks" }, syncNow)
    .on("postgres_changes", { event: "*", schema: "public", table: "versions" }, syncNow)
    .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, syncNow)
    .on("postgres_changes", { event: "*", schema: "public", table: "lyrics_history" }, syncNow)
    .subscribe();

  async function syncNow() {
    await loadData();
    render();
  }

  window.addEventListener("beforeunload", () => {
    supabase.removeChannel(channel);
  });
}

function render() {
  trackListEl.innerHTML = "";

  if (state.tracks.length === 0) {
    trackListEl.innerHTML = `<p class="meta">아직 등록된 곡이 없습니다.</p>`;
    return;
  }

  for (const track of state.tracks) {
    const versions = state.versionsByTrack.get(track.id) || [];
    const feedback = state.feedbackByTrack.get(track.id) || [];
    const latestLyrics = state.latestLyricsByTrack.get(track.id);

    const fragment = template.content.cloneNode(true);
    const toggleBtn = fragment.querySelector(".track-toggle");
    const body = fragment.querySelector(".track-body");
    const latestBox = fragment.querySelector(".latest-box");
    const versionList = fragment.querySelector(".version-list");
    const feedbackList = fragment.querySelector(".feedback-list");

    toggleBtn.innerHTML = `
      <span>
        <strong>${escapeHtml(track.title)}</strong>
        <span class="meta"> · by ${escapeHtml(track.owner)} · ${formatDate(track.created_at)}</span>
      </span>
      <span>열기 ▼</span>
    `;

    toggleBtn.addEventListener("click", () => {
      body.classList.toggle("hidden");
      toggleBtn.querySelector("span:last-child").textContent = body.classList.contains("hidden") ? "열기 ▼" : "닫기 ▲";
    });

    const latestSong = versions.find((item) => item.type === "song");
    latestBox.innerHTML = latestSong
      ? `
      <p><span class="type-tag">최신 곡 버전</span> ${escapeHtml(latestSong.uploader)} · ${formatDate(latestSong.created_at)}</p>
      <audio controls src="${escapeHtml(latestSong.public_url)}"></audio>`
      : `<p class="meta">아직 업로드된 곡 버전이 없습니다.</p>`;

    if (track.note) {
      latestBox.insertAdjacentHTML("beforeend", `<p class="meta">메모: ${escapeHtml(track.note)}</p>`);
    }

    versionList.innerHTML = versions.length
      ? versions
          .map(
            (version) => `
          <div class="version-item">
            <div>
              <span class="type-tag ${version.type === "mr" ? "mr" : ""}">${version.type.toUpperCase()}</span>
              <strong>${escapeHtml(version.file_name)}</strong>
            </div>
            <span class="meta">${escapeHtml(version.uploader)} · ${formatDate(version.created_at)}</span>
            <audio controls src="${escapeHtml(version.public_url)}"></audio>
          </div>`
          )
          .join("")
      : `<p class="meta">업로드 이력이 없습니다.</p>`;

    feedbackList.innerHTML = feedback.length
      ? feedback
          .map(
            (fb) =>
              `<li><strong>${escapeHtml(fb.author)}</strong> <span class="meta">${formatDate(fb.created_at)}</span><br/>${escapeHtml(fb.text)}</li>`
          )
          .join("")
      : `<li class="meta">아직 피드백이 없습니다.</li>`;

    const uploadForm = fragment.querySelector(".upload-form");
    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const uploader = uploadForm.querySelector(".uploader").value.trim();
      const type = uploadForm.querySelector(".version-type").value;
      const fileInput = uploadForm.querySelector(".audio-file");
      const file = fileInput.files[0];
      if (!uploader || !file) return;

      const path = `${track.id}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const bucket = cfg.SUPABASE_STORAGE_BUCKET || "music-files";

      const uploadRes = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
      if (uploadRes.error) {
        alert(`파일 업로드 실패: ${uploadRes.error.message}`);
        return;
      }

      const publicUrlRes = supabase.storage.from(bucket).getPublicUrl(path);
      const publicUrl = publicUrlRes.data.publicUrl;

      const { error } = await supabase.from("versions").insert({
        track_id: track.id,
        type,
        uploader,
        file_name: file.name,
        file_path: path,
        public_url: publicUrl,
      });

      if (error) {
        alert(`버전 저장 실패: ${error.message}`);
        return;
      }

      await loadData();
      render();
    });

    const feedbackForm = fragment.querySelector(".feedback-form");
    feedbackForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const author = feedbackForm.querySelector(".feedback-author").value.trim();
      const text = feedbackForm.querySelector(".feedback-text").value.trim();
      if (!author || !text) return;

      const { error } = await supabase.from("feedback").insert({ track_id: track.id, author, text });
      if (error) {
        alert(`피드백 저장 실패: ${error.message}`);
        return;
      }

      await loadData();
      render();
    });

    const lyricsForm = fragment.querySelector(".lyrics-form");
    lyricsForm.querySelector(".lyrics-text").value = latestLyrics?.lyrics || "";
    lyricsForm.querySelector(".lyrics-editor").value = latestLyrics?.editor || "";

    lyricsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const editor = lyricsForm.querySelector(".lyrics-editor").value.trim();
      const lyrics = lyricsForm.querySelector(".lyrics-text").value;
      if (!editor) return;

      const { error } = await supabase.from("lyrics_history").insert({ track_id: track.id, editor, lyrics });
      if (error) {
        alert(`가사 업데이트 실패: ${error.message}`);
        return;
      }

      await loadData();
      render();
    });

    const lyricsSection = lyricsForm.parentElement;
    lyricsSection.insertAdjacentHTML(
      "beforeend",
      `<p class="meta">마지막 수정: ${escapeHtml(latestLyrics?.editor || "-")} · ${latestLyrics?.created_at ? formatDate(latestLyrics.created_at) : "-"}</p>`
    );

    trackListEl.appendChild(fragment);
  }
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
