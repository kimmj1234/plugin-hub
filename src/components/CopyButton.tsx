import { useState } from "react";

export function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy"
      title={`${text} 복사`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* 클립보드 권한이 없으면 무시 */
        }
      }}
    >
      {done ? "복사됨" : label}
    </button>
  );
}
