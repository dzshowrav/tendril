import React from 'react';

interface DiffViewerProps {
  diffUnified: string;
  path: string;
  addedLines?: number;
  removedLines?: number;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  diffUnified,
  path,
  addedLines = 0,
  removedLines = 0,
}) => {
  if (!diffUnified || !diffUnified.trim()) {
    return (
      <div style={{ padding: 16, color: 'var(--muted)', fontStyle: 'italic', fontSize: 13 }}>
        No changes or binary diff
      </div>
    );
  }

  const lines = diffUnified.split('\n');

  return (
    <div
      style={{
        backgroundColor: 'var(--code-bg)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        margin: '8px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          backgroundColor: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text)' }}>
          {path}
        </span>
        <div style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          {addedLines > 0 && <span style={{ color: 'var(--primary)' }}>+{addedLines}</span>}
          {removedLines > 0 && <span style={{ color: 'var(--error)' }}>-{removedLines}</span>}
        </div>
      </div>

      <pre
        style={{
          margin: 0,
          padding: '8px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.5,
          overflowX: 'auto',
        }}
      >
        {lines.map((line, idx) => {
          let bg = 'transparent';
          let color = 'var(--text)';
          let prefix = ' ';

          if (line.startsWith('+') && !line.startsWith('+++')) {
            bg = 'var(--diff-add-bg)';
            color = 'var(--primary)';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            bg = 'var(--diff-del-bg)';
            color = 'var(--error)';
          } else if (line.startsWith('@@')) {
            bg = 'var(--surface-2)';
            color = 'var(--secondary)';
          } else if (line.startsWith('---') || line.startsWith('+++')) {
            color = 'var(--muted)';
          }

          return (
            <div
              key={idx}
              style={{
                backgroundColor: bg,
                color,
                padding: '1px 12px',
                whiteSpace: 'pre',
                minWidth: 'fit-content',
              }}
            >
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
};
