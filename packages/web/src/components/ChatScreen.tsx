import React, { useState, useEffect, useRef } from 'react';
import { useRoute } from 'wouter';
import { useSessionStore } from '../store/session-store.js';
import { MarkdownView } from './MarkdownView.js';
import { PermissionSheet } from './PermissionSheet.js';

export const ChatScreen: React.FC = () => {
  const [, params] = useRoute('/s/:id');
  const sessionId = params?.id;

  const [input, setInput] = useState('');
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    activeSession,
    messages,
    streamingAssistantText,
    activeTool,
    turnStatus,
    selectSession,
    sendMessage,
    abortCurrentTurn,
  } = useSessionStore();

  useEffect(() => {
    if (sessionId && (!activeSession || activeSession.id !== sessionId)) {
      selectSession(sessionId);
    }
  }, [sessionId]);

  // Auto-scroll to bottom on new messages or streaming tokens
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
      setShowJumpToBottom(false);
    } else {
      setShowJumpToBottom(true);
    }
  }, [messages, streamingAssistantText, activeTool]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setShowJumpToBottom(!isNearBottom);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setShowJumpToBottom(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || turnStatus === 'running') return;

    setInput('');
    await sendMessage(text);
  };

  const isRunning = turnStatus === 'running' || turnStatus === 'awaiting_permission';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Messages Scroll Area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px 80px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {messages.map((msg, idx) => {
          let text = '';
          try {
            const blocks = JSON.parse(msg.content_json);
            if (Array.isArray(blocks)) {
              text = blocks
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n');
            }
          } catch {
            text = msg.content_json || '';
          }

          const isUser = msg.role === 'user';

          return (
            <div
              key={msg.id || idx}
              style={{
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: isUser ? '85%' : '100%',
                backgroundColor: isUser ? 'var(--surface-2)' : 'transparent',
                padding: isUser ? '10px 14px' : '0px',
                borderRadius: 8,
                border: isUser ? '1px solid var(--border)' : 'none',
              }}
            >
              {isUser ? (
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{text}</div>
              ) : (
                <MarkdownView content={text} />
              )}
            </div>
          );
        })}

        {/* Live Active Tool Card */}
        {activeTool && (
          <div
            style={{
              padding: 12,
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ color: 'var(--secondary)', fontWeight: 600 }}>▸ {activeTool.tool}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>running...</span>
            </div>
            {activeTool.output.length > 0 && (
              <pre
                style={{
                  maxHeight: 120,
                  overflowY: 'auto',
                  backgroundColor: 'var(--code-bg)',
                  padding: 8,
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--muted)',
                }}
              >
                {activeTool.output.slice(-10).join('')}
              </pre>
            )}
          </div>
        )}

        {/* Live Streaming Delta */}
        {streamingAssistantText && (
          <div style={{ alignSelf: 'flex-start', width: '100%' }}>
            <MarkdownView content={streamingAssistantText} />
          </div>
        )}
      </div>

      {/* Floating Jump to Latest Button */}
      {showJumpToBottom && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: 90,
            right: 20,
            padding: '8px 14px',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 10,
          }}
        >
          ↓ Jump to latest
        </button>
      )}

      {/* Bottom Composer */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          padding: '12px 16px',
          paddingBottom: 'calc(12px + var(--safe-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--secondary)' }}>
            {activeSession?.mode || 'ask'}
          </span>
          <span>·</span>
          <span>{activeSession?.model}</span>
        </div>

        <form onSubmit={handleSend} style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder={isRunning ? 'Agent is working...' : 'Type a message...'}
            disabled={isRunning}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              padding: '10px 12px',
              maxHeight: 100,
              fontSize: 14,
            }}
          />

          {isRunning ? (
            <button
              type="button"
              onClick={abortCurrentTurn}
              style={{
                padding: '10px 16px',
                backgroundColor: 'var(--error)',
                color: '#fff',
                fontWeight: 600,
              }}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              style={{
                padding: '10px 16px',
                backgroundColor: 'var(--primary)',
                color: 'var(--on-primary)',
                fontWeight: 600,
              }}
            >
              Send
            </button>
          )}
        </form>
      </div>

      {/* Permission Approval Modal Sheet */}
      <PermissionSheet />
    </div>
  );
};
