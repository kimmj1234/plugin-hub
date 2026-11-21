# 릴리스 절차

## 처음 한 번만

1. 업데이트 서명 키는 `.secrets/`에 있습니다(git에 올라가지 않음). **이 폴더를 안전한 곳에 백업하세요.** 키를 잃어버리면 이미 설치된 앱에 업데이트를 보낼 수 없습니다.
2. 저장소 Secrets에 키를 등록합니다(이미 등록됨).

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < .secrets/updater.key
```

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < .secrets/updater.password
```

## 새 버전 내기

1. 세 곳의 버전을 똑같이 올립니다: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. `RELEASE_NOTES.md`에 바뀐 점을 적습니다. 이 내용이 릴리스 설명과 앱의 업데이트 안내에 표시됩니다.
3. 의존성이 바뀌었다면 오픈소스 고지를 다시 만듭니다.

```bash
python3 scripts/gen-notices.py
```

4. 커밋하고 태그를 푸시합니다.

```bash
git tag v1.0.1 && git push origin main v1.0.1
```

5. GitHub Actions의 Release 워크플로가 macOS(유니버설)와 Windows 설치 파일, 업데이트 파일(`latest.json`과 서명)을 만들어 릴리스에 올리고 공개합니다.
6. 이미 설치된 앱은 설정에 따라 자동으로 업데이트되거나 알림을 띄웁니다.

## 코드 서명을 붙이려면 (선택)

- macOS: Apple Developer ID 인증서와 공증 정보를 저장소 Secrets(`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`)에 넣고 `release.yml`의 빌드 단계 env에 추가하면 Tauri가 서명과 공증을 합니다.
- Windows: 코드 서명 인증서를 `tauri.conf.json`의 `bundle.windows.certificateThumbprint` 또는 서명 명령(`signCommand`)으로 설정합니다.
