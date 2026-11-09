import React, { useEffect, useState, useCallback } from 'react';
import { useRoute, useLocation } from 'wouter';
import { ApiClient } from '../api/client.js';
import { DiffViewer } from './DiffViewer.js';
import { ConflictDialog } from './ConflictDialog.js';

interface ChangeItem {
  id: string;
  session_id: string;
  tool_run_id: string;
  path: string;
  diff_unified: string;
  added_lines: number;
  removed_lines: number;
  undone_at: string | null;
  created_at: string;
}

export const ChangesScreen: React.FC = () => {
  const [, params] = useRoute('/s/:id/changes');
  const [, navigate] = useLocation();
  const sessionId = params?.id || '';

  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Conflict modal state
  const [conflictChange, setConflictChange] = useState<ChangeItem | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  const fetchChanges = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await ApiClient.listChanges(sessionId);
      setChanges(res.changes || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load changes');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchChanges();
    // 1-second polling to ensure edits made by agent appear within 1s
    const interval = setInterval(fetchChanges, 1000);
    return () => clearInterval(interval);
  }, [fetchChanges]);

  const handleUndo = async (change: ChangeItem, force = false) => {
    setIsUndoing(true);
    try {
      await ApiClient.undoChange(sessionId, change.tool_run_id, force);
      // Close conflict dialog if open
      setConflictChange(null);
      // Update local state to undone
      setChanges((prev) =>
        prev.map((c) =>
          c.id === change.id ? { ...c, undone_at: new Date().toISOString() } : c,
        ),
      );
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 'conflict' || err?.needsForce) {
        // Trigger conflict dialog
        setConflictChange(change);
      } else {
        alert(err?.message || 'Failed to undo change');
      }
    } finally {
      setIsUndoing(false);
    }
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
          Changes ({changes.length})
        </button>
        <button
          onClick={() => navigate(`/s/${sessionId}/files`)}
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
          Files
        </button>
      </div>

      <div style={{ padding: 16, flex: 1 }}>
        {loading && changes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            Loading changes...
          </div>
        ) : error ? (
          <div style={{ padding: 16, color: 'var(--error)', backgroundColor: 'var(--surface)', borderRadius: 8 }}>
            {error}
          </div>
        ) : changes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>No file edits yet</div>
            <div style={{ fontSize: 13 }}>Changes made by the agent will appear here with diffs and undo.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {changes.map((change) => {
              const isUndone = Boolean(change.undone_at);
              const isExpanded = expandedId === change.id;

              return (
                <div
                  key={change.id}
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 12,
                      cursor: 'pointer',
                    }}
                    onClick={() => setExpandedId(isExpanded ? null : change.id)}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                            fontSize: 13,
                            color: 'var(--text)',
                            wordBreak: 'break-all',
                          }}
                        >
                          {change.path}
                        </span>
                        {isUndone ? (
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              backgroundColor: 'var(--surface-2)',
                              color: 'var(--muted)',
                              borderRadius: 4,
                            }}
                          >
                            Undone
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              backgroundColor: 'rgba(61, 220, 151, 0.15)',
                              color: 'var(--primary)',
                              borderRadius: 4,
                            }}
                          >
                            Applied
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                        <span>+{change.added_lines} / -{change.removed_lines} lines</span>
                        <span>•</span>
                        <span>{new Date(change.created_at).toLocaleTimeString()}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {!isUndone && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUndo(change);
                          }}
                          disabled={isUndoing}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: 'var(--surface-2)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            color: 'var(--warning)',
                            fontSize: 12,
                            fontWeight: 600,
                            minHeight: 36,
                          }}
                        >
                          Undo
                        </button>
                      )}
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '0 12px 12px 12px', borderTop: '1px solid var(--border)' }}>
                      <DiffViewer
                        diffUnified={change.diff_unified}
                        path={change.path}
                        addedLines={change.added_lines}
                        removedLines={change.removed_lines}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {conflictChange && (
        <ConflictDialog
          filePath={conflictChange.path}
          isSubmitting={isUndoing}
          onCancel={() => setConflictChange(null)}
          onForceUndo={() => handleUndo(conflictChange, true)}
        />
      )}
    </div>
  );
};
