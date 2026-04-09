# NBRE Music Dashboard

힙합 팀용 음악 스케치 협업 대시보드입니다.
이 버전은 **Supabase DB + Storage + Realtime** 기반이라 팀원 모두 같은 데이터를 공유합니다.

## 구현 범위
- `tracks`, `versions`, `feedback` 테이블 분리 (가사는 `tracks`에 최신본 유지)
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
  lyrics text default '',
  lyrics_updated_by text,
  lyrics_updated_at timestamptz,
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
  version_id uuid references public.versions(id) on delete set null,
  author text not null,
  text text not null,
  created_at timestamptz not null default now()
);


alter publication supabase_realtime add table public.tracks;
alter publication supabase_realtime add table public.versions;
alter publication supabase_realtime add table public.feedback;
```


기존 테이블을 이미 만들었다면 아래 마이그레이션도 실행하세요.

```sql
alter table public.feedback add column if not exists version_id uuid references public.versions(id) on delete set null;
alter table public.tracks add column if not exists lyrics text default '';
alter table public.tracks add column if not exists lyrics_updated_by text;
alter table public.tracks add column if not exists lyrics_updated_at timestamptz;
```

### (C) RLS 정책 (간단 팀공유용)
> 운영 전에는 인증 기반 정책으로 강화하세요.

```sql
alter table public.tracks enable row level security;
alter table public.versions enable row level security;
alter table public.feedback enable row level security;

create policy "public read tracks" on public.tracks for select using (true);
create policy "public write tracks" on public.tracks for insert with check (true);
create policy "public update tracks" on public.tracks for update using (true) with check (true);

create policy "public read versions" on public.versions for select using (true);
create policy "public write versions" on public.versions for insert with check (true);

create policy "public read feedback" on public.feedback for select using (true);
create policy "public write feedback" on public.feedback for insert with check (true);

```

## 2) 환경변수(키값) 설정 방식
앱은 `window.APP_CONFIG`를 읽습니다.

### 필요한 키
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_STORAGE_BUCKET` (기본값 `music-files`)

`config.example.js`를 참고해 `config.local.js`를 채우면 됩니다.

## 3) Vercel에서 변수 설정 (권장)
1. Vercel 프로젝트 → **Settings → Environment Variables**
2. 아래 3개를 추가
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_STORAGE_BUCKET`
3. 재배포하면 `vercel.json` + `npm run build`가 `public/` 폴더와 `public/config.local.js`를 자동 생성

> 즉, **Vercel에서는 GitHub 변수 없이도 동작**합니다. (Vercel 변수만 있으면 됨)

## 4) GitHub Pages에서 변수 설정
GitHub Pages는 런타임 환경변수를 직접 주입할 수 없어서, 필요 시 **GitHub Actions + Secrets**로 `config.local.js`를 생성해야 합니다.

1. GitHub Repo → **Settings → Secrets and variables → Actions**
2. Repository Secrets 추가
3. 워크플로우에서 빌드 중 `config.local.js` 생성

## 로컬 실행
```bash
python3 -m http.server 4173
```
브라우저에서 `http://localhost:4173` 열기.
