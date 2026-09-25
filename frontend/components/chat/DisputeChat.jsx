'use client';

/**
 * DisputeChat — Real-time chat panel for dispute resolution
 *
 * Features:
 * - Real-time messages via WebSocket (Socket.io)
 * - Typing indicators and online presence
 * - Paginated message history
 * - File attachment support (links to IPFS evidence pipeline)
 * - Accessible: live region announces new messages to screen readers
 *
 * @param {object} props
 * @param {string} props.escrowId   — escrow under dispute
 * @param {string} props.address    — connected wallet address (current user)
 * @param {string} props.role       — 'client' | 'freelancer' | 'arbitrator'
 * @param {string} [props.token]    — JWT for authenticated WS connection
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Paperclip, Circle, FileText, Film, ExternalLink, File } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const IPFS_GATEWAY = (
  process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL ||
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ||
  'https://ipfs.io'
).replace(/\/+$/, '');

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function truncateAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function resolveIpfsUrl(cidOrUrl, gateway = IPFS_GATEWAY) {
  if (!cidOrUrl) return '';
  if (cidOrUrl.startsWith('http://') || cidOrUrl.startsWith('https://')) {
    return cidOrUrl;
  }
  const cleanCid = cidOrUrl.replace(/^ipfs:\/\//, '').replace(/^\/+/, '');
  return `${gateway}/ipfs/${cleanCid}`;
}

export function determineFileType({ type = '', name = '', url = '', text = '' }) {
  const combined = `${type} ${name} ${url} ${text}`.toLowerCase();
  if (
    type.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(name || url || text) ||
    combined.includes('image:')
  ) {
    return 'image';
  }
  if (
    type.startsWith('video/') ||
    /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(name || url || text) ||
    combined.includes('video:')
  ) {
    return 'video';
  }
  if (
    type === 'application/pdf' ||
    /\.pdf(\?.*)?$/i.test(name || url || text) ||
    combined.includes('pdf:') ||
    combined.includes('.pdf')
  ) {
    return 'pdf';
  }
  if (/\b(png|jpg|jpeg|gif|webp|image)\b/i.test(combined)) return 'image';
  if (/\b(mp4|webm|mov|video)\b/i.test(combined)) return 'video';
  if (/\b(pdf|document)\b/i.test(combined)) return 'pdf';
  return 'other';
}

export function extractEvidence(msg) {
  if (!msg) return null;

  // 1. Attachment object
  if (msg.attachment) {
    const rawUrl = msg.attachment.url || (msg.attachment.cid ? `${IPFS_GATEWAY}/ipfs/${msg.attachment.cid}` : '');
    const name = msg.attachment.name || '';
    const fileType = determineFileType({
      type: msg.attachment.type || msg.fileType || '',
      name,
      url: rawUrl,
      text: msg.text || '',
    });
    if (rawUrl || msg.attachment.cid) {
      return {
        url: resolveIpfsUrl(rawUrl || msg.attachment.cid),
        fileType,
        name: name || 'Evidence file',
      };
    }
  }

  // 2. Explicit CID on message
  const explicitCid = msg.cid || msg.ipfsCid;
  if (explicitCid) {
    const fileType = determineFileType({
      type: msg.fileType || msg.type || '',
      name: msg.filename || msg.name || '',
      url: explicitCid,
      text: msg.text || '',
    });
    return {
      url: `${IPFS_GATEWAY}/ipfs/${explicitCid}`,
      fileType,
      name: msg.filename || msg.name || explicitCid,
    };
  }

  // 3. Message text containing IPFS URL or CID
  if (typeof msg.text === 'string') {
    const ipfsMatch =
      msg.text.match(/(?:ipfs:\/\/|https?:\/\/[^\s/]+\/ipfs\/)(Qm[1-9A-HJ-NP-Za-km-z]{44,}|bafy[a-z0-9]{50,}|bafk[a-z0-9]{50,})([^\s]*)/i) ||
      msg.text.match(/\b(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]{50,}|bafk[a-z0-9]{50,})\b/i);

    if (ipfsMatch) {
      const matchedCid = ipfsMatch[1];
      const extraPath = ipfsMatch[2] || '';
      const fullUrl = `${IPFS_GATEWAY}/ipfs/${matchedCid}${extraPath}`;
      const fileType = determineFileType({
        type: msg.fileType || '',
        name: extraPath || '',
        url: fullUrl,
        text: msg.text,
      });
      return {
        url: fullUrl,
        fileType,
        name: extraPath ? extraPath.replace(/^\//, '') : matchedCid,
      };
    }
  }

  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EvidencePreview({ url, fileType, name }) {
  if (!url) return null;

  if (fileType === 'image') {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-gray-700/60 bg-gray-900/60 shadow-md">
        <img
          src={url}
          alt={name || 'IPFS evidence preview'}
          loading="lazy"
          className="max-h-[200px] max-w-[300px] w-auto h-auto rounded-lg object-cover transition-opacity hover:opacity-95"
          style={{ maxHeight: '200px', maxWidth: '300px', objectFit: 'cover' }}
        />
        {name && (
          <span className="block px-2.5 py-1 text-[11px] text-gray-400 truncate max-w-[300px]">
            {name}
          </span>
        )}
      </div>
    );
  }

  if (fileType === 'video') {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-gray-700/60 bg-black/80 max-w-[300px] shadow-md">
        <video
          src={url}
          controls
          preload="metadata"
          className="max-h-[200px] max-w-[300px] w-full rounded-lg"
          style={{ maxHeight: '200px', maxWidth: '300px' }}
        >
          Your browser does not support the video tag.
        </video>
        {name && (
          <span className="block px-2.5 py-1 text-[11px] text-gray-400 truncate max-w-[300px]">
            {name}
          </span>
        )}
      </div>
    );
  }

  if (fileType === 'pdf') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-2 rounded-xl border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-200 hover:bg-red-900/50 hover:text-white transition-all shadow-sm"
        aria-label={`Open PDF document: ${name || 'evidence.pdf'}`}
      >
        <FileText size={16} className="text-red-400 flex-shrink-0" aria-hidden="true" />
        <span className="truncate max-w-[200px] font-medium">{name || 'View PDF Evidence'}</span>
        <ExternalLink size={12} className="opacity-70 flex-shrink-0" aria-hidden="true" />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs text-indigo-200 hover:bg-gray-750 hover:text-white transition-all shadow-sm"
      aria-label={`Open evidence file: ${name || 'evidence file'}`}
    >
      <File size={16} className="text-indigo-400 flex-shrink-0" aria-hidden="true" />
      <span className="truncate max-w-[200px] font-medium">{name || 'View Evidence Attachment'}</span>
      <ExternalLink size={12} className="opacity-70 flex-shrink-0" aria-hidden="true" />
    </a>
  );
}

function MessageBubble({ msg, isMine }) {
  const evidence = extractEvidence(msg);

  return (
    <div className={`flex gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'} items-end`}>
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full bg-indigo-600/30 flex items-center justify-center
                      text-indigo-400 text-xs font-bold flex-shrink-0"
      >
        {msg.role?.[0]?.toUpperCase() ?? '?'}
      </div>

      <div
        className={`max-w-[72%] space-y-0.5 ${isMine ? 'items-end' : 'items-start'} flex flex-col`}
      >
        {/* Sender label */}
        <span className="text-xs text-gray-500 px-1">
          {isMine ? 'You' : truncateAddress(msg.address)}
          {msg.role && ` · ${msg.role}`}
        </span>

        {/* Bubble */}
        <div
          className={`rounded-2xl px-3 py-2 text-sm leading-relaxed break-words
          ${
            isMine
              ? 'bg-indigo-600 text-white rounded-br-sm'
              : 'bg-gray-800 text-gray-100 rounded-bl-sm'
          }`}
        >
          {msg.text}
          {evidence && (
            <EvidencePreview
              url={evidence.url}
              fileType={evidence.fileType}
              name={evidence.name}
            />
          )}
          {msg.attachment && !evidence && (
            <a
              href={msg.attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-1 text-xs underline opacity-80 hover:opacity-100"
            >
              📎 {msg.attachment.name}
            </a>
          )}
        </div>

        {/* Timestamp + read receipt */}
        <span className="text-xs text-gray-600 px-1">
          {formatTime(msg.ts)}
          {isMine && msg.read && <span className="ml-1 text-indigo-400">✓✓</span>}
        </span>
      </div>
    </div>
  );
}

function TypingIndicator({ typers }) {
  if (!typers.length) return null;
  const label =
    typers.length === 1
      ? `${truncateAddress(typers[0])} is typing…`
      : `${typers.length} people are typing…`;
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs text-gray-500" aria-live="polite">
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      {label}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DisputeChat({ escrowId, address, role, token }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typers, setTypers] = useState([]);
  const [online, setOnline] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const wsRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);
  const announcerRef = useRef(null);

  // ── Load message history ──────────────────────────────────────────────────
  const loadHistory = useCallback(
    async (p = 1) => {
      setLoadingHistory(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/disputes/${escrowId}/messages?page=${p}&limit=30`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) return;
        const data = await res.json();
        const msgs = data.data ?? data.messages ?? [];
        setMessages((prev) => (p === 1 ? msgs : [...msgs, ...prev]));
        setHasMore(data.hasNextPage ?? false);
        setPage(p);
      } catch {
        // network error — show empty state
      } finally {
        setLoadingHistory(false);
      }
    },
    [escrowId, token],
  );

  useEffect(() => {
    loadHistory(1);
  }, [loadHistory]);

  // ── WebSocket connection ──────────────────────────────────────────────────
  useEffect(() => {
    const url = `${WS_BASE}/disputes/${escrowId}?address=${address}&token=${token ?? ''}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'message':
            setMessages((prev) => [...prev, msg.payload]);
            // Announce to screen readers
            if (announcerRef.current) {
              announcerRef.current.textContent = `New message from ${truncateAddress(msg.payload.address)}: ${msg.payload.text}`;
            }
            break;
          case 'typing':
            setTypers(msg.payload.typers ?? []);
            break;
          case 'presence':
            setOnline(msg.payload.online ?? []);
            break;
          case 'read':
            setMessages((prev) =>
              prev.map((m) => (m.id === msg.payload.messageId ? { ...m, read: true } : m)),
            );
            break;
        }
      } catch {
        // malformed message
      }
    };

    return () => ws.close();
  }, [escrowId, address, token]);

  // ── Auto-scroll on new messages ───────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(() => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const msg = {
      type: 'message',
      payload: { text, address, role, ts: Date.now(), id: crypto.randomUUID() },
    };
    wsRef.current.send(JSON.stringify(msg));

    // Optimistic update
    setMessages((prev) => [...prev, { ...msg.payload, isMine: true }]);
    setInput('');
  }, [input, address, role]);

  // ── Typing indicator ──────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    setInput(e.target.value);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', payload: { address } }));
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        wsRef.current?.send(JSON.stringify({ type: 'stop_typing', payload: { address } }));
      }, 2000);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ── File attachment ───────────────────────────────────────────────────────
  const handleAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Upload to IPFS evidence endpoint
    const form = new FormData();
    form.append('file', file);
    form.append('escrowId', escrowId);
    try {
      const res = await fetch(`${API_BASE}/api/disputes/${escrowId}/evidence`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) return;
      const data = await res.json();
      const url = data.url || (data.cid ? resolveIpfsUrl(data.cid) : '');
      const name = data.name || file.name;
      const cid = data.cid || data.ipfsCid;
      const msg = {
        type: 'message',
        payload: {
          text: `Attached: ${name}`,
          attachment: { url, name, cid, type: file.type },
          address,
          role,
          ts: Date.now(),
          id: crypto.randomUUID(),
        },
      };
      wsRef.current?.send(JSON.stringify(msg));
      setMessages((prev) => [...prev, { ...msg.payload, isMine: true }]);
    } catch {
      // upload failed
    }
    e.target.value = '';
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-white">Dispute Chat</h3>
          <p className="text-xs text-gray-500">Escrow #{escrowId}</p>
        </div>
        <div className="flex items-center gap-2">
          {online.map((addr) => (
            <span
              key={addr}
              className="flex items-center gap-1 text-xs text-emerald-400"
              title={addr}
            >
              <Circle size={6} className="fill-emerald-400" />
              {truncateAddress(addr)}
            </span>
          ))}
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-gray-600'}`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        </div>
      </div>

      {/* Load more */}
      {hasMore && (
        <button
          onClick={() => loadHistory(page + 1)}
          className="text-xs text-indigo-400 hover:text-indigo-300 py-2 text-center transition-colors"
        >
          Load earlier messages
        </button>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0"
        role="log"
        aria-label="Dispute chat messages"
        aria-live="polite"
      >
        {loadingHistory && (
          <div className="flex justify-center py-4">
            <span className="text-xs text-gray-500 animate-pulse">Loading messages…</span>
          </div>
        )}
        {!loadingHistory && messages.length === 0 && (
          <p className="text-center text-xs text-gray-600 py-8">
            No messages yet. Start the conversation.
          </p>
        )}
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id ?? i}
            msg={msg}
            isMine={msg.address === address || msg.isMine}
          />
        ))}
        <TypingIndicator typers={typers.filter((a) => a !== address)} />
        <div ref={bottomRef} />
      </div>

      {/* Screen reader announcer */}
      <div ref={announcerRef} className="sr-only" aria-live="assertive" aria-atomic="true" />

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-800 flex items-end gap-2">
        <label
          className="cursor-pointer text-gray-500 hover:text-gray-300 transition-colors p-1.5"
          title="Attach file"
        >
          <Paperclip size={16} />
          <input
            type="file"
            className="sr-only"
            onChange={handleAttach}
            accept="image/*,.pdf,.doc,.docx,video/*"
          />
        </label>

        <textarea
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send)"
          rows={1}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm
                     text-white placeholder-gray-500 resize-none focus:outline-none
                     focus:border-indigo-500 transition-colors max-h-32 overflow-y-auto"
          aria-label="Message input"
        />

        <button
          onClick={send}
          disabled={!input.trim() || !connected}
          className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40
                     disabled:cursor-not-allowed rounded-xl text-white transition-colors"
          aria-label="Send message"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
