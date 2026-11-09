import React, { useEffect, useState } from 'react';
import { ApiClient } from '../api/client.js';

interface FileViewerModalProps {
  sessionId: string;
  filePath: string;
  onClose: () => void;
}

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  sessionId,
  filePath,
  onClose,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchFile = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await ApiClient.readFile(sessionId, filePath);
        if (active) {
          setContent(res.content);
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || 'Failed to read file');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchFile();
    return () => {
      active = false;
    };
  }, [sessionId, filePath]);

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-scrim)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
        padding: 'calc(16px + var(--safe-top)) 16px calc(16px + var(--safe-bottom)) 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: 'var(--surface)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'var(--surface-2)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              fontSize: 13,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '60%',
            }}
          >
            {filePath}
          </span>

          <div style={{ display: 'flex', gap: 8 }}>
            {content !== null && (
              <button
                onClick={handleCopy}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text)',
                  fontSize: 12,
                  fontWeight: 600,
                  minHeight: 36,
                }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                padding: '6px 12px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--muted)',
                fontSize: 12,
                fontWeight: 600,
                minHeight: 36,
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
              Loading file content...
            </div>
          ) : error ? (
            <div
              style={{
                padding: 16,
                borderRadius: 8,
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--warning)',
                color: 'var(--warning)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Cannot Display File</div>
              <div>{error}</div>
            </div>
          ) : (
            <pre
              style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
