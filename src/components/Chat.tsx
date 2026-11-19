"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat/messages";

const SEND_ERROR = "Die Nachricht konnte nicht gesendet werden. Versuch es nochmals.";

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;

    const history: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok || !response.body) throw new Error(`status ${response.status}`);

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += value;
        setMessages([...history, { role: "assistant", content: answer }]);
      }
      if (!answer) throw new Error("empty answer");
    } catch {
      // Take the failed turn back so the history stays valid for the next request.
      setMessages(messages);
      setDraft(content);
      setError(SEND_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <main className="chat">
      <div className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="empty">
            Schreib mir, was Du koordinieren möchtest. Auf Kalender und Mail greife ich noch
            nicht zu, das kommt im nächsten Schritt.
          </p>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              {message.content || <span className="typing">Schreibt …</span>}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      <form className="composer" onSubmit={onSubmit}>
        <textarea
          aria-label="Nachricht"
          placeholder="Nachricht schreiben"
          rows={2}
          maxLength={8000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <button type="submit" disabled={busy || draft.trim() === ""}>
          Senden
        </button>
      </form>
    </main>
  );
}
