"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type ChatImage,
  type ChatMessage,
  IMAGE_TYPES,
  MAX_IMAGE_CHARS,
  MAX_IMAGES_PER_MESSAGE,
} from "@/lib/chat/messages";
import { decodeEvents } from "@/lib/chat/stream";
import type { ExecutionResult, SignedProposal } from "@/lib/proposals/types";
import { ProposalCard, proposalNote, type ProposalState } from "./ProposalCard";

const SEND_ERROR = "Die Nachricht konnte nicht gesendet werden. Versuch es nochmals.";
const IMAGE_ERROR = "Das Bild konnte nicht angehängt werden. Erlaubt sind PNG, JPEG, WebP und GIF bis 5 MB.";

interface UiProposal {
  signed: SignedProposal;
  state: ProposalState;
}

interface UiMessage extends ChatMessage {
  proposals?: UiProposal[];
}

const CONFIRM_ERRORS: Record<string, string> = {
  expired: "Der Vorschlag ist abgelaufen. Bitte die Assistentin, ihn neu zu zeigen.",
  invalid: "Der Vorschlag ist ungültig. Bitte die Assistentin, ihn neu zu zeigen.",
  wrongPerson: "Der Vorschlag gehört zu einer anderen Anmeldung.",
  calendar: "Kein Schreibzugriff auf den Kalender. Melde Dich ab und neu an und erlaube den Kalenderzugriff.",
};

/** The history as the model gets it: text, pictures and what happened to each proposal. */
function toHistory(messages: UiMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const notes = (message.proposals ?? [])
      .map((proposal) => proposalNote(proposal.signed, proposal.state))
      .filter((note): note is string => note !== null);
    const content = [message.content || "(Vorschlag angezeigt)", ...notes].join("\n\n");
    return { role: message.role, content, ...(message.images ? { images: message.images } : {}) };
  });
}

function readImage(file: File): Promise<ChatImage | null> {
  const mediaType = IMAGE_TYPES.find((type) => type === file.type);
  if (!mediaType) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const data = String(reader.result).split(",")[1] ?? "";
      resolve(data && data.length <= MAX_IMAGE_CHARS ? { mediaType, data } : null);
    };
    reader.readAsDataURL(file);
  });
}

export function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function attach(files: File[]) {
    if (files.length === 0) return;
    const read = await Promise.all(files.map(readImage));
    const usable = read.filter((image): image is ChatImage => image !== null);
    setError(usable.length < read.length ? IMAGE_ERROR : null);
    setImages((current) => [...current, ...usable].slice(0, MAX_IMAGES_PER_MESSAGE));
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    void attach(files);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void attach([...(event.target.files ?? [])]);
    event.target.value = "";
  }

  async function send() {
    const content = draft.trim();
    if ((!content && images.length === 0) || busy) return;

    const previous = messages;
    const attached = images;
    const question: UiMessage = { role: "user", content, ...(attached.length > 0 ? { images: attached } : {}) };
    const history = [...previous, question];
    const show = (answer: UiMessage) => setMessages([...history, answer]);
    show({ role: "assistant", content: "" });
    setDraft("");
    setImages([]);
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toHistory(history) }),
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok || !response.body) throw new Error(`status ${response.status}`);

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      const answer: UiMessage = { role: "assistant", content: "", proposals: [] };
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const decoded = decodeEvents(buffer + value);
        buffer = decoded.rest;
        for (const event of decoded.events) {
          if (event.type === "text") answer.content += event.text;
          else answer.proposals = [...(answer.proposals ?? []), { signed: event.proposal, state: { step: "open" } }];
        }
        show({ ...answer });
      }
      if (!answer.content && !answer.proposals?.length) throw new Error("empty answer");
    } catch {
      // Take the failed turn back so the history stays valid for the next request.
      setMessages(previous);
      setDraft(content);
      setImages(attached);
      setError(SEND_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function setProposalState(messageIndex: number, proposalIndex: number, state: ProposalState) {
    setMessages((current) =>
      current.map((message, index) =>
        index !== messageIndex
          ? message
          : {
              ...message,
              proposals: message.proposals?.map((proposal, i) => (i === proposalIndex ? { ...proposal, state } : proposal)),
            },
      ),
    );
  }

  async function confirm(messageIndex: number, proposalIndex: number, signed: SignedProposal) {
    setProposalState(messageIndex, proposalIndex, { step: "working" });
    try {
      const response = await fetch("/api/proposals/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: signed.token }),
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const body = (await response.json()) as ExecutionResult | { error?: string };
      if (!response.ok || !("entries" in body)) {
        const code = "error" in body ? (body.error ?? "") : "";
        setProposalState(messageIndex, proposalIndex, {
          step: "error",
          message: CONFIRM_ERRORS[code] ?? "Das hat nicht geklappt. Im Zweifel prüf Deinen Kalender.",
        });
        return;
      }
      setProposalState(messageIndex, proposalIndex, { step: "done", result: body });
    } catch {
      setProposalState(messageIndex, proposalIndex, {
        step: "error",
        message: "Die Verbindung ist abgebrochen. Prüf Deinen Kalender, bevor Du es nochmals versuchst.",
      });
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
            Frag mich nach freien Zeiten oder schick mir die Slots einer Terminumfrage, als Text oder
            als Bild. Ich prüfe sie gegen Deinen Kalender. Blocker trage ich erst ein, wenn Du den
            Vorschlag bestätigst.
          </p>
        ) : (
          messages.map((message, messageIndex) => (
            <div key={messageIndex} className={`message ${message.role}`}>
              {message.images?.map((image, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={index} src={`data:${image.mediaType};base64,${image.data}`} alt="Angehängtes Bild" />
              ))}
              {message.content ||
                (message.role === "assistant" && !message.proposals?.length ? (
                  <span className="typing">Schreibt …</span>
                ) : null)}
              {message.proposals?.map((proposal, proposalIndex) => (
                <ProposalCard
                  key={proposal.signed.token}
                  signed={proposal.signed}
                  state={proposal.state}
                  onConfirm={() => void confirm(messageIndex, proposalIndex, proposal.signed)}
                  onDecline={() => setProposalState(messageIndex, proposalIndex, { step: "declined" })}
                />
              ))}
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
      {images.length > 0 ? (
        <ul className="attachments" aria-label="Angehängte Bilder">
          {images.map((image, index) => (
            <li key={index}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:${image.mediaType};base64,${image.data}`} alt={`Bild ${index + 1}`} />
              <button
                type="button"
                className="quiet"
                aria-label={`Bild ${index + 1} entfernen`}
                onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="composer" onSubmit={onSubmit}>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={onPick}
        />
        <button
          type="button"
          className="quiet"
          onClick={() => fileRef.current?.click()}
          disabled={images.length >= MAX_IMAGES_PER_MESSAGE}
        >
          Bild
        </button>
        <textarea
          aria-label="Nachricht"
          placeholder="Nachricht schreiben oder Bild einfügen"
          rows={2}
          maxLength={8000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          autoFocus
        />
        <button type="submit" disabled={busy || (draft.trim() === "" && images.length === 0)}>
          Senden
        </button>
      </form>
    </main>
  );
}
