# 네이버 블로그 자동화 프로그램 — 기술 설계서

## 1. 프로젝트 개요

- **한 줄 소개:** 네이버 블로그에 AI가 쓴 글을 하루 3회 자동/반자동 발행하는 데스크톱 앱
- **MVP 범위:** 글 생성 + AI 감지 우회 + 이미지 생성 + 자동 발행 + 스케줄링
- **지원 OS:** Windows / Mac
- **목적:** 수익(애드포스트) + 브랜딩, 네이버 홈판 노출
- **개발 방식:** 1인 개발, Claude Code 바이브 코딩

---

## 2. 기술 스택

| 영역 | 기술 | 이유 |
|---|---|---|
| 데스크톱 앱 | Electron | Windows/Mac 동시 지원, 브라우저 내장 |
| 브라우저 자동화 | Playwright | 네이버 키스트로크 입력 |
| 내장 브라우저 | Electron BrowserView | 앱 안에 네이버 에디터 임베드 |
| UI | HTML / CSS / 바닐라 JS | 심플, 프레임워크 불필요 |
| 로컬 DB | SQLite (better-sqlite3) | 글 이력 관리, 파일 1개 |
| AI 글 생성 | OpenAI GPT-4.1 mini | 속도/비용 최적 |
| AI 감지 우회 | GPT 2차 프롬프트 | 동일 API 재활용 |
| AI 이미지 | DALL-E 3 | GPT와 동일 API 키 |
| 이미지 합성 | sharp + canvas | 카드뉴스 텍스트 오버레이 |
| 트렌딩 키워드 | 네이버 DataLab API + Playwright 스크래핑 백업 | 즉시 사용 가능 |
| 스케줄링 | node-cron | Electron 내장, 랜덤화 처리 |
| 설정 저장 | dotenv + electron-store | API키/계정 암호화 저장 |
| 패키징 | electron-builder | .exe / .dmg 빌드 |

---

## 3. 프로젝트 구조

```
naver-blog-auto/
├── main/
│   ├── index.js                # 앱 실행 진입점
│   ├── scheduler.js            # 예약 발행 타이머 (node-cron)
│   ├── playwright/
│   │   ├── login.js            # 네이버 자동 로그인
│   │   └── publisher.js        # 네이버 에디터 자동 입력
│   ├── ai/
│   │   ├── writer.js           # GPT 글 생성
│   │   ├── humanizer.js        # AI 감지 우회 후처리
│   │   └── imageGen.js         # DALL-E 이미지 생성
│   ├── image/
│   │   └── composer.js         # 카드뉴스 텍스트 오버레이 합성
│   ├── keywords/
│   │   └── trending.js         # DataLab API + 스크래핑 백업
│   └── db/
│       ├── database.js         # SQLite 연결 및 쿼리
│       └── schema.sql          # 테이블 정의
├── renderer/
│   ├── dashboard.html          # 메인 대시보드
│   ├── write.html              # 글 생성 화면
│   ├── history.html            # 발행 이력
│   ├── settings.html           # 설정 화면
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── dashboard.js
│       ├── write.js
│       ├── history.js
│       └── settings.js
├── preload/
│   └── preload.js              # 화면 ↔ 메인 브릿지
├── assets/
│   └── generated/              # 생성된 이미지 임시 저장
├── .env                        # API 키, 네이버 계정 (절대 Git 업로드 금지)
├── .env.example                # 키 형식 예시
├── .gitignore
└── package.json
```

---

## 4. 화면 구성

| 화면 | 파일 | 역할 | 주요 구성 요소 |
|---|---|---|---|
| 메인 대시보드 | dashboard.html | 앱 시작 화면 | 발행 슬롯 3개, 트렌딩 키워드, 모드 선택 버튼 |
| 글 생성 | write.html | 키워드 입력 → 글 생성 → 발행 | 키워드 입력창, 스타일 선택, 글 미리보기/수정, 이미지 스타일 선택 |
| 발행 이력 | history.html | 과거 글 목록 | 날짜별 목록, 상태 표시, 글 내용 보기 |
| 설정 | settings.html | API 키, 계정, 발행 시간 | 네이버 ID/PW, OpenAI 키, DataLab 키, 기본 발행 시간 |

**화면 흐름:**
```
대시보드
├── [완전자동] → 글 생성 화면 (완전자동 모드)
├── [반자동]   → 글 생성 화면 (반자동 모드)
├── [이력]     → 발행 이력 화면
└── [설정]     → 설정 화면

글 생성 화면
├── 완전자동: 예약 생성 → 대시보드 복귀
└── 반자동: 네이버에 올리기 → BrowserView로 에디터 열림 → 사용자 직접 발행
```

---

## 5. DB 설계

### posts 테이블
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | 자동 증가 |
| keyword | TEXT | 입력한 키워드 |
| style | TEXT | 'emotional' / 'informative' |
| image_style | TEXT | 'card' / 'blog' |
| title | TEXT | AI 생성 제목 |
| content | TEXT | AI 생성 본문 |
| processed_content | TEXT | 후처리된 본문 |
| image_path | TEXT | 생성된 이미지 로컬 경로 |
| status | TEXT | 'draft' / 'scheduled' / 'published' / 'failed' |
| scheduled_at | DATETIME | 예약 발행 시간 |
| published_at | DATETIME | 실제 발행 시간 |
| created_at | DATETIME | 생성 시간 |

### settings 테이블
| 컬럼 | 타입 | 설명 |
|---|---|---|
| key | TEXT PK | 설정 키 이름 |
| value | TEXT | 설정 값 |

설정 키 예시: `morning_time`, `lunch_time`, `evening_time`

---

## 6. IPC 통신 채널 (화면 ↔ 메인 프로세스)

| 채널명 | 역할 |
|---|---|
| `keywords:fetch` | 트렌딩 키워드 요청 |
| `post:generate` | 글 생성 요청 |
| `post:humanize` | AI 감지 우회 후처리 요청 |
| `image:generate` | 이미지 생성 요청 |
| `post:schedule` | 예약 등록 요청 |
| `post:publish-now` | 즉시 발행 요청 (반자동) |
| `history:get` | 발행 이력 조회 |
| `settings:save` | 설정 저장 |

---

## 7. 개발 로드맵

### 1단계 — 뼈대 (반자동 모드 완성)
- [ ] Electron 프로젝트 초기 세팅
- [ ] `.env` 파일 세팅 (OpenAI 키, 네이버 계정)
- [ ] SQLite 연결 + posts/settings 테이블 생성
- [ ] 네이버 자동 로그인 (Playwright + 키스트로크 + 헤더 조작)
- [ ] GPT-4.1 mini 글 생성 (키워드 → 제목 + 본문)
- [ ] AI 감지 우회 후처리 (2차 GPT 프롬프트)
- [ ] 반자동 모드: BrowserView로 네이버 에디터 열고 글 자동 입력

**완료 기준:** 키워드 입력 → 글 생성 → 네이버 에디터에 자동 입력되는 것 확인

---

### 2단계 — 이미지 + 트렌딩 키워드
- [ ] DALL-E 3 이미지 생성 (블로그용 일반 이미지)
- [ ] sharp + canvas로 카드뉴스 텍스트 오버레이 합성
- [ ] 이미지 스타일 선택 UI (카드뉴스 / 일반)
- [ ] 네이버 DataLab API 연동 (트렌딩 키워드)
- [ ] Playwright 스크래핑 백업 연동
- [ ] 대시보드에 트렌딩 키워드 표시

**완료 기준:** 키워드 선택 → 글+이미지 자동 생성 → 네이버 에디터에 글+이미지 함께 입력 확인

---

### 3단계 — 완전자동 + UI 완성
- [ ] node-cron 스케줄러 구현 (±10분 랜덤화)
- [ ] 완전자동 모드 구현 (예약 → 백그라운드 발행)
- [ ] 대시보드 UI 완성 (발행 슬롯 3개, 상태 표시)
- [ ] 발행 이력 화면 구현
- [ ] 설정 화면 구현
- [ ] electron-builder로 .exe / .dmg 패키징

**완료 기준:** 앱 켜두면 지정 시간에 자동으로 글이 발행되는 것 확인

---

## 8. 환경변수 (.env)

```
NAVER_ID=네이버아이디
NAVER_PW=네이버비밀번호
OPENAI_API_KEY=sk-...
NAVER_DATALAB_CLIENT_ID=...
NAVER_DATALAB_CLIENT_SECRET=...
```

---

## 9. 미결 사항

| 항목 | 내용 |
|---|---|
| 네이버 보안문자 | 첫 로그인 시 캡챠 발생 가능 → 수동 처리 후 세션 유지 방식으로 대응 |
| DALL-E 비용 | 이미지 1장 약 $0.04 → 하루 3장 기준 월 약 $3.6 |
| DataLab API | developers.naver.com 앱 등록 후 즉시 사용 가능 |
| 글 작성 지침 | GPT 프롬프트 세부 지침은 개발 단계에서 결정 |
| 이미지 저장 정책 | assets/generated/ 에 누적 저장 → 용량 관리 방법 미정 |

---

## 10. 개발 시작 전 준비사항

1. Node.js 설치 (v18 이상)
2. `npm init` 후 패키지 설치:
   ```
   npm install electron playwright better-sqlite3 openai sharp canvas node-cron dotenv electron-store
   npm install --save-dev electron-builder
   ```
3. 네이버 개발자 센터 앱 등록 → DataLab API 키 발급
4. OpenAI 플랫폼 API 키 발급 + 결제 수단 등록
5. `.env` 파일 생성 후 키값 입력
