import { Fragment, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

const MAX_SOURCE = 200_000;
const MAX_INLINE = 10_000;

// HTML 주석을 정규식 없이 지운다. `<!--`만 잔뜩 있고 닫히지 않는 README로 화면이 멈추는 것(정규식 DoS)을 막는다.
export function stripComments(src: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const start = src.indexOf("<!--", pos);
    if (start < 0) return out + src.slice(pos);
    out += src.slice(pos, start);
    const end = src.indexOf("-->", start + 4);
    if (end < 0) return out; // 닫히지 않은 주석 뒤는 버린다
    pos = end + 3;
  }
}

function inline(text: string, key: string): ReactNode[] {
  // 아주 긴 한 줄은 꾸밈 없이 보여 준다 (정규식이 오래 걸리는 입력 방지)
  if (text.length > MAX_INLINE) return [text];
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
          <a key={k} href="#" onClick={(e) => { e.preventDefault(); openUrl(href).catch(() => {}); }}>
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
  const lines = stripComments(source.slice(0, MAX_SOURCE)).split("\n");
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
