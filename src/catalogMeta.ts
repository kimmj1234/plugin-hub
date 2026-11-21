import koCatalog from "./data/ko-catalog.json";
import popularity from "./data/popularity.json";

export interface Category {
  id: string;
  label: string;
  icon: string;
  re: RegExp;
}

export const CATEGORIES: Category[] = [
  { id: "dev", label: "개발 워크플로", icon: "🛠️", re: /feature[- ]dev|develop|refactor|codebase|scaffold|boilerplate|framework|laravel|react|next\.?js|vue|svelte|django|rails|flutter|swift|android|ios\b|mobile app|backend|frontend dev|monorepo|개발/i },
  { id: "review", label: "코드 리뷰·품질", icon: "🔍", re: /review|lint|code quality|simplif|clean[- ]?code|best practice|pull request|\bpr\b|refine|리뷰|품질/i },
  { id: "test", label: "테스트·디버깅", icon: "🧪", re: /\btest|debug|\btdd\b|\bqa\b|e2e|end-to-end|playwright|cypress|\bbug|테스트|디버깅/i },
  { id: "devops", label: "Git·배포·인프라", icon: "🚀", re: /\bgit\b|github|gitlab|commit|deploy|ci\/cd|\bci\b|pipeline|docker|kubernetes|\bk8s\b|terraform|devops|infra|\baws\b|azure|gcp|vercel|netlify|cloudflare|release|배포/i },
  { id: "lsp", label: "언어 서버(LSP)", icon: "🔤", re: /\blsp\b|language server/i },
  { id: "design", label: "디자인·UI", icon: "🎨", re: /design|\bui\b|\bux\b|frontend|front-end|css|tailwind|figma|animation|theme|icon|디자인/i },
  { id: "data", label: "데이터·분석", icon: "📊", re: /\bdata|\bsql\b|analytic|dashboard|visuali[sz]|database|bigquery|postgres|mysql|snowflake|spreadsheet|excel|csv|데이터|분석/i },
  { id: "docs", label: "문서·글쓰기", icon: "📝", re: /\bdocs?\b|documentation|writing|\bwrite|content|blog|readme|markdown|\bpdf\b|copywrit|humaniz|translat|문서|글쓰기/i },
  { id: "business", label: "마케팅·영업", icon: "📣", re: /marketing|\bseo\b|sales|\bcrm\b|campaign|brand|growth|outreach|\bads\b|\bgtm\b|customer|e-?commerce|shopify|마케팅|영업/i },
  { id: "legal", label: "법무·컴플라이언스", icon: "⚖️", re: /legal|\blaw\b|contract|compliance|privacy|gdpr|regulat|patent|trademark|litigation|법무/i },
  { id: "finance", label: "재무·투자", icon: "💰", re: /financ|accounting|invest|equity|banking|valuation|\bdcf\b|\blbo\b|\bfund|\btax|budget|ledger|reconcil|crypto|trading|재무|투자/i },
  { id: "science", label: "연구·과학", icon: "🔬", re: /research|\bbio|clinical|drug|pubmed|scien|paper|academic|genom|medic|chem|math|연구/i },
  { id: "productivity", label: "생산성·협업", icon: "📅", re: /productiv|\btask|calendar|email|meeting|slack|notion|linear|asana|jira|project manag|\bnotes?\b|todo|obsidian|telegram|discord|imessage|생산성|협업/i },
  { id: "integration", label: "외부 서비스 연동(MCP)", icon: "🔌", re: /\bmcp\b|integration|connector|\bapi\b|webhook/i },
  { id: "security", label: "보안", icon: "🛡️", re: /secur|vulnerab|\bxss\b|secret|owasp|pentest|threat|보안/i },
  { id: "ai", label: "AI·에이전트·Claude 확장", icon: "🤖", re: /\bagents?\b|\bllm|prompt|\bsdk\b|skills?\b|subagent|\bhooks?\b|plugin dev|\bevals?\b|claude\.md|memory|output style|에이전트/i },
  { id: "media", label: "이미지·영상·미디어", icon: "🎬", re: /image|video|audio|music|media|remotion|photo|\b3d\b|game|illustrat|영상|이미지/i },
];

export const OTHER: Category = { id: "other", label: "기타", icon: "📦", re: /$^/ };

export function categorize(name: string, description: string): string[] {
  const text = `${name} ${description}`;
  const ids = CATEGORIES.filter((c) => c.re.test(text)).map((c) => c.id);
  return ids.length ? ids : [OTHER.id];
}

export function categoryById(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? OTHER;
}

const repos = (popularity as { collectedAt: string; repos: Record<string, number> }).repos;
export const POPULARITY_DATE = (popularity as { collectedAt: string }).collectedAt;

export function repoKey(url: string | null | undefined): string | null {
  const m = /github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/i.exec(url ?? "");
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export function stars(url: string | null | undefined): number | null {
  const k = repoKey(url);
  return k && k in repos ? repos[k] : null;
}

export function formatStars(n: number | null): string {
  if (n === null) return "-";
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const ko = koCatalog as Record<string, string>;

const koByName = new Map<string, string>();
for (const [id, text] of Object.entries(ko)) {
  const name = id.split("@")[0];
  if (!koByName.has(name)) koByName.set(name, text);
}

const OFFICIAL = new Set(["anthropic-plugin-directory", "claude-plugins-official"]);

// 공식 플러그인은 두 공식 마켓플레이스 이름 중 어느 쪽으로 설치돼도 한국어 요약을 찾는다.
// (다른 마켓플레이스의 같은 이름 플러그인은 내용이 다를 수 있어 쓰지 않는다)
export function koDescription(pluginId: string): string | null {
  const [name, market] = pluginId.split("@");
  return ko[pluginId] ?? (OFFICIAL.has(market) ? koByName.get(name) : undefined) ?? null;
}

export function topPopular<T extends { sourceUrl: string | null }>(list: T[], n = 5): T[] {
  const ranked = list
    .map((e) => ({ e, s: stars(e.sourceUrl) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => b.s! - a.s!);
  const perRepo = new Map<string, number>();
  const out: T[] = [];
  for (const { e } of ranked) {
    const k = repoKey(e.sourceUrl) ?? "";
    const c = perRepo.get(k) ?? 0;
    if (c >= 2) continue;
    perRepo.set(k, c + 1);
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}
