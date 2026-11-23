import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { selectable } from "../a11y";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, cliMessage, errorText } from "../api";
import { useHub } from "../hub";
import type { AcceptPrompt, CatalogEntry, Components, InstallScope } from "../types";
import { componentTokens, formatTokens, tokenWeight } from "../cost";
import { CATEGORIES, OTHER, POPULARITY_DATE, categorize, categoryById, formatStars, koDescription, stars, topPopular } from "../catalogMeta";
import { GuidePanel } from "../components/GuidePanel";
import { usableInApp } from "../claudeApp";
import { SurfaceLabel } from "../surface";

const PAGE = 60;
type Sort = "popular" | "new" | "name";
type Filter = "all" | "fresh" | "installed";
type Surface = "cli" | "desktop";
type Pending = { entry: CatalogEntry; search: string; repo: string | null; status: "running" | "added" | "permission" | "error" | "manual" | "guided"; error?: string };
const DIRECTORY = "anthropic-plugin-directory";
const SURFACE_LABEL: Record<Surface, string> = { cli: "Claude Code", desktop: "Claude 채팅" };

function loadSurface(): Surface {
  try {
    return localStorage.getItem("discover.surface") === "desktop" ? "desktop" : "cli";
  } catch {
    return "cli";
  }
}

interface Row extends CatalogEntry {
  cats: string[];
  stars: number | null;
  ko: string | null;
}

export function Discover({ openInstalled }: { openInstalled?: (pluginId: string) => void } = {}) {
  const { snap, refresh, toast, withBusy, busy, catalog, catalogLoading, catalogError, refreshCatalog, prefs, projects, addProject, perm, refreshPerm, remoteError } = useHub();
  const [instScope, setInstScope] = useState<InstallScope>("user");
  const [instProject, setInstProject] = useState<string>("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [mkt, setMkt] = useState("");
  const [sort, setSort] = useState<Sort>("popular");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  // 설치 전 구성 미리보기: undefined = 불러오는 중, null = 알 수 없음
  const [preview, setPreview] = useState<Components | null | undefined>(undefined);
  const [accept, setAccept] = useState<{ entry: CatalogEntry; prompt: AcceptPrompt } | null>(null);
  const [mktSource, setMktSource] = useState("");
  const [surface, setSurfaceState] = useState<Surface>(loadSurface);
  const [pending, setPending] = useState<Pending | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const setSurface = (s: Surface) => {
    setSurfaceState(s);
    setSelectedId(null);
    setMkt("");
    try {
      localStorage.setItem("discover.surface", s);
    } catch {
      return;
    }
  };

  const cliIds = useMemo(() => new Set(snap?.plugins.filter((p) => p.surface === "cli" && p.installed).map((p) => p.id)), [snap]);
  const appPlugins = useMemo(() => snap?.plugins.filter((p) => p.surface === "desktop") ?? [], [snap]);
  const appNames = useMemo(() => new Set(appPlugins.flatMap((p) => [p.displayName.toLowerCase(), p.id.toLowerCase()])), [appPlugins]);
  const inApp = (e: CatalogEntry) =>
    appNames.has(e.name.toLowerCase()) || appNames.has(e.pluginId.toLowerCase()) || (!!e.appName && appNames.has(e.appName.toLowerCase()));
  const installedOn = (e: CatalogEntry, s: Surface) => (s === "cli" ? cliIds.has(e.pluginId) : inApp(e));
  const other: Surface = surface === "cli" ? "desktop" : "cli";
  const appMarkets = useMemo(() => new Set([DIRECTORY, ...appPlugins.map((p) => p.marketplace)]), [appPlugins]);

  const { allRows, appOnly } = useMemo(() => {
    const entries = catalog?.entries ?? [];
    const names = new Set(entries.flatMap((e) => [e.name.toLowerCase(), e.pluginId.toLowerCase()]));
    const extra: CatalogEntry[] = appPlugins
      .filter((p) => !names.has(p.displayName.toLowerCase()) && !names.has(p.id.toLowerCase()))
      .map((p) => ({
        pluginId: p.id,
        name: p.displayName,
        description: p.description,
        marketplace: p.marketplace,
        version: p.version,
        sourceUrl: p.repository ?? p.homepage,
        installable: false,
        directoryId: null,
        appName: null,
        surfaces: ["cowork", "claude_ai"],
        isNew: false,
        updated: false,
        firstSeen: 0,
      }));
    const allRows: Row[] = [...entries, ...extra].map((e) => ({
      ...e,
      cats: categorize(e.name, e.description),
      stars: stars(e.sourceUrl),
      ko: koDescription(e.pluginId),
    }));
    return { allRows, appOnly: new Set(extra.map((e) => e.pluginId)) };
  }, [catalog, appPlugins]);

  const rows = useMemo(
    () => (surface === "cli" ? allRows.filter((e) => !appOnly.has(e.pluginId)) : allRows.filter((e) => inApp(e) || appOnly.has(e.pluginId) || (usableInApp(e) ?? appMarkets.has(e.marketplace)))),
    [allRows, appOnly, surface, appMarkets, appNames],
  );
  const installedCount = (s: Surface) => (s === "cli" ? cliIds.size : appPlugins.length);

  const marketRepo = (e: CatalogEntry) => {
    if (e.marketplace === DIRECTORY) return null;
    const src = snap?.marketplaces.find((m) => m.name === e.marketplace)?.source ?? "";
    return /^[\w.-]+\/[\w.-]+$/.test(src) || /^https:\/\/[\w.-]+(\/[\w.-]+){2,}$/.test(src) ? src : null;
  };
  const installInApp = async (e: CatalogEntry) => {
    const search = e.appName || e.name;
    const repo = marketRepo(e);
    if (repo) {
      setPending({ entry: e, search, repo, status: "manual" });
      try {
        await api.openInClaudeApp("add-marketplace", repo, e.name);
      } catch (err) {
        toast("error", errorText(err));
      }
      return;
    }
    // Windows 등 자동 설치를 지원하지 않는 곳: Claude 앱 디렉터리를 열고 무엇을 누를지 안내한다
    if (perm && perm.os !== "macos") {
      setPending({ entry: e, search, repo: null, status: "guided" });
      api.openInClaudeApp("directory").catch((err) => toast("error", errorText(err)));
      return;
    }
    // 손쉬운 사용 권한이 없으면 시도하지 않고 설정 안내부터 보여 준다 (권한 없이는 이 기능을 쓸 수 없음)
    const p = (await refreshPerm()) ?? perm;
    if (p && p.accessibility === false) {
      setPending({ entry: e, search, repo: null, status: "permission" });
      return;
    }
    setPending({ entry: e, search, repo: null, status: "running" });
    try {
      const r = await api.installInClaudeApp(search, e.sourceUrl);
      setPending((p) => (p && p.entry.pluginId === e.pluginId ? { ...p, status: "added" } : p));
      toast("ok", r === "already" ? `${search}: 이미 Claude 앱에 추가되어 있습니다` : `${search}: Claude 앱에 설치했습니다`);
      getCurrentWindow().setFocus().catch(() => undefined);
    } catch (err) {
      const msg = errorText(err);
      const status = msg.includes("NEEDS_ACCESSIBILITY") ? "permission" : "error";
      setPending((p) => (p && p.entry.pluginId === e.pluginId ? { ...p, status, error: status === "error" ? msg : undefined } : p));
      getCurrentWindow().setFocus().catch(() => undefined);
    }
  };
  const pendingDone = pending ? inApp(pending.entry) : false;

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const c of r.cats) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  }, [rows]);

  const markets = useMemo(() => [...new Set(rows.map((e) => e.marketplace))].sort(), [rows]);
  const freshCount = rows.filter((r) => r.isNew || r.updated).length;

  const q = query.trim().toLowerCase();
  const inScope = useMemo(
    () =>
      rows.filter(
        (e) =>
          (cat === "all" || e.cats.includes(cat)) &&
          (!mkt || e.marketplace === mkt) &&
          (filter !== "fresh" || e.isNew || e.updated) &&
          (filter !== "installed" || installedOn(e, surface)) &&
          (!q || `${e.name} ${e.description} ${e.ko ?? ""} ${e.pluginId}`.toLowerCase().includes(q)),
      ),
    [rows, cat, mkt, filter, q, surface, cliIds, appNames],
  );

  const sorted = useMemo(() => {
    const list = [...inScope];
    if (sort === "popular") list.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1));
    else if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => Number(b.isNew || b.updated) - Number(a.isNew || a.updated) || b.firstSeen - a.firstSeen);
    if (q) list.sort((a, b) => Number(!a.name.toLowerCase().includes(q)) - Number(!b.name.toLowerCase().includes(q)));
    return list;
  }, [inScope, sort, q]);

  const top = useMemo(() => (q || filter !== "all" ? [] : topPopular(inScope, 5)), [inScope, q, filter]);
  const topIds = new Set(top.map((t) => t.pluginId));
  const rest = sorted.filter((e) => !topIds.has(e.pluginId));
  const selected = rows.find((r) => r.pluginId === selectedId) ?? null;

  useEffect(() => setLimit(PAGE), [q, mkt, cat, filter, sort]);

  const openConfirm = (e: Row) => {
    setInstScope(prefs.defaultInstallScope);
    setInstProject(prefs.defaultInstallProject ?? projects[0]?.path ?? "");
    setConfirm(e);
    setPreview(undefined);
    api.preview(e.pluginId).then(setPreview).catch(() => setPreview(null));
  };

  const doInstall = async (entry: CatalogEntry, sha?: string) => {
    if (instScope !== "user" && !instProject) {
      toast("error", "설치할 폴더를 고르세요");
      return;
    }
    setConfirm(null);
    setAccept(null);
    const r = await withBusy(entry.pluginId, "설치 중", () =>
      api.install(entry.pluginId, { acceptSha: sha, scope: instScope, projectPath: instScope === "user" ? null : instProject }),
    );
    if (!r) return;
    if (r.needsAccept) {
      setAccept({ entry, prompt: r.needsAccept });
      return;
    }
    toast(r.ok ? "ok" : "error", r.ok ? `${entry.name}을(를) 설치했습니다. '내 플러그인에서 열기'로 쓰는 법을 볼 수 있습니다.` : `${entry.name} 설치: ${cliMessage(r)}`);
    refresh();
  };

  const addMarket = async () => {
    const r = await withBusy("mkt", "추가 중", () => api.addMarketplace(mktSource));
    if (!r) return;
    toast(r.ok ? "ok" : "error", `마켓플레이스 추가: ${cliMessage(r)}`);
    if (r.ok) {
      setMktSource("");
      refresh();
      refreshCatalog(false);
    }
  };

  const renderRow = (e: Row, rank?: number) => {
    const here = installedOn(e, surface);
    const there = installedOn(e, other);
    return (
      <li key={e.pluginId} className={`${selectedId === e.pluginId ? "selected" : ""} ${rank ? "top" : ""}`} {...selectable(() => setSelectedId(e.pluginId), selectedId === e.pluginId)}>
        {rank && <div className="rank">{rank}</div>}
        <div className="pl-main">
          <div className="pl-name">
            {e.name}
            {e.isNew && <span className="badge new">NEW</span>}
            {e.updated && !here && <span className="badge upd" title="공식 디렉터리에 최근 7일 안에 새 버전이 올라온 플러그인입니다. 내가 설치한 플러그인의 업데이트 알림이 아닙니다.">새 버전 출시</span>}
            {there && <span className="badge" title={`${SURFACE_LABEL[other]}에도 설치되어 있습니다`}>{SURFACE_LABEL[other]}에도 있음</span>}
          </div>
          <div className="pl-desc">{e.ko ?? e.description}</div>
          <div className="pl-sub">
            {e.cats.slice(0, 3).map((c) => categoryById(c).label).join(" · ")}
            {" · "}★ {formatStars(e.stars)}
            {e.version && ` · v${e.version}`}
          </div>
        </div>
        {here ? (
          <span className="badge ok">설치됨</span>
        ) : busy[e.pluginId] ? (
          <span className="spinner-text">{busy[e.pluginId]}…</span>
        ) : surface === "cli" ? (
          e.installable && (
            <button
              disabled={!!perm && !perm.cli}
              title={perm && !perm.cli ? "Claude Code가 필요합니다. 설정 > 권한·준비 상태에서 확인하세요." : undefined}
              onClick={(ev) => { ev.stopPropagation(); openConfirm(e); }}
            >
              설치
            </button>
          )
        ) : (
          <button onClick={(ev) => { ev.stopPropagation(); installInApp(e); }} title="Claude 앱에 자동으로 설치합니다">앱에 설치</button>
        )}
      </li>
    );
  };

  const catList = [...CATEGORIES, OTHER].filter((c) => catCounts.get(c.id));
  const extraActive = Number(filter !== "all") + Number(!!mkt);

  return (
    <div className="split">
      <div className="pane list-pane wide">
        <div className="seg surface-seg" role="tablist" aria-label="설치 대상">
          {(["cli", "desktop"] as Surface[]).map((s) => (
            <button key={s} role="tab" aria-selected={surface === s} className={surface === s ? "active" : ""} onClick={() => setSurface(s)}>
              <SurfaceLabel s={s} count={installedCount(s)} countSuffix="개 설치" />
            </button>
          ))}
        </div>
        {pending && (
          <div className={`note install-guide ${pendingDone ? "ok" : ""}`} role="status">
            {pendingDone ? (
              <>
                <strong>✅ {pending.search} 설치 완료</strong>
                <p className="small">Claude 앱에 설치된 것을 확인했습니다. '내 플러그인 → Claude 채팅'에서 쓰는 법을 볼 수 있습니다.</p>
                <button onClick={() => setPending(null)}>닫기</button>
              </>
            ) : (
              <>
                {pending.status === "running" && (
                  <>
                    <strong><span className="spinner-text">'{pending.search}' Claude 앱에 설치하는 중…</span></strong>
                    <p className="small">Claude 앱이 열리고 검색 → 플러그인 화면 → 추가가 자동으로 진행됩니다. 끝날 때까지 키보드와 마우스를 잠시 쓰지 마세요.</p>
                  </>
                )}
                {pending.status === "added" && (
                  <>
                    <strong>'{pending.search}' Claude 앱에 추가했습니다</strong>
                    <p className="small">Claude 앱이 파일을 내려받는 중입니다. 끝나면 '설치 완료'로 바뀝니다.</p>
                  </>
                )}
                {pending.status === "permission" && (
                  <>
                    <strong>자동 설치에 '손쉬운 사용' 권한이 필요합니다</strong>
                    <ol className="small">
                      <li>아래 <strong>권한 요청</strong>을 누르면 macOS가 Plugin Hub를 손쉬운 사용 목록에 올리고 설정을 엽니다.</li>
                      <li>목록에서 <strong>Plugin Hub</strong>를 켭니다. (없으면 + 를 눌러 응용 프로그램의 Plugin Hub를 추가)</li>
                      <li>돌아와서 <strong>다시 시도</strong>를 누릅니다.</li>
                    </ol>
                    <p className="muted small">이 권한으로 Plugin Hub는 '설치'를 누른 플러그인을 Claude 앱 디렉터리에서 찾아 추가 버튼을 대신 누릅니다. 그 밖의 앱이나 화면은 조작하지 않습니다.</p>
                    <div className="row">
                      <button className="primary" onClick={() => api.requestAccessibility().catch((e) => toast("error", errorText(e)))}>권한 요청</button>
                      <button onClick={() => api.openAccessibilitySettings().catch((e) => toast("error", errorText(e)))}>설정 열기</button>
                      <button onClick={() => installInApp(pending.entry)}>다시 시도</button>
                      <button className="link" onClick={() => setPending(null)}>취소</button>
                    </div>
                  </>
                )}
                {pending.status === "error" && (
                  <>
                    <strong>'{pending.search}' 자동 설치를 끝내지 못했습니다</strong>
                    <p className="small">{pending.error}</p>
                    <p className="muted small">Claude 앱 디렉터리에서 '{pending.search}'를 검색해 직접 추가해도 됩니다.</p>
                    <div className="row">
                      <button className="primary" onClick={() => installInApp(pending.entry)}>다시 시도</button>
                      <button className="link" onClick={() => setPending(null)}>닫기</button>
                    </div>
                  </>
                )}
                {pending.status === "guided" && (
                  <>
                    <strong>'{pending.search}' Claude 앱에서 추가하기</strong>
                    <ol className="small">
                      <li>Claude 앱에 디렉터리가 열렸습니다. 위쪽 검색창에 <strong>{pending.search}</strong>를 입력합니다.</li>
                      <li>결과에서 <strong>{pending.search}</strong>를 누른 뒤 <strong>추가</strong>를 누릅니다.</li>
                      <li>추가가 끝나면 여기에 자동으로 "설치 완료"가 표시됩니다.</li>
                    </ol>
                    <div className="row">
                      <button className="primary" onClick={() => installInApp(pending.entry)}>Claude 앱 다시 열기</button>
                      <button className="link" onClick={() => setPending(null)}>닫기</button>
                    </div>
                  </>
                )}
                {pending.status === "manual" && (
                  <>
                    <strong>'{pending.search}' Claude 앱에서 설치하기</strong>
                    <ol className="small">
                      <li>Claude 앱에 <strong>마켓플레이스 추가</strong> 창이 열렸습니다. URL에 <code className="mono">{pending.repo}</code>가 들어가 있습니다.</li>
                      <li><strong>동기화</strong>를 누른 뒤 목록에서 <strong>{pending.search}</strong>의 <strong>추가</strong>를 누릅니다.</li>
                    </ol>
                    <div className="row">
                      <button className="primary" onClick={() => installInApp(pending.entry)}>Claude 앱 다시 열기</button>
                      <button className="link" onClick={() => setPending(null)}>취소</button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        <div className="toolbar find-bar">
          <input className="search" autoFocus placeholder="하고 싶은 일로 검색 (예: 배포)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="분야">
            <option value="all">모든 분야</option>
            {catList.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.label} ({catCounts.get(c.id)})</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
            <option value="popular">인기순</option>
            <option value="new">최근 추가순</option>
            <option value="name">이름순</option>
          </select>
          <button className={`filter-toggle ${moreOpen || extraActive ? "active" : ""}`} onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}>
            필터{extraActive ? ` ${extraActive}` : ""}
          </button>
        </div>

        {moreOpen && (
          <div className="filter-more">
            <div className="seg">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>모두</button>
              <button className={filter === "fresh" ? "active" : ""} onClick={() => setFilter("fresh")} title="공식 디렉터리에 최근 7일 안에 새로 올라왔거나 새 버전이 나온 플러그인입니다. 내 플러그인 업데이트는 '내 플러그인'에서 확인합니다.">디렉터리 새 소식{freshCount > 0 && <span className="count">{freshCount}</span>}</button>
              <button className={filter === "installed" ? "active" : ""} onClick={() => setFilter("installed")}>설치됨</button>
            </div>
            <select value={mkt} onChange={(e) => setMkt(e.target.value)} aria-label="마켓플레이스">
              <option value="">모든 마켓플레이스</option>
              {markets.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={() => refreshCatalog(true)} disabled={catalogLoading} title="마켓플레이스 원본까지 다시 받아 새 플러그인·업데이트를 확인합니다">
              {catalogLoading ? "확인 중…" : "새로 확인"}
            </button>
          </div>
        )}

        {(cat !== "all" || extraActive > 0 || q) && (
          <div className="active-filters">
            {q && <button className="chip active" onClick={() => setQuery("")}>“{query.trim()}” ✕</button>}
            {cat !== "all" && <button className="chip active" onClick={() => setCat("all")}>{categoryById(cat).label} ✕</button>}
            {filter !== "all" && <button className="chip active" onClick={() => setFilter("all")}>{filter === "fresh" ? "디렉터리 새 소식" : "설치됨"} ✕</button>}
            {mkt && <button className="chip active" onClick={() => setMkt("")}>{mkt} ✕</button>}
            <button className="link" onClick={() => { setQuery(""); setCat("all"); setFilter("all"); setMkt(""); }}>모두 지우기</button>
          </div>
        )}
        {!moreOpen && filter === "all" && freshCount > 0 && (
          <button className="link fresh-link" onClick={() => setFilter("fresh")}>디렉터리 새 소식 {freshCount}개 보기 (최근 7일)</button>
        )}

        <div className="muted small status-line">
          {catalog && `${sorted.length.toLocaleString()}개 · ${surface === "cli" ? "터미널과 Claude 앱 Code 탭에 함께 설치됩니다" : "Claude 앱 채팅·Cowork용 · '앱에 설치'로 자동 설치"}`}
          {catalog && ` · ${new Date(catalog.fetchedAt).toLocaleTimeString()} 갱신 · ${prefs.remoteRefreshMinutes > 0 ? `${prefs.remoteRefreshMinutes >= 60 ? `${prefs.remoteRefreshMinutes / 60}시간` : `${prefs.remoteRefreshMinutes}분`}마다 자동 확인` : "자동 확인 꺼짐"}`}
        </div>
        {catalog?.origin === "local-cache" && (
          <div className="note warn small">
            Claude Code에서 최신 목록을 받지 못해, 이 PC에 저장된 목록을 보여 줍니다. 지금은 설치할 수 없습니다.
            {catalog.fallbackReason && <div className="muted">이유: {catalog.fallbackReason}</div>}
          </div>
        )}
        {remoteError && catalog?.origin !== "local-cache" && (
          <div className="note warn small">
            마켓플레이스 원본을 확인하지 못해, 마지막으로 받은 목록을 보여 줍니다. 인터넷 연결을 확인하고 "새로 확인"을 눌러 보세요.
            <div className="muted">이유: {remoteError}</div>
          </div>
        )}

        {catalogError && <div className="note bad">{catalogError}</div>}
        {catalogLoading && !catalog && <div className="empty">마켓플레이스에서 목록을 불러오는 중입니다…</div>}

        {top.length > 0 && (
          <section className="top-section">
            <h3>
              {cat === "all" ? "전체" : categoryById(cat).label} 인기 TOP {top.length}
              <span className="muted small"> GitHub 스타 기준 ({POPULARITY_DATE} 수집)</span>
            </h3>
            <ul className="plugin-list">{top.map((e, i) => renderRow(e as Row, i + 1))}</ul>
          </section>
        )}

        <ul className="plugin-list">{rest.slice(0, limit).map((e) => renderRow(e))}</ul>
        {rest.length > limit && <button className="more" onClick={() => setLimit(limit + PAGE)}>더 보기 ({(rest.length - limit).toLocaleString()}개 남음)</button>}
        {catalog && sorted.length === 0 && <div className="empty">조건에 맞는 플러그인이 없습니다.</div>}

        {surface === "cli" && <div className="add-mkt">
          <h3>마켓플레이스 추가</h3>
          <p className="muted small">GitHub 저장소(<code>owner/repo</code>)나 Git URL을 입력하면 그 마켓플레이스의 플러그인도 검색됩니다.</p>
          <div className="row">
            <input placeholder="예: anthropics/claude-plugins-official" value={mktSource} onChange={(e) => setMktSource(e.target.value)} />
            <button onClick={addMarket} disabled={!mktSource.trim() || !!busy.mkt}>{busy.mkt ? "추가 중…" : "추가"}</button>
          </div>
        </div>}
      </div>

      <div className="pane detail-pane">
        {selected ? (
          <div className="detail">
            <h2>
              {selected.name}
              {selected.isNew && <span className="badge new">NEW</span>}
              {selected.updated && <span className="badge upd" title="공식 디렉터리에 최근 7일 안에 새 버전이 올라온 플러그인입니다. 내가 설치한 플러그인의 업데이트 알림이 아닙니다.">새 버전 출시</span>}
            </h2>
            <div className="muted mono">{selected.pluginId}</div>
            {selected.ko && <p className="desc ko">{selected.ko}</p>}
            <p className={selected.ko ? "muted small" : "desc"}>{selected.description}</p>
            <div className="meta">
              {selected.cats.map((c) => (
                <button key={c} className="badge chip-link" onClick={() => setCat(c)}>{categoryById(c).icon} {categoryById(c).label}</button>
              ))}
              <span className="badge">★ {formatStars(selected.stars)}</span>
              <span className="badge">{selected.marketplace}</span>
              {selected.version && <span className="badge">v{selected.version}</span>}
            </div>
            <div className="actions">
              {installedOn(selected, surface) ? (
                <>
                  <span className="badge ok">{SURFACE_LABEL[surface]}에 설치됨</span>
                  {openInstalled && surface === "cli" && <button className="primary" onClick={() => openInstalled(selected.pluginId)}>내 플러그인에서 열기</button>}
                </>
              ) : surface === "cli" ? (
                selected.installable && <button className="primary" disabled={!!busy[selected.pluginId]} onClick={() => openConfirm(selected)}>설치</button>
              ) : (
                <button className="primary" onClick={() => installInApp(selected)}>Claude 앱에 설치</button>
              )}
              {installedOn(selected, other) && <span className="badge">{SURFACE_LABEL[other]}에도 설치됨</span>}
              {selected.sourceUrl && /^https?:\/\//.test(selected.sourceUrl) && (
                <button onClick={() => openUrl(selected.sourceUrl!).catch((e) => toast("error", errorText(e)))}>소스 저장소 열기</button>
              )}
            </div>
            <section>
              <h3>한국어 가이드</h3>
              <GuidePanel key={selected.pluginId} id={selected.pluginId} version={selected.version} installed={false} name={selected.name} description={selected.description} />
            </section>
            <p className="note">
              {surface === "desktop"
                ? "'Claude 앱에 설치'를 누르면 Plugin Hub가 Claude 앱 디렉터리에서 이 플러그인을 찾아 추가하고, Claude 앱이 바로 내려받습니다. 처음 한 번은 macOS '손쉬운 사용' 권한을 허용해야 합니다. 설치 후 '내 플러그인 → Claude 채팅'에서 쓰는 법을 볼 수 있습니다."
                : <>설치하면 공식 <code>claude plugin install</code> 명령으로 고른 범위(PC 전체 또는 폴더)에 설치되고 바로 켜집니다. 플러그인은 내 컴퓨터에서 코드를 실행할 수 있으니 출처를 확인하세요.</>}
            </p>
          </div>
        ) : (
          <div className="empty-detail">
            왼쪽에서 분야를 고르면 그 분야의 인기 플러그인부터 보여줍니다.
            <br />
            플러그인을 누르면 한국어 설명과 설치 버튼이 나옵니다.
          </div>
        )}
      </div>

      {confirm && (
        <Modal title={`${confirm.name} 설치`} onClose={() => setConfirm(null)}>
            {confirm.ko ? <p className="desc ko">{confirm.ko}</p> : confirm.description && <p className="small">{confirm.description}</p>}
            <div className="meta">
              {confirm.stars !== null && <span className="badge" title={`GitHub 스타 (${POPULARITY_DATE} 기준)`}>★ {formatStars(confirm.stars)}</span>}
              {confirm.version && <span className="badge">v{confirm.version}</span>}
              <span className="badge">{confirm.marketplace === DIRECTORY ? "공식 디렉터리" : confirm.marketplace}</span>
              {preview === undefined && <span className="badge">구성 확인 중…</span>}
              {preview && <PreviewBadges c={preview} />}
            </div>
            {preview === null && <p className="muted small">이 플러그인은 설치할 때 내려받기 때문에 매 세션 토큰과 훅·MCP 구성은 설치 후 '내 플러그인'에서 확인할 수 있습니다.</p>}
            <p className="small">
              <code>{confirm.pluginId}</code>
              {confirm.sourceUrl && <><br />출처: <span className="mono small">{confirm.sourceUrl}</span></>}
            </p>
            <p className="note warn small">
              플러그인은 내 컴퓨터에서 코드를 실행할 수 있습니다. 믿을 수 있는 출처인지 확인한 뒤 설치하세요.
              {preview && preview.hooks.length > 0 && <> 이 플러그인에는 Claude Code가 동작하는 중에 자동으로 실행되는 훅 {preview.hooks.length}개({preview.hooks.slice(0, 3).join(", ")}{preview.hooks.length > 3 ? " 등" : ""})가 있습니다.</>}
            </p>
            <div className="scope-choice">
              <div className="small"><strong>어디에 적용할까요?</strong></div>
              {([
                ["user", "PC 전체", "모든 폴더에서 쓰입니다"],
                ["local", "특정 폴더 · 나만", "그 폴더에서 나에게만"],
                ["project", "특정 폴더 · 팀 공유", "그 폴더의 설정 파일에 기록되어, 폴더를 함께 쓰는 팀원(git)도 쓰게 됩니다"],
              ] as [InstallScope, string, string][]).map(([v, l, d]) => (
                <label key={v} className="radio">
                  <input type="radio" name="inst-scope" checked={instScope === v} onChange={() => setInstScope(v)} />
                  <span><strong>{l}</strong> <span className="muted small">· {d}</span></span>
                </label>
              ))}
              {instScope !== "user" && (
                <div className="row indent">
                  <select value={instProject} onChange={(e) => setInstProject(e.target.value)} aria-label="설치할 폴더">
                    <option value="">폴더 선택…</option>
                    {projects.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}
                  </select>
                  <button onClick={async () => { const path = await api.pickFolder(); if (path && (await addProject(path))) setInstProject(path); }}>다른 폴더…</button>
                </div>
              )}
            </div>
            <div className="actions end">
              <button data-autofocus onClick={() => setConfirm(null)}>취소</button>
              <button className="primary" onClick={() => doInstall(confirm)}>설치</button>
            </div>
        </Modal>
      )}

      {accept && (
        <Modal title="추가 확인이 필요합니다" onClose={() => setAccept(null)} dismissOnBackdrop={false}>
            <p>이 플러그인은 설치 과정에서 마켓플레이스가 지정한 명령을 실행합니다. 아래 내용을 확인한 뒤에만 진행하세요.</p>
            <pre className="mono small">{accept.prompt.detail}</pre>
            <div className="actions end">
              <button data-autofocus onClick={() => setAccept(null)}>취소</button>
              <button className="danger" onClick={() => doInstall(accept.entry, accept.prompt.sha256)}>확인하고 설치</button>
            </div>
        </Modal>
      )}
    </div>
  );
}

function PreviewBadges({ c }: { c: Components }) {
  const n = componentTokens(c);
  const w = tokenWeight(n);
  const parts = [c.skills.length && `스킬 ${c.skills.length}`, c.commands.length && `명령 ${c.commands.length}`, c.agents.length && `에이전트 ${c.agents.length}`].filter(Boolean);
  return (
    <>
      <span className={`badge cost ${w.level}`} title={`설치하면 매 세션 컨텍스트에 들어가는 양(추정). ${w.hint}`}>{w.label} · 매 세션 약 {formatTokens(n)} 토큰</span>
      {parts.length > 0 && <span className="badge">{parts.join(" · ")}</span>}
      {c.hooks.length > 0 && <span className="badge warn">훅 {c.hooks.length}</span>}
      {c.mcpServers.length > 0 && <span className="badge">MCP 서버 {c.mcpServers.length}</span>}
    </>
  );
}
