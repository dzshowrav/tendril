import React from 'react';

interface ConflictDialogProps {
  filePath: string;
  onCancel: () => void;
  onForceUndo: () => void;
  isSubmitting?: boolean;
}

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  filePath,
  onCancel,
  onForceUndo,
  isSubmitting = false,
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--warning)',
          borderRadius: 12,
          padding: 20,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--warning)', margin: 0 }}>
            File Modified On Disk
          </h3>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, marginBottom: 16 }}>
          <strong style={{ fontFamily: 'var(--font-mono)' }}>{filePath}</strong> has been edited on disk
          since this snapshot was created.
        </p>

        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, marginBottom: 20 }}>
          Forcing undo will discard all external edits made after this change and restore the snapshot state.
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              padding: '10px 16px',
              backgroundColor: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
              fontWeight: 600,
              minHeight: 44,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onForceUndo}
            disabled={isSubmitting}
            style={{
              padding: '10px 16px',
              backgroundColor: 'var(--error)',
              border: 'none',
              borderRadius: 6,
              color: '#FFF',
              fontSize: 13,
              fontWeight: 700,
              minHeight: 44,
            }}
          >
            {isSubmitting ? 'Restoring...' : 'Force Undo'}
          </button>
        </div>
      </div>
    </div>
  );
};
