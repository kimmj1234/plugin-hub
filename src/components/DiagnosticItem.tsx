import { useHub } from "../hub";
import type { Diagnostic } from "../types";

const ICON = { error: "⛔", warning: "⚠️", info: "ℹ️" } as const;

export function DiagnosticItem({ d }: { d: Diagnostic }) {
  const { runFix, busy } = useHub();
  const b = busy[d.id] ?? (d.pluginId ? busy[d.pluginId] : undefined);
  return (
    <div className={`diag ${d.severity}`}>
      <div className="diag-icon" aria-hidden>{ICON[d.severity]}</div>
      <div className="diag-body">
        <div className="diag-title">{d.title}</div>
        <div className="diag-detail">{d.detail}</div>
      </div>
      {d.fix && (
        <button disabled={!!b} onClick={() => runFix(d)}>
          {b ? `${b}…` : d.fix.label}
        </button>
      )}
    </div>
  );
}
