import type { TraceItem } from "../../lib/types.js";

export function TracesPage({
  runId,
  traces,
  onRunIdChange,
  onLoad
}: {
  runId: string;
  traces: TraceItem[];
  onRunIdChange: (value: string) => void;
  onLoad: () => void;
}): React.JSX.Element {
  return (
    <div className="stack">
      <div className="card stack">
        <label>Run ID</label>
        <input value={runId} onChange={(event) => onRunIdChange(event.target.value)} />
        <button className="action" onClick={onLoad}>
          Load traces
        </button>
      </div>
      {traces.map((trace, index) => (
        <div className="card" key={`${trace.runId}:${trace.timestamp}:${index}`}>
          <strong>{trace.eventType}</strong>
          <div className="muted">{trace.timestamp}</div>
          <pre>{JSON.stringify(trace.payload, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
