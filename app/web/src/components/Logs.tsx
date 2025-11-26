import type { LogEntry } from '../types';
import './Logs.css';

interface LogsProps {
  logs: LogEntry[];
}

export function Logs({ logs }: LogsProps) {
  return (
    <div className="panel">
      <div className="log-panel">
        {logs.map(log => (
          <div key={log.id} className={`log-entry ${log.type}`}>
            [{log.timestamp.toLocaleTimeString()}] {log.message}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="log-entry info">No activity yet</div>
        )}
      </div>
    </div>
  );
}
