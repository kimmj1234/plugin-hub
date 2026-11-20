import { Fragment, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * 플러그인 README는 외부에서 온 내용이라 HTML로 주입하지 않는다.
 * 자주 쓰는 마크다운(제목, 목록, 코드, 굵게, 링크)만 React 요소로 직접 만든다.
 */

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("`")) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(tok)!;
      const safe = /^https?:\/\//.test(href);
      out.push(
        safe ? (
          <a key={k} href="#" onClick={(e) => { e.preventDefault(); openUrl(href); }}>
            {label}
          </a>
        ) : (
          <span key={k}>{label}</span>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++}><code>{body.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length + 2, 6);
      const Tag = `h${level}` as "h3";
      blocks.push(<Tag key={key++}>{inline(h[2], `h${key}`)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((it, j) => <li key={j}>{inline(it, `li${key}-${j}`)}</li>)}
        </ul>,
      );
      continue;
    }
    if (line.trim() === "" || /^\s*(<[^>]+>|\|?\s*-{3,})/.test(line)) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#|```|\s*[-*]\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (para.length === 0) { i++; continue; }
    blocks.push(<p key={key++}>{inline(para.join(" "), `p${key}`)}</p>);
  }
  return <div className="markdown">{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}
