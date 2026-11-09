import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useSessionStore } from '../store/session-store.js';
import { NewSessionSheet } from './NewSessionSheet.js';

export const SessionsScreen: React.FC = () => {
  const [showNewSheet, setShowNewSheet] = useState(false);
  const [, navigate] = useLocation();
  const { sessions, loadSessions, selectSession } = useSessionStore();

  useEffect(() => {
    loadSessions();
  }, []);

  const handleSelect = async (id: string) => {
    await selectSession(id);
    navigate(`/s/${id}`);
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Sessions</h1>
        <button
          onClick={() => setShowNewSheet(true)}
          style={{
            padding: '8px 14px',
            backgroundColor: 'var(--primary)',
            color: 'var(--on-primary)',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          + New Session
        </button>
      </div>

      <div style={{ flex: 1, padding: 16 }}>
        {sessions.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '70%',
              textAlign: 'center',
              color: 'var(--muted)',
            }}
          >
            <p style={{ fontSize: 16, marginBottom: 12 }}>No sessions yet</p>
            <button
              onClick={() => setShowNewSheet(true)}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                marginBottom: 16,
              }}
            >
              Start New Session
            </button>
            <p style={{ fontSize: 12 }}>
              Or run <code style={{ color: 'var(--text)' }}>tendril</code> in Termux inside your project folder.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => handleSelect(s.id)}
                style={{
                  padding: 14,
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>
                    {s.title || 'Untitled Session'}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: 4,
                      backgroundColor: 'var(--surface-2)',
                      color:
                        s.mode === 'plan'
                          ? 'var(--secondary)'
                          : s.mode === 'auto-edit'
                          ? 'var(--warning)'
                          : s.mode === 'yolo'
                          ? 'var(--error)'
                          : 'var(--text)',
                    }}
                  >
                    {s.mode}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                    📁 {s.workspace_path.split('/').pop()}
                  </span>
                  <span>{new Date(s.updated_at || s.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <NewSessionSheet
        isOpen={showNewSheet}
        onClose={() => setShowNewSheet(false)}
        onCreated={(id) => {
          handleSelect(id);
        }}
      />
    </div>
  );
};
