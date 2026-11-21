import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, cliMessage, errorText } from "../api";
import { useHub } from "../hub";
import type { AcceptPrompt, CatalogEntry, InstallScope } from "../types";
import { CATEGORIES, OTHER, POPULARITY_DATE, categorize, categoryById, formatStars, koDescription, stars, topPopular } from "../catalogMeta";
import { GuidePanel } from "../components/GuidePanel";
import { entryRef, usableInApp } from "../claudeApp";

const PAGE = 60;
type Sort = "popular" | "new" | "name";
type Filter = "all" | "fresh" | "installed";
type Surface = "cli" | "desktop";
const DIRECTORY = "anthropic-plugin-directory";
const SURFACE_LABEL: Record<Surface, string> = { cli: "터미널", desktop: "Claude 앱" };

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

export function Discover() {
  const { snap, refresh, toast, withBusy, busy, catalog, catalogLoading, catalogError, refreshCatalog, prefs, projects, addProject } = useHub();
  const [instScope, setInstScope] = useState<InstallScope>("user");
  const [instProject, setInstProject] = useState<string>("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [mkt, setMkt] = useState("");
  const [sort, setSort] = useState<Sort>("popular");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CatalogEntry | null>(null);
  const [accept, setAccept] = useState<{ entry: CatalogEntry; prompt: AcceptPrompt } | null>(null);
  const [mktSource, setMktSource] = useState("");
  const [surface, setSurfaceState] = useState<Surface>(loadSurface);
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
  const inApp = (e: CatalogEntry) => appNames.has(e.name.toLowerCase()) || appNames.has(e.pluginId.toLowerCase());
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

  const installInApp = async (e: CatalogEntry) => {
    const ref = entryRef(e);
    try {
      await api.openInClaudeApp(ref ? "plugin" : "plugins", ref);
      toast("info", `Claude 앱에서 ${e.name}의 '설치'를 누르면 여기에도 바로 반영됩니다`);
    } catch (err) {
      toast("error", errorText(err));
    }
  };

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

  const openConfirm = (e: CatalogEntry) => {
    setInstScope(prefs.defaultInstallScope);
    setInstProject(prefs.defaultInstallProject ?? projects[0]?.path ?? "");
    setConfirm(e);
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
    toast(r.ok ? "ok" : "error", `${entry.name} 설치: ${cliMessage(r)}`);
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
      <li key={e.pluginId} className={`${selectedId === e.pluginId ? "selected" : ""} ${rank ? "top" : ""}`} onClick={() => setSelectedId(e.pluginId)}>
        {rank && <div className="rank">{rank}</div>}
        <div className="pl-main">
          <div className="pl-name">
            {e.name}
            {e.isNew && <span className="badge new">NEW</span>}
            {e.updated && <span className="badge upd">업데이트</span>}
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
          e.installable && <button onClick={(ev) => { ev.stopPropagation(); openConfirm(e); }}>설치</button>
        ) : (
          <button onClick={(ev) => { ev.stopPropagation(); installInApp(e); }} title="Claude 앱의 이 플러그인 화면을 엽니다">앱에 설치</button>
        )}
      </li>
    );
  };

  const catList = [...CATEGORIES, OTHER].filter((c) => catCounts.get(c.id));

  return (
    <div className="split">
      <div className="pane list-pane wide">
        <div className="seg surface-seg" role="tablist" aria-label="설치 대상">
          {(["cli", "desktop"] as Surface[]).map((s) => (
            <button key={s} role="tab" aria-selected={surface === s} className={surface === s ? "active" : ""} onClick={() => setSurface(s)}>
              {s === "cli" ? "💻 터미널·Claude Code" : "🖥️ Claude 앱"} <span className="count">{installedCount(s)}개 설치</span>
            </button>
          ))}
        </div>
        <p className="muted small surface-help">
          {surface === "cli"
            ? "터미널과 Claude 앱의 Code 탭이 함께 쓰는 플러그인입니다(~/.claude). 여기서 바로 설치할 수 있습니다."
            : "Claude 앱의 채팅·Cowork에서 쓸 수 있는 플러그인입니다. '앱에 설치'를 누르면 Claude 앱의 해당 화면이 열리고, 설치하면 여기에 바로 반영됩니다."}
        </p>

        <div className="toolbar">
          <input className="search" autoFocus placeholder="이름·용도로 검색 (한국어 가능: 배포, 테스트, 디자인…)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button onClick={() => refreshCatalog(true)} disabled={catalogLoading} title="마켓플레이스 원본까지 다시 받아 새 플러그인·업데이트를 확인합니다">
            {catalogLoading ? "확인 중…" : "새로 확인"}
          </button>
        </div>

        <div className="chips" role="tablist" aria-label="용도별 분류">
          <button className={`chip ${cat === "all" ? "active" : ""}`} onClick={() => setCat("all")}>전체 <span className="count">{rows.length.toLocaleString()}</span></button>
          {catList.map((c) => (
            <button key={c.id} className={`chip ${cat === c.id ? "active" : ""}`} onClick={() => setCat(c.id)}>
              {c.icon} {c.label} <span className="count">{catCounts.get(c.id)}</span>
            </button>
          ))}
        </div>

        <div className="toolbar small-row">
          <div className="seg">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>모두</button>
            <button className={filter === "fresh" ? "active" : ""} onClick={() => setFilter("fresh")}>새로 생김·업데이트 {freshCount > 0 && <span className="count bad">{freshCount}</span>}</button>
            <button className={filter === "installed" ? "active" : ""} onClick={() => setFilter("installed")}>설치됨</button>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
            <option value="popular">인기순 (GitHub ★)</option>
            <option value="new">최근 추가순</option>
            <option value="name">이름순</option>
          </select>
          <select value={mkt} onChange={(e) => setMkt(e.target.value)} aria-label="마켓플레이스">
            <option value="">모든 마켓플레이스</option>
            {markets.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="muted small status-line">
          {catalog && `${sorted.length.toLocaleString()}개`}
          {catalog && ` · ${new Date(catalog.fetchedAt).toLocaleTimeString()} 갱신 · ${prefs.remoteRefreshMinutes > 0 ? `${prefs.remoteRefreshMinutes >= 60 ? `${prefs.remoteRefreshMinutes / 60}시간` : `${prefs.remoteRefreshMinutes}분`}마다 자동 확인` : "자동 확인 꺼짐"}`}
          {catalog?.origin === "local-cache" && " · CLI가 없어 로컬 캐시를 보여줍니다 (설치 불가)"}
        </div>

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
              {selected.updated && <span className="badge upd">업데이트</span>}
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
                <span className="badge ok">{SURFACE_LABEL[surface]}에 설치됨 · '설치된 플러그인'에서 슬래시 명령과 사용법을 볼 수 있습니다</span>
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
                ? "'Claude 앱에 설치'를 누르면 Claude 앱의 이 플러그인 화면이 열립니다. 앱에서 '설치'를 한 번 누르면 끝나고, 설치되면 이 화면에 바로 표시됩니다. 앱 플러그인은 계정에 연결되어 있어 마지막 설치 확인은 보안상 Claude 앱에서 합니다. 설치 후 '설치된 플러그인 → Claude 앱'에서 쓰는 법을 볼 수 있습니다."
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
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.name} 설치</h3>
            <p>
              <code>{confirm.pluginId}</code>
              {confirm.sourceUrl && <><br />출처: <span className="mono small">{confirm.sourceUrl}</span></>}
            </p>
            <div className="scope-choice">
              <div className="small"><strong>어디에 적용할까요?</strong></div>
              {([
                ["user", "PC 전체", "모든 폴더에서 쓰입니다"],
                ["local", "특정 폴더 · 나만", "그 폴더에서 나에게만"],
                ["project", "특정 폴더 · 팀 공유", "그 폴더의 git 설정으로 팀원과 공유"],
              ] as [InstallScope, string, string][]).map(([v, l, d]) => (
                <label key={v} className="radio">
                  <input type="radio" name="inst-scope" checked={instScope === v} onChange={() => setInstScope(v)} />
                  <span><strong>{l}</strong> <span className="muted small">— {d}</span></span>
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
              <button onClick={() => setConfirm(null)}>취소</button>
              <button className="primary" onClick={() => doInstall(confirm)}>설치</button>
            </div>
          </div>
        </div>
      )}

      {accept && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>추가 확인이 필요합니다</h3>
            <p>이 플러그인은 설치 과정에서 마켓플레이스가 지정한 명령을 실행합니다. 아래 내용을 확인한 뒤에만 진행하세요.</p>
            <pre className="mono small">{accept.prompt.detail}</pre>
            <div className="actions end">
              <button onClick={() => setAccept(null)}>취소</button>
              <button className="danger" onClick={() => doInstall(accept.entry, accept.prompt.sha256)}>확인하고 설치</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
