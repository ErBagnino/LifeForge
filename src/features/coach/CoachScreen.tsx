import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Icon } from '@/components/ui/Icon';
import { Button, cx } from '@/components/ui/primitives';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Proposal } from '@/domain/coachAssistant';
import { WEEK_ORDER, WEEKDAY_SHORT } from '@/domain/schedule';
import { useSpeech } from '@/hooks';
import { usageBadge } from '@/domain/aiUsage';
import { applyAll, answerWithBasicCoach, cancelTurn, resolveAction, sendMessage, undoAction } from '@/services/ai/orchestrator';
import { type ActionCard, applyProposal, type ChatMessage, type ChatState, clearChat, dismissProposal, editProposalDays, loadChat, welcomeMessage } from '@/services/coachService';
import { compressImage } from '@/services/foodService';
import { geminiReady, useAi } from '@/store/aiStore';
import type { ServiceResult } from '@/services/events';
import { haptics } from '@/services/haptics';
import { useGame } from '@/store/gameStore';

function ProposalCard({ p, onApply, onDismiss, onDays, busy }: { p: Proposal; onApply: () => void; onDismiss: () => void; onDays: (days: number[]) => void; busy: boolean }) {
  const sched = p.changes.find((c) => c.type === 'work_schedule');
  const workDays = sched && sched.type === 'work_schedule' ? sched.days.map((d, i) => (d.kind === 'work' ? i : -1)).filter((i) => i >= 0) : [];
  const done = p.status !== 'pending';
  return (
    <div className={cx('mt-2 overflow-hidden rounded-3xl border bg-surface', done ? 'border-line opacity-80' : 'border-accent/35 shadow-card')}>
      <div className="px-4 pt-3 pb-2">
        <div className="text-[11px] font-extrabold tracking-[0.16em] text-accent">PREVIEW</div>
        <div className="text-[16px] leading-snug font-bold">{p.title}</div>
        {p.lines.length > 0 && (
          <ul className="mt-2 space-y-1">
            {p.lines.map((l, i) => (
              <li key={i} className="num text-[15px] font-semibold break-words">
                {l}
              </li>
            ))}
          </ul>
        )}
        {p.assumedDays && !done && (
          <div className="mt-3">
            <div className="text-[12px] font-semibold text-muted">Working days</div>
            <div className="mt-1.5 grid grid-cols-7 gap-1">
              {WEEK_ORDER.map((i) => {
                const on = workDays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onDays(on ? workDays.filter((x) => x !== i) : [...workDays, i])}
                    className={cx('hit-44 h-11 min-w-0 rounded-xl text-[12px] font-bold', on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted')}
                  >
                    {WEEKDAY_SHORT[i]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {p.note && <p className="mt-2 text-[13px] text-muted">{p.note}</p>}
        {!!p.impact?.length && (
          <ul className="mt-2 space-y-0.5 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] text-muted">
            {p.impact.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>
      {done ? (
        <div className={cx('border-t border-line px-4 py-2.5 text-[13px] font-bold', p.status === 'applied' ? 'text-success' : 'text-muted')}>{p.status === 'applied' ? '✓ Applied' : 'Dismissed'}</div>
      ) : (
        <div className="flex gap-2 border-t border-line p-2">
          <Button variant="secondary" className="flex-1" onClick={onDismiss} disabled={busy}>
            Keep as is
          </Button>
          <Button className="flex-[1.4]" icon="check" onClick={onApply} loading={busy}>
            APPLY
          </Button>
        </div>
      )}
    </div>
  );
}


const PERMISSION_LABEL = { read: 'READ', low: 'QUICK ACTION', write: 'PREVIEW', destructive: 'DESTRUCTIVE' } as const;

function ActionCardView({ a, busy, onApply, onCancel, onUndo }: { a: ActionCard; busy: boolean; onApply: (phrase?: string) => void; onCancel: () => void; onUndo: () => void }) {
  const [phrase, setPhrase] = useState('');
  const pending = a.status === 'pending';
  const danger = a.permission === 'destructive';
  return (
    <div className={cx('overflow-hidden rounded-3xl border bg-surface', pending ? (danger ? 'border-danger/50 shadow-card' : 'border-accent/35 shadow-card') : 'border-line opacity-90')}>
      <div className="px-4 pt-3 pb-2">
        <div className={cx('text-[11px] font-extrabold tracking-[0.16em]', danger ? 'text-danger' : 'text-accent')}>{PERMISSION_LABEL[a.permission]}</div>
        <div className="text-[16px] leading-snug font-bold break-words">{a.title}</div>
        {a.lines.length > 0 && (
          <ul className="mt-2 space-y-1">
            {a.lines.map((l, i) => (
              <li key={i} className="num text-[14px] break-words">
                <span className="font-semibold">{l.label}</span>
                {(l.before !== undefined || l.after !== undefined) && ': '}
                {l.before !== undefined && <span className="text-muted line-through">{l.before}</span>}
                {l.before !== undefined && l.after !== undefined && ' → '}
                {l.after !== undefined && <b>{l.after}</b>}
              </li>
            ))}
          </ul>
        )}
        {a.warnings.map((w) => (
          <p key={w} className="mt-2 rounded-2xl bg-warning/10 px-3 py-1.5 text-[13px] text-fg">
            ⚠️ {w}
          </p>
        ))}
        {pending && a.confirmPhrase && (
          <div className="mt-3">
            <div className="text-[13px] font-semibold">
              Type <span className="font-mono text-danger">{a.confirmPhrase}</span> to confirm
            </div>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoCapitalize="characters" autoComplete="off" aria-label="Confirmation phrase" className="mt-1.5 h-12 w-full rounded-2xl border border-danger/40 bg-surface px-4 font-mono text-[16px] outline-none focus:border-danger" />
          </div>
        )}
        {a.result && !pending && <p className="mt-2 text-[13px] text-muted">{a.result}</p>}
        {a.result && pending && <p className="mt-2 text-[13px] text-danger">{a.result}</p>}
      </div>
      {pending ? (
        <div className="flex gap-2 border-t border-line p-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-[1.4]" icon="check" onClick={() => onApply(phrase)} loading={busy} disabled={!!a.confirmPhrase && phrase.trim() !== a.confirmPhrase}>
            {danger ? 'CONFIRM' : 'APPLY'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-line px-4 py-1.5">
          <span className={cx('flex-1 text-[13px] font-bold', a.status === 'applied' ? 'text-success' : a.status === 'failed' ? 'text-danger' : 'text-muted')}>
            {a.status === 'applied' ? '✓ Applied' : a.status === 'failed' ? 'Not applied' : a.status === 'undone' ? '↩ Undone' : 'Cancelled'}
          </span>
          {a.status === 'applied' && a.undoable && a.changeId && (
            <Button size="sm" variant="ghost" icon="undo" onClick={onUndo} disabled={busy}>
              Undo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function QuotaCard({ onBasic, onUsage }: { onBasic: () => void; onUsage: () => void }) {
  return (
    <div className="mt-2 rounded-3xl border border-danger/40 bg-surface p-3 shadow-card">
      <div className="text-[11px] font-extrabold tracking-[0.16em] text-danger">GEMINI LIMIT REACHED</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button onClick={onBasic}>USE BASIC COACH</Button>
        <Button variant="secondary" onClick={onUsage}>
          VIEW USAGE
        </Button>
      </div>
    </div>
  );
}

interface BubbleHandlers {
  onQuick: (label: string, value: string) => void;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
  onDays: (id: string, days: number[]) => void;
  onAction: (messageId: string, cardId: string, decision: 'apply' | 'cancel', phrase?: string) => void;
  onApplyAll: (messageId: string) => void;
  onUndo: (messageId: string, cardId: string) => void;
  onBasic: () => void;
  onUsage: () => void;
}

function Bubble({ m, last, busy, h }: { m: ChatMessage; last: boolean; busy: boolean; h: BubbleHandlers }) {
  const { onQuick, onApply, onDismiss, onDays } = h;
  const pendingCards = (m.actions ?? []).filter((a) => a.status === 'pending' && !a.confirmPhrase && a.permission !== 'destructive');
  const mine = m.role === 'user';
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cx('min-w-0', mine ? 'max-w-[82%]' : 'w-full max-w-[92%]')}>
        <div className={cx('inline-block rounded-3xl px-4 py-2.5 text-[15px] leading-snug break-words whitespace-pre-wrap', mine ? 'rounded-br-lg bg-accent text-on-accent' : 'rounded-bl-lg bg-surface shadow-card')}>
          {m.photo && <span className="mr-1" aria-label="Photo attached">📷</span>}
          {m.text}
          {m.ai && <span className="ml-1.5 align-middle text-[10px] font-bold tracking-wider text-muted">GEMINI</span>}
        </div>
        {m.notice && m.notice.kind !== 'quota' && <div className="mt-1 px-2 text-[11px] text-muted">⚠️ {m.notice.text} — basic coach answered.</div>}
        {m.notice?.kind === 'quota' && last && <QuotaCard onBasic={h.onBasic} onUsage={h.onUsage} />}
        {!!m.actions?.length && (
          <div className="mt-2 space-y-2">
            {m.actions.map((a) => (
              <ActionCardView key={a.id} a={a} busy={busy} onApply={(p) => h.onAction(m.id, a.id, 'apply', p)} onCancel={() => h.onAction(m.id, a.id, 'cancel')} onUndo={() => h.onUndo(m.id, a.id)} />
            ))}
            {pendingCards.length > 1 && (
              <Button block icon="check" onClick={() => h.onApplyAll(m.id)} loading={busy}>
                APPLY ALL ({pendingCards.length})
              </Button>
            )}
          </div>
        )}
        {m.info && (
          <div className="mt-2 divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
            {m.info.map((l, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2">
                {l.icon && (
                  <span className="shrink-0 text-[17px]" aria-hidden>
                    {l.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{l.label}</span>
                  {l.value && <span className="block truncate text-[12px] text-muted">{l.value}</span>}
                </span>
                {l.status && <StatusBadge status={l.status} />}
              </div>
            ))}
          </div>
        )}
        {m.proposal && <ProposalCard p={m.proposal} busy={busy} onApply={() => onApply(m.proposal!.id)} onDismiss={() => onDismiss(m.proposal!.id)} onDays={(d) => onDays(m.proposal!.id, d)} />}
        {last && !!m.quick?.length && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.quick.map((q) => (
              <button key={q.value + q.label} type="button" disabled={busy} onClick={() => onQuick(q.label, q.value)} className="min-h-11 rounded-full border border-accent/30 bg-surface px-4 text-[14px] font-semibold text-accent active:scale-95">
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** LIFEFORGE COACH: Gemini agent with tools (preview → confirm → apply), basic on-device coach as fallback. */
export default function CoachScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useGame((s) => s.settings);
  const act = useGame((s) => s.act);
  const refresh = useGame((s) => s.refresh);
  const ui = useAi((s) => s.ui);
  const usage = useAi((s) => s.usage);
  const checkAi = useAi((s) => s.check);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [text, setText] = useState(() => {
    const st = location.state as { draft?: string; send?: boolean } | null;
    return st?.send ? '' : (st?.draft ?? '');
  });
  const [photo, setPhoto] = useState<{ mimeType: 'image/jpeg'; data: string; dataUrl: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech(settings?.coach.voiceLang ?? '', (t) => setText(t));

  useEffect(() => {
    void loadChat().then(setChat);
    void checkAi();
    return () => cancelTurn();
  }, [checkAi]);
  const autoSent = useRef(false);
  useEffect(() => {
    const st = location.state as { draft?: string; send?: boolean } | null;
    if (!chat || autoSent.current || !st?.send || !st.draft) return;
    autoSent.current = true;
    navigate('/coach', { replace: true, state: null });
    send(st.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [chat?.messages.length, busy]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }, [text]);

  if (!settings || !chat) return <div className="h-full bg-bg" />;
  const messages = chat.messages.length ? chat.messages : [welcomeMessage(settings)];

  const run = async (fn: () => Promise<ChatState | { state: ChatState; result?: ServiceResult; reload?: boolean }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if ('messages' in r) setChat(r);
      else if ('reload' in r && r.reload) {
        window.location.replace('/');
        return;
      } else {
        setChat(r.state);
        if (r.result) await act(Promise.resolve(r.result));
        else await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const send = (label: string, value?: string) => {
    const t = label.trim();
    if ((!t && !photo) || busy) return;
    haptics.tap();
    setText('');
    const image = photo ? { mimeType: photo.mimeType, data: photo.data } : undefined;
    setPhoto(null);
    if (speech.listening) speech.stop();
    void run(() => sendMessage(chat, { text: t, value, image }));
  };

  const onPhoto = async (file?: File) => {
    if (!file) return;
    try {
      const img = await compressImage(file);
      setPhoto({ mimeType: img.mimeType, data: img.data, dataUrl: img.dataUrl });
    } catch (e) {
      setHint((e as Error).message);
    }
  };

  const handlers: BubbleHandlers = {
    onQuick: (label, value) => send(label, value),
    onApply: (id) => void run(() => applyProposal(chat, id)),
    onDismiss: (id) => void run(() => dismissProposal(chat, id)),
    onDays: (id, days) => void run(() => editProposalDays(chat, id, days)),
    onAction: (mid, cid, decision, phrase) => void run(() => resolveAction(chat, mid, cid, decision, phrase)),
    onApplyAll: (mid) => void run(() => applyAll(chat, mid)),
    onUndo: (mid, cid) => void run(() => undoAction(chat, mid, cid)),
    onBasic: () => void run(() => answerWithBasicCoach(chat)),
    onUsage: () => navigate('/settings/ai#usage'),
  };
  const connected = geminiReady(settings.coach.ai.enabled);
  const badge = usageBadge({ level: usage?.level ?? 'unknown', limitReached: usage?.limitReached ?? ui === 'quota' }, connected);

  const mic = () => {
    if (!speech.supported) {
      setHint('Voice input isn’t available in this browser. Tip: use the 🎙️ key on the iPhone keyboard.');
      input.current?.focus();
      return;
    }
    if (speech.listening) speech.stop();
    else speech.start();
  };

  return (
    <div className="fixed inset-x-0 z-10 mx-auto flex max-w-[640px] flex-col bg-bg" style={{ top: 'var(--vvtop, 0px)', height: 'var(--vvh, 100dvh)' }}>
      <header className="glass z-10 shrink-0 border-b border-line pt-safe">
        <div className="flex h-14 items-center gap-2 px-safe">
          <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} className="-ml-2 flex h-11 w-11 items-center justify-center text-accent" aria-label="Back">
            <Icon name="chevronLeft" size={26} />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-[18px] text-on-accent" aria-hidden>
            ⚒️
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-black tracking-[0.14em]">LIFEFORGE COACH</div>
            <button type="button" onClick={() => navigate('/settings/ai#usage')} className="hit-44 flex max-w-full items-center gap-1 truncate text-[11px] text-muted" aria-label={`AI status: ${badge.label}. Open Gemini usage`}>
              <span aria-hidden>{badge.icon}</span>
              <span className="truncate">{connected || badge.tone === 'bad' ? badge.label : ui === 'connecting' ? 'Connecting…' : 'Basic coach · preview first'}</span>
            </button>
          </div>
          <button type="button" onClick={() => void run(() => clearChat())} className="flex h-11 w-11 items-center justify-center rounded-full text-muted" aria-label="Clear chat">
            <Icon name="refresh" size={19} />
          </button>
        </div>
      </header>

      <div ref={scroller} className="scroll-touch min-h-0 flex-1 space-y-3 overflow-y-auto px-safe py-4" aria-live="polite">
        {messages.map((m, i) => (
          <Bubble key={m.id} m={m} last={i === messages.length - 1} busy={busy} h={handlers} />
        ))}
        <AnimatePresence>
          {busy && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 px-2" aria-label="Coach is thinking">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-2 w-2 rounded-full bg-faint" animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.12 }} />
              ))}
              {connected && (
                <button type="button" onClick={() => cancelTurn()} className="ml-2 min-h-11 rounded-full px-3 text-[13px] font-semibold text-accent">
                  Stop
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="glass shrink-0 border-t border-line px-safe pt-2" style={{ paddingBottom: 'max(8px, var(--safe-bottom))' }}>
        {(hint || speech.error) && (
          <div className="mb-2 flex items-start gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-[12px] text-muted">
            <span className="min-w-0 flex-1">{speech.error ?? hint}</span>
            <button type="button" className="shrink-0 font-semibold text-accent" onClick={() => setHint(null)}>
              OK
            </button>
          </div>
        )}
        {photo && (
          <div className="mb-2 flex items-center gap-2">
            <img src={photo.dataUrl} alt="Attached" className="h-14 w-14 rounded-2xl object-cover" />
            <span className="min-w-0 flex-1 text-[12px] text-muted">Photo will be sent to Gemini with your message (not stored).</span>
            <button type="button" aria-label="Remove photo" onClick={() => setPhoto(null)} className="flex h-11 w-11 items-center justify-center rounded-full text-muted">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <button
            type="button"
            onClick={mic}
            aria-label={speech.listening ? 'Stop voice input' : 'Voice input'}
            aria-pressed={speech.listening}
            className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', speech.listening ? 'bg-danger text-white' : 'bg-surface-2 text-fg')}
          >
            {speech.listening ? (
              <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
                <Icon name="mic" size={20} />
              </motion.span>
            ) : (
              <Icon name="mic" size={20} />
            )}
          </button>
          {connected && (
            <button type="button" onClick={() => fileInput.current?.click()} aria-label="Attach a photo" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg">
              <Icon name="image" size={20} />
            </button>
          )}
          <textarea
            ref={input}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder={speech.listening ? 'Listening…' : 'Tell me what changed…'}
            aria-label="Message the Coach"
            className="min-h-11 min-w-0 flex-1 resize-none rounded-3xl border border-line bg-surface px-4 py-[10px] text-[16px] leading-snug outline-none focus:border-accent"
          />
          <button type="submit" disabled={(!text.trim() && !photo) || busy} aria-label="Send" className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors', text.trim() || photo ? 'bg-accent text-on-accent' : 'bg-surface-2 text-faint')}>
            <Icon name="send" size={20} strokeWidth={2.4} />
          </button>
        </form>
      </div>
    </div>
  );
}
