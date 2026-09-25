import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '@/components/ui/Icon';
import { Button, cx } from '@/components/ui/primitives';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Proposal } from '@/domain/coachAssistant';
import { WEEK_ORDER, WEEKDAY_SHORT } from '@/domain/schedule';
import { useSpeech } from '@/hooks';
import { applyProposal, type ChatMessage, type ChatState, clearChat, dismissProposal, editProposalDays, loadChat, sendMessage, welcomeMessage } from '@/services/coachService';
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

function Bubble({ m, last, busy, onQuick, onApply, onDismiss, onDays }: { m: ChatMessage; last: boolean; busy: boolean; onQuick: (label: string, value: string) => void; onApply: (id: string) => void; onDismiss: (id: string) => void; onDays: (id: string, days: number[]) => void }) {
  const mine = m.role === 'user';
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cx('min-w-0', mine ? 'max-w-[82%]' : 'w-full max-w-[92%]')}>
        <div className={cx('inline-block rounded-3xl px-4 py-2.5 text-[15px] leading-snug break-words whitespace-pre-wrap', mine ? 'rounded-br-lg bg-accent text-on-accent' : 'rounded-bl-lg bg-surface shadow-card')}>
          {m.text}
          {m.ai && <span className="ml-1.5 align-middle text-[10px] font-bold tracking-wider text-muted">AI</span>}
        </div>
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

/** LIFEFORGE COACH: configure the game by chat (on-device parser, optional AI fallback). */
export default function CoachScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const act = useGame((s) => s.act);
  const refresh = useGame((s) => s.refresh);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech(settings?.coach.voiceLang ?? '', (t) => setText(t));

  useEffect(() => {
    void loadChat().then(setChat);
  }, []);
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

  const run = async (fn: () => Promise<ChatState | { state: ChatState; result?: ServiceResult }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if ('messages' in r) setChat(r);
      else {
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
    if (!t || busy) return;
    haptics.tap();
    setText('');
    if (speech.listening) speech.stop();
    void run(() => sendMessage(chat, { text: t, value }));
  };

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
            <div className="truncate text-[11px] text-muted">{settings.coach.ai.enabled ? 'On-device + your AI key' : 'On-device · preview first'}</div>
          </div>
          <button type="button" onClick={() => void run(() => clearChat())} className="flex h-11 w-11 items-center justify-center rounded-full text-muted" aria-label="Clear chat">
            <Icon name="refresh" size={19} />
          </button>
        </div>
      </header>

      <div ref={scroller} className="scroll-touch min-h-0 flex-1 space-y-3 overflow-y-auto px-safe py-4" aria-live="polite">
        {messages.map((m, i) => (
          <Bubble
            key={m.id}
            m={m}
            last={i === messages.length - 1}
            busy={busy}
            onQuick={(label, value) => send(label, value)}
            onApply={(id) => void run(() => applyProposal(chat, id))}
            onDismiss={(id) => void run(() => dismissProposal(chat, id))}
            onDays={(id, days) => void run(() => editProposalDays(chat, id, days))}
          />
        ))}
        <AnimatePresence>
          {busy && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-1 px-2" aria-label="Coach is thinking">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-2 w-2 rounded-full bg-faint" animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.12 }} />
              ))}
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
          <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors', text.trim() ? 'bg-accent text-on-accent' : 'bg-surface-2 text-faint')}>
            <Icon name="send" size={20} strokeWidth={2.4} />
          </button>
        </form>
      </div>
    </div>
  );
}
