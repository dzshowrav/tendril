import React, { useEffect, useState, useCallback } from 'react';
import { useRoute, useLocation } from 'wouter';
import { ApiClient } from '../api/client.js';
import { FileViewerModal } from './FileViewerModal.js';

interface DirEntry {
  name: string;
  path: string;
}

interface FileEntry {
  name: string;
  path: string;
  size: number;
}

export const FilesScreen: React.FC = () => {
  const [, params] = useRoute('/s/:id/files');
  const [, navigate] = useLocation();
  const sessionId = params?.id || '';

  const [currentPath, setCurrentPath] = useState('.');
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected file for viewer modal
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  const fetchFiles = useCallback(async (dirPath: string) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.listFiles(sessionId, dirPath);
      setDirs(res.dirs || []);
      setFiles(res.files || []);
      setCurrentPath(res.path || dirPath);
    } catch (err: any) {
      setError(err?.message || 'Failed to list directory');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchFiles(currentPath);
  }, [fetchFiles, currentPath]);

  const handleNavigateUp = () => {
    if (currentPath === '.' || currentPath === '') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.length > 0 ? parts.join('/') : '.';
    setCurrentPath(parent);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg)',
        overflowY: 'auto',
      }}
    >
      {/* Session Tab Bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          backgroundColor: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => navigate(`/s/${sessionId}`)}
          style={{
            flex: 1,
            padding: '12px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: '2px solid transparent',
            color: 'var(--muted)',
            fontWeight: 600,
            fontSize: 13,
            minHeight: 48,
          }}
        >
          Chat
        </button>
        <button
          onClick={() => navigate(`/s/${sessionId}/changes`)}
          style={{
            flex: 1,
            padding: '12px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: '2px solid transparent',
            color: 'var(--muted)',
            fontWeight: 600,
            fontSize: 13,
            minHeight: 48,
          }}
        >
          Changes
        </button>
        <button
          style={{
            flex: 1,
            padding: '12px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: '2px solid var(--primary)',
            color: 'var(--primary)',
            fontWeight: 700,
            fontSize: 13,
            minHeight: 48,
          }}
        >
          Files
        </button>
      </div>

      {/* Path Breadcrumbs / Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          backgroundColor: 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text)',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--muted)' }}>📁</span>
        <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>
          {currentPath === '.' ? '/' : `/${currentPath}`}
        </span>
      </div>

      {/* Directory Contents */}
      <div style={{ flex: 1, padding: 12 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            Loading files...
          </div>
        ) : error ? (
          <div style={{ padding: 16, color: 'var(--error)', backgroundColor: 'var(--surface)', borderRadius: 8 }}>
            {error}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {currentPath !== '.' && currentPath !== '' && (
              <div
                onClick={handleNavigateUp}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 12px',
                  backgroundColor: 'var(--surface)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  minHeight: 44,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--muted)',
                }}
              >
                <span>⬆️</span>
                <span>.. (Parent directory)</span>
              </div>
            )}

            {dirs.length === 0 && files.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
                Directory is empty
              </div>
            )}

            {/* Subdirectories */}
            {dirs.map((d) => (
              <div
                key={d.path}
                onClick={() => setCurrentPath(d.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 12px',
                  backgroundColor: 'var(--surface)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  minHeight: 48,
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 16 }}>📁</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name}
                  </span>
                </div>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
              </div>
            ))}

            {/* Files */}
            {files.map((f) => (
              <div
                key={f.path}
                onClick={() => setViewingFile(f.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 12px',
                  backgroundColor: 'var(--surface)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  minHeight: 48,
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 16 }}>📄</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}
                  </span>
                </div>
                <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>
                  {formatSize(f.size)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {viewingFile && (
        <FileViewerModal
          sessionId={sessionId}
          filePath={viewingFile}
          onClose={() => setViewingFile(null)}
        />
      )}
    </div>
  );
};
