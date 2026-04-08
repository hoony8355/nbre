# NBRE Music Dashboard

힙합 팀용 음악 스케치 협업 대시보드입니다.
이 버전은 **Supabase DB + Storage + Realtime** 기반이라 팀원 모두 같은 데이터를 공유합니다.

## 구현 범위
- `tracks`, `versions`, `feedback`, `lyrics_history` 테이블 분리
- 오디오 파일은 Supabase Storage 버킷 사용
- Realtime 구독으로 곡/피드백/가사/버전 업데이트 즉시 반영
- 프론트는 정적 파일(`index.html`, `app.js`)이라 GitHub Pages/Vercel 둘 다 배포 가능

## 1) Supabase 준비

### (A) Storage 버킷 생성
- 버킷 이름: `music-files` (기본값)
- Public 버킷으로 생성

### (B) SQL 실행
Supabase SQL Editor에서 아래를 실행하세요.

```sql
create extension if not exists pgcrypto;

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.versions (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  type text not null check (type in ('song', 'mr')),
  uploader text not null,
  file_name text not null,
  file_path text not null,
  public_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  author text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.lyrics_history (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  editor text not null,
  lyrics text not null,
  created_at timestamptz not null default now()
);

alter publication supabase_realtime add table public.tracks;
alter publication supabase_realtime add table public.versions;
alter publication supabase_realtime add table public.feedback;
alter publication supabase_realtime add table public.lyrics_history;
```

### (C) RLS 정책 (간단 팀공유용)
> 운영 전에는 인증 기반 정책으로 강화하세요.

```sql
alter table public.tracks enable row level security;
alter table public.versions enable row level security;
alter table public.feedback enable row level security;
alter table public.lyrics_history enable row level security;

create policy "public read tracks" on public.tracks for select using (true);
create policy "public write tracks" on public.tracks for insert with check (true);

create policy "public read versions" on public.versions for select using (true);
create policy "public write versions" on public.versions for insert with check (true);

create policy "public read feedback" on public.feedback for select using (true);
create policy "public write feedback" on public.feedback for insert with check (true);

create policy "public read lyrics" on public.lyrics_history for select using (true);
create policy "public write lyrics" on public.lyrics_history for insert with check (true);
```

## 2) 환경변수(키값) 설정 방식
앱은 `window.APP_CONFIG`를 읽습니다.

### 필요한 키
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_STORAGE_BUCKET` (기본값 `music-files`)

`config.example.js`를 참고해 `config.local.js`를 채우면 됩니다.

## 3) Vercel에서 변수 설정
1. Vercel 프로젝트 → **Settings → Environment Variables**
2. 위 3개 변수 추가
3. 배포 시 아래처럼 `config.local.js`를 생성하도록 빌드 커맨드 사용

예시 Build Command:
```bash
cat > config.local.js <<EOCONFIG
window.APP_CONFIG = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}",
  SUPABASE_STORAGE_BUCKET: "${SUPABASE_STORAGE_BUCKET}"
};
EOCONFIG
```

## 4) GitHub Pages에서 변수 설정
GitHub Pages 정적 호스팅은 런타임 환경변수가 없어서, **GitHub Actions에서 빌드 중 파일 생성** 방식이 필요합니다.

1. GitHub Repo → **Settings → Secrets and variables → Actions**
2. Repository Secrets 추가:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_STORAGE_BUCKET`
3. 배포 워크플로우에서 위와 동일하게 `config.local.js` 생성 후 아티팩트 배포

## 로컬 실행
```bash
python3 -m http.server 4173
```
브라우저에서 `http://localhost:4173` 열기.
