# 개인정보 처리방침

시행일: 2026-11-21 (안내문 버전 1)

Plugin Hub(이하 "앱")는 개인이 만든 오픈소스 데스크톱 앱입니다. 이 문서는 앱이 어떤 정보를 읽고, 어디에 저장하고, 무엇을 외부로 보내는지 설명합니다. 앱은 처음 실행할 때 이 내용을 요약해 보여 주고 동의를 받습니다.

## 1. 수집하지 않는 것

- 앱 개발자는 서버를 운영하지 않습니다. 이름, 이메일, 기기 식별자, 사용 통계, 오류 보고, 광고 식별자 등 어떤 정보도 개발자에게 전송되지 않습니다.
- 분석 도구, 광고, 추적 코드를 포함하지 않습니다.

## 2. 이 PC에서 읽는 정보

앱은 기능을 제공하기 위해 아래 파일을 이 PC 안에서만 읽습니다.

| 대상 | 위치 | 목적 |
|---|---|---|
| Claude Code 설정과 설치 기록 | `~/.claude/settings.json`, `~/.claude/plugins/` | 설치된 플러그인 목록, 켜짐 여부, 설정 문제 감지 |
| 설치된 플러그인 파일 | `~/.claude/plugins/cache/` | 스킬·명령 설명, 사용법 표시 |
| Claude 앱의 플러그인 목록 | macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\` | Claude 채팅 플러그인 목록 표시 |
| 사용자가 등록한 작업 폴더 | `<폴더>/.claude/settings(.local).json` | 폴더별 적용 상태 표시와 변경 |
| Claude Code 작업 폴더 목록 | `~/.claude.json`의 프로젝트 목록 | 작업 폴더 추천 |
| Claude Code 대화 기록 (선택) | `~/.claude/projects/` | 사용 분석. 아래 4항 참고 |

## 3. 이 PC에 저장하는 정보

앱은 아래 앱 데이터 폴더에만 자기 정보를 저장합니다.

- macOS: `~/Library/Application Support/dev.kimmj1234.pluginhub/`
- Windows: `%APPDATA%\dev.kimmj1234.pluginhub\`

저장 내용: 앱 설정과 폴더 구성(`hub-state.json`), 카탈로그 확인 기록(`catalog-seen.json`), AI가 만든 한국어 설명(`guides/`), AI 설명을 만들 때 쓰는 빈 작업 폴더(`guide-workdir/`), 설정 파일을 고치기 전 백업(`backups/`, 최대 20개).

이 밖에 macOS에서 "Claude 계정 로그인"을 누르면 로그인 명령을 담은 작은 스크립트(`plugin-hub-claude-login.command`)를 사용자 임시 폴더(`$TMPDIR`)에 만들어 터미널로 엽니다.

앱이 설정 파일을 고치는 경우는 사용자가 (1) 플러그인을 켜거나 끌 때, (2) 설정 점검 결과에서 "설정에서 항목 제거" 같은 수정 버튼을 누를 때, (3) 등록한 작업 폴더에서 폴더별 적용을 바꿀 때뿐입니다. 대상은 Claude Code 설정(`~/.claude/settings.json`)과 등록한 폴더의 `.claude/settings.json`, `.claude/settings.local.json`이며, 고치기 전에 백업을 남깁니다. 플러그인 설치·삭제·업데이트는 공식 Claude Code 프로그램이 수행합니다.

## 4. 사용 분석 (선택, 기본 꺼짐)

사용자가 동의한 경우에만, 최근 30일의 Claude Code 대화 기록 파일에서 플러그인 스킬·명령·에이전트·MCP 도구의 호출 횟수와 마지막 사용 시각만 셉니다.

- 대화 내용, 파일 내용, 질문과 답변은 저장하거나 전송하지 않습니다. 결과(플러그인별 횟수)는 앱이 실행 중인 동안 메모리에만 있습니다.
- 설정 > 개인정보에서 언제든 끌 수 있고, 끄면 대화 기록을 읽지 않습니다.
- Claude 앱 채팅의 기록은 이 PC에 저장되지 않으므로 포함되지 않습니다.

## 5. 외부로 연결하는 경우

| 언제 | 어디로 | 무엇을 |
|---|---|---|
| 플러그인 목록 자동 갱신 (기본 30분마다), 설치, 업데이트 | 공식 Claude Code가 GitHub와 각 플러그인 마켓플레이스에 접속 | 플러그인 저장소 요청 (Claude Code의 동작) |
| 앱 업데이트 확인 (시작 후, 6시간마다) | GitHub Releases (`github.com/kimmj1234/plugin-hub`) | 최신 버전 정보와 업데이트 파일 요청 |
| "한국어로 보기"를 눌렀을 때만 | 사용자의 Claude Code 계정을 통해 Anthropic | 해당 플러그인의 이름, 설명, 명령 설명, README 앞부분 |
| Claude 채팅 플러그인 설치 | 사용자의 Claude 앱 | 앱이 Claude 앱 화면에서 검색과 "추가"를 대신 누름 |

GitHub와 Anthropic의 정보 처리는 각 회사의 개인정보 처리방침을 따릅니다. 플러그인 목록 자동 갱신(설정 > 새 플러그인·업데이트 자동 확인)과 앱 업데이트 확인(설정 > 앱 업데이트)은 설정에서 끌 수 있습니다. 개인정보 안내에 동의하기 전에는 위 연결과 파일 읽기를 하나도 하지 않습니다.

## 6. 운영체제 권한

- macOS 손쉬운 사용: 사용자가 직접 허용한 경우에만, Claude 채팅 플러그인 자동 설치에서 Claude 앱의 검색창 입력과 "추가" 버튼 누르기에만 사용합니다. 다른 앱은 조작하지 않습니다. 허용하지 않으면 이 기능만 쓸 수 없습니다.
- 로그인 시 자동 실행: 사용자가 켠 경우에만 등록합니다(macOS LaunchAgent, Windows 시작 프로그램). 끄면 등록을 지웁니다.

## 7. 정보 삭제

앱을 지운 뒤 3항의 앱 데이터 폴더를 삭제하면 앱이 만든 정보가 모두 사라집니다. 로그인 시 자동 실행을 켰다면 지우기 전에 설정에서 끄거나, macOS는 `~/Library/LaunchAgents/Plugin Hub.plist`를 삭제합니다. Claude Code와 Claude 앱의 설정은 앱을 지워도 그대로 남습니다.

## 8. 아동

앱은 개발자 도구이며 아동을 대상으로 하지 않습니다.

## 9. 변경과 문의

이 방침이 바뀌면 이 문서와 앱의 안내문 버전을 함께 올리고, 앱이 다시 동의를 받습니다. 문의는 GitHub 저장소의 Issues로 해 주세요.

---

# Privacy Policy (English summary)

- Plugin Hub has no server. It sends nothing to the developer: no telemetry, analytics, ads, or crash reports.
- It reads Claude Code configuration and installed plugin files on your computer, the Claude desktop app's plugin list, and project folders you register, only to show and manage plugins.
- It stores its own settings, backups and generated guides only in the local app data folder.
- Optional usage analysis (off by default, opt-in) counts plugin skill/command calls in your local Claude Code transcripts. Conversation content is never stored or transmitted.
- Network access: the official Claude Code CLI contacts GitHub and plugin marketplaces; the app checks GitHub Releases for updates; plugin descriptions are sent to Anthropic through your own Claude Code account only when you press "한국어로 보기".
- macOS Accessibility permission, if you grant it, is used only to type the plugin name and press "Add" in the Claude app.
- Plugin Hub is an independent project and is not affiliated with Anthropic. Claude is a trademark of Anthropic.
