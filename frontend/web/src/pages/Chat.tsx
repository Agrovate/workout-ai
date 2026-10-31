import { useEffect, useRef, useState } from 'react';
import {
  listChatSessions,
  createChatSession,
  getChatSession,
  deleteChatSession,
  postChatMessage,
} from '../api/client';
import type { ChatSessionOut, ChatMessageOut } from '../types/api';
import './Chat.css';

// Remembers which chat was open so reloading the page resumes it instead of
// always landing on a blank new chat — a per-browser convenience, not shared
// state, so it's fine to keep in localStorage rather than the backend.
const LAST_SESSION_KEY = 'workout-ai:last-chat-session-id';

export function Chat() {
  const [sessions, setSessions] = useState<ChatSessionOut[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    (async () => {
      try {
        const existing = await listChatSessions();
        setSessions(existing);

        let savedId: number | null = null;
        try {
          savedId = Number(localStorage.getItem(LAST_SESSION_KEY)) || null;
        } catch {
          // localStorage unavailable (private window, blocked) — fall through
        }
        const target = existing.find((s) => s.id === savedId) ?? existing[0];

        if (target) {
          await openSession(target.id);
        } else {
          await startNewChat(existing);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chats.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function rememberSession(id: number) {
    try {
      localStorage.setItem(LAST_SESSION_KEY, String(id));
    } catch {
      // ignore — resuming on reload is a convenience, not a requirement
    }
  }

  async function openSession(id: number) {
    setError(null);
    setActiveId(id);
    rememberSession(id);
    try {
      const detail = await getChatSession(id);
      setMessages(detail.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load this chat.');
    }
  }

  async function startNewChat(knownSessions?: ChatSessionOut[]) {
    setError(null);
    try {
      const session = await createChatSession();
      setSessions((prev) => [session, ...(knownSessions ?? prev)]);
      setActiveId(session.id);
      setMessages([]);
      rememberSession(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start a new chat.');
    }
  }

  async function removeSession(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await deleteChatSession(id);
      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);
      if (activeId === id) {
        if (remaining.length > 0) await openSession(remaining[0].id);
        else await startNewChat(remaining);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete chat.');
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || activeId === null) return;
    setInput('');
    setError(null);
    const optimisticUser: ChatMessageOut = {
      id: -Date.now(),
      role: 'user',
      text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);
    setSending(true);
    try {
      const bot = await postChatMessage(activeId, { message: text });
      setMessages((m) => [...m, bot]);
      // The session's title (set from the first message) and sort order
      // (bumped updated_at) may have just changed — refresh the list.
      setSessions(await listChatSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach the chatbot.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') send();
  }

  if (loading) {
    return (
      <div className="page chat-page">
        <div className="page-header">
          <h1 className="page-title">Chat</h1>
        </div>
        <div className="spinner-page"><div className="spinner" /></div>
      </div>
    );
  }

  return (
    <div className="page chat-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Chat</h1>
          <p className="page-subtitle">Rule-based — matches keywords, no external API calls.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => startNewChat()}>New Chat</button>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="chat-layout">
        <div className="card chat-sessions">
          {sessions.length === 0 && <p className="chat-sessions-empty">No chats yet.</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`chat-session-item${s.id === activeId ? ' chat-session-item--active' : ''}`}
              onClick={() => openSession(s.id)}
            >
              <span className="chat-session-title">{s.title ?? 'New chat'}</span>
              <button
                className="chat-session-delete"
                onClick={(e) => removeSession(s.id, e)}
                aria-label="Delete chat"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="card chat-card">
          <div className="chat-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="chat-bubble chat-bubble--bot">
                Hey! Ask me things like "what should I lift for bench press" or "show my last workout". Type "help" for more.
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={m.id}
                className={`chat-bubble chat-bubble--${m.role}`}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              >
                {m.text}
              </div>
            ))}
            {sending && (
              <div className="chat-bubble chat-bubble--bot chat-bubble--typing">
                <span className="chat-dot" />
                <span className="chat-dot" />
                <span className="chat-dot" />
              </div>
            )}
          </div>

          <div className="chat-input-row">
            <input
              type="text"
              placeholder='Try "what should I lift for squat"'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
            />
            <button className="btn btn-primary" onClick={send} disabled={sending || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
