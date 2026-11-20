import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, cliMessage, errorText } from "../api";
import { useHub } from "../hub";
import type { AcceptPrompt, Catalog, CatalogEntry } from "../types";

const PAGE = 60;

export function Discover() {
  const { snap, refresh, toast, withBusy, busy } = useHub();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mkt, setMkt] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [confirm, setConfirm] = useState<CatalogEntry | null>(null);
  const [accept, setAccept] = useState<{ entry: CatalogEntry; prompt: AcceptPrompt } | null>(null);
  const [mktSource, setMktSource] = useState("");

  const load = async (refreshIt: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await api.catalog(refreshIt));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
  }, []);

  const installedIds = new Set(snap?.plugins.filter((p) => p.surface === "cli" && p.installed).map((p) => p.id));
  const markets = useMemo(() => [...new Set(catalog?.entries.map((e) => e.marketplace))].sort(), [catalog]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = catalog?.entries ?? [];
    return list
      .filter((e) => (!mkt || e.marketplace === mkt) && (!q || `${e.name} ${e.description} ${e.pluginId}`.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (!q) return 0;
        const an = a.name.toLowerCase().includes(q) ? 0 : 1;
        const bn = b.name.toLowerCase().includes(q) ? 0 : 1;
        return an - bn;
      });
  }, [catalog, q, mkt]);

  useEffect(() => setLimit(PAGE), [q, mkt]);

  const doInstall = async (entry: CatalogEntry, sha?: string) => {
    setConfirm(null);
    setAccept(null);
    const r = await withBusy(entry.pluginId, "설치 중", () => api.install(entry.pluginId, sha));
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
      load(true);
    }
  };

  return (
    <div className="split">
      <div className="pane list-pane wide">
        <div className="toolbar">
          <input className="search" autoFocus placeholder="이름이나 용도로 검색 (예: test, deploy, design)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={mkt} onChange={(e) => setMkt(e.target.value)} aria-label="마켓플레이스">
            <option value="">모든 마켓플레이스</option>
            {markets.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={() => load(true)} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button>
        </div>

        <div className="muted small status-line">
          {catalog && `${filtered.length.toLocaleString()}개 / 전체 ${catalog.entries.length.toLocaleString()}개`}
          {catalog?.origin === "local-cache" && " · CLI가 없어 로컬 캐시를 보여줍니다 (설치 불가)"}
        </div>

        {error && <div className="note bad">{error}</div>}
        {loading && !catalog && <div className="empty">마켓플레이스에서 목록을 불러오는 중입니다…</div>}

        <ul className="plugin-list">
          {filtered.slice(0, limit).map((e) => (
            <li key={e.pluginId} className={selected?.pluginId === e.pluginId ? "selected" : ""} onClick={() => setSelected(e)}>
              <div className="pl-main">
                <div className="pl-name">{e.name}</div>
                <div className="pl-desc">{e.description}</div>
                <div className="pl-sub">{e.marketplace}{e.version && ` · v${e.version}`}</div>
              </div>
              {installedIds.has(e.pluginId) ? (
                <span className="badge ok">설치됨</span>
              ) : busy[e.pluginId] ? (
                <span className="spinner-text">{busy[e.pluginId]}…</span>
              ) : (
                e.installable && <button onClick={(ev) => { ev.stopPropagation(); setConfirm(e); }}>설치</button>
              )}
            </li>
          ))}
        </ul>
        {filtered.length > limit && <button className="more" onClick={() => setLimit(limit + PAGE)}>더 보기</button>}

        <div className="add-mkt">
          <h3>마켓플레이스 추가</h3>
          <p className="muted small">GitHub 저장소(<code>owner/repo</code>)나 Git URL을 입력하면 그 마켓플레이스의 플러그인도 검색됩니다.</p>
          <div className="row">
            <input placeholder="예: anthropics/claude-plugins-official" value={mktSource} onChange={(e) => setMktSource(e.target.value)} />
            <button onClick={addMarket} disabled={!mktSource.trim() || !!busy.mkt}>{busy.mkt ? "추가 중…" : "추가"}</button>
          </div>
        </div>
      </div>

      <div className="pane detail-pane">
        {selected ? (
          <div className="detail">
            <h2>{selected.name}</h2>
            <div className="muted mono">{selected.pluginId}</div>
            <p className="desc">{selected.description}</p>
            <div className="meta">
              <span className="badge">{selected.marketplace}</span>
              {selected.version && <span className="badge">v{selected.version}</span>}
            </div>
            <div className="actions">
              {installedIds.has(selected.pluginId) ? (
                <span className="badge ok">이미 설치됨 · '설치된 플러그인'에서 사용법을 볼 수 있습니다</span>
              ) : (
                selected.installable && <button className="primary" disabled={!!busy[selected.pluginId]} onClick={() => setConfirm(selected)}>설치</button>
              )}
              {selected.sourceUrl && /^https?:\/\//.test(selected.sourceUrl) && (
                <button onClick={() => openUrl(selected.sourceUrl!)}>소스 저장소 열기</button>
              )}
            </div>
            <p className="note">
              설치하면 공식 <code>claude plugin install</code> 명령으로 사용자 범위에 설치되고 바로 켜집니다. 플러그인은 내 컴퓨터에서 코드를 실행할 수 있으니 출처를 확인하세요.
            </p>
          </div>
        ) : (
          <div className="empty-detail">플러그인을 고르면 자세한 정보를 보여줍니다.</div>
        )}
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.name} 설치</h3>
            <p>
              <code>{confirm.pluginId}</code>을 사용자 범위에 설치합니다.
              {confirm.sourceUrl && <><br />출처: <span className="mono small">{confirm.sourceUrl}</span></>}
            </p>
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
