import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { approxQuantity, type FoodEstimate, type FoodItemEstimate } from '@/ai/shared/food';
import { Field, NumberInput, TextInput } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, Chip, cx } from '@/components/ui/primitives';
import { AiClientError } from '@/services/ai/gemini';
import { OFFICIAL_USAGE_URL } from '@/services/ai/usageService';
import { analyzeMeal, compressImage, type CompressedImage, diffEstimates, type EstimateDiff, estimateToItems, explainMeal, foodLocale, reviseMeal, scaleFood, thumbnail, withTotals } from '@/services/foodService';
import { logMeal } from '@/services/metricsService';
import { geminiReady, useAi } from '@/store/aiStore';
import { useGame } from '@/store/gameStore';
import { defaultMealName, MealBuilder } from './MealBuilder';

const CONF_COLOR = { low: 'var(--lf-danger)', medium: 'var(--lf-warning, #d98a00)', high: 'var(--lf-success)' } as const;
const METHOD_LABEL: Record<string, string> = { unknown: '', mixed: 'mixed', grilled: 'grilled', fried: 'fried', baked: 'baked', boiled: 'boiled', steamed: 'steamed', roasted: 'roasted', sauteed: 'sautéed', raw: 'raw' };

function errorText(e: unknown): { text: string; quota: boolean } {
  if (e instanceof AiClientError) {
    if (e.kind === 'aborted') return { text: '', quota: false };
    if (e.kind === 'quota') return { text: 'Gemini is temporarily unavailable because a usage limit has been reached.', quota: true };
    if (e.kind === 'image') return { text: e.message || "Couldn't analyze this image.", quota: false };
    return { text: e.message, quota: false };
  }
  return { text: (e as Error)?.message || 'Something went wrong.', quota: false };
}

function FoodRow({ f, editing, onChange, onRemove }: { f: FoodItemEstimate; editing: boolean; onChange: (f: FoodItemEstimate) => void; onRemove: () => void }) {
  const method = METHOD_LABEL[f.cookingMethod];
  return (
    <div className="rounded-2xl bg-surface p-3 shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <TextInput value={f.name} onChange={(v) => onChange({ ...f, name: v.slice(0, 60) })} aria-label="Food name" className="!h-11" />
          ) : (
            <div className="text-[15px] leading-snug font-semibold break-words">{f.name}</div>
          )}
          <div className="num mt-0.5 text-[12px] text-muted">
            {approxQuantity(f.estimatedQuantity, f.unit)}
            {method ? ` · ${method}` : ''} · <span style={{ color: CONF_COLOR[f.confidence] }}>{f.confidence}</span>
          </div>
        </div>
        <div className="num shrink-0 text-right">
          <div className="text-[15px] font-bold">{Math.round(f.calories)} kcal</div>
          <div className="text-[11px] text-muted">
            P {Math.round(f.protein)} · C {Math.round(f.carbs)} · F {Math.round(f.fat)}
          </div>
        </div>
        {editing && (
          <button type="button" aria-label={`Remove ${f.name}`} onClick={onRemove} className="-mt-1 -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label={`Amount (${f.unit})`}>
            <NumberInput value={Math.round(f.estimatedQuantity)} min={0} onChange={(v) => onChange(scaleFood(f, Math.max(0, v)))} aria-label={`${f.name} amount`} />
          </Field>
          <Field label="Calories">
            <NumberInput value={Math.round(f.calories)} min={0} onChange={(v) => onChange({ ...f, calories: Math.max(0, v) })} aria-label={`${f.name} calories`} />
          </Field>
          <Field label="Protein (g)">
            <NumberInput value={Math.round(f.protein)} min={0} onChange={(v) => onChange({ ...f, protein: Math.max(0, v) })} aria-label={`${f.name} protein`} />
          </Field>
          <Field label="Carbs / Fat (g)">
            <div className="flex gap-1">
              <NumberInput value={Math.round(f.carbs)} min={0} onChange={(v) => onChange({ ...f, carbs: Math.max(0, v) })} aria-label={`${f.name} carbs`} />
              <NumberInput value={Math.round(f.fat)} min={0} onChange={(v) => onChange({ ...f, fat: Math.max(0, v) })} aria-label={`${f.name} fat`} />
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}

function DiffCard({ diff, summary }: { diff: EstimateDiff; summary?: string }) {
  if (!diff.totals.length && !diff.added.length && !diff.removed.length && !summary) return null;
  const label = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' } as const;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-2xl border border-accent/30 bg-surface p-3">
      <div className="text-[11px] font-extrabold tracking-[0.16em] text-accent">UPDATED</div>
      {summary && <p className="mt-1 text-[14px]">{summary}</p>}
      <ul className="num mt-1 space-y-0.5 text-[13px]">
        {diff.totals.map((t) => (
          <li key={t.key}>
            {label[t.key]}: <span className="text-muted line-through">{t.before}</span> → <b>{t.after}</b>
            {t.key === 'calories' ? ' kcal' : ' g'}
          </li>
        ))}
        {diff.added.length > 0 && <li>Added: {diff.added.join(', ')}</li>}
        {diff.removed.length > 0 && <li>Removed: {diff.removed.join(', ')}</li>}
      </ul>
    </motion.div>
  );
}

/**
 * SCAN FOOD: photo → Gemini estimate → questions & corrections → REVIEW MEAL →
 * ADD TO TODAY. Nothing is logged until "Add to today"; the photo is never stored
 * on a server and is kept on the device only when "Save Food Photos" is on.
 */
export default function FoodScanScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const act = useGame((s) => s.act);
  const ui = useAi((s) => s.ui);
  const check = useAi((s) => s.check);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [image, setImage] = useState<CompressedImage | null>(null);
  const [thumb, setThumb] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [estimate, setEstimate] = useState<FoodEstimate | null>(null);
  const [corrected, setCorrected] = useState(false);
  const [diff, setDiff] = useState<{ d: EstimateDiff; summary?: string } | null>(null);
  const [correction, setCorrection] = useState('');
  const [explanation, setExplanation] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'analyze' | 'revise' | 'explain' | 'save'>(null);
  const [error, setError] = useState<{ text: string; quota: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    void check();
    return () => abort.current?.abort();
  }, [check]);

  if (!settings) return null;
  const locale = foodLocale(settings.coach.voiceLang);
  const aiOn = settings.coach.ai.foodVision && geminiReady(settings.coach.ai.enabled);
  const aiBlockedReason = !settings.coach.ai.enabled || !settings.coach.ai.foodVision ? 'Food Vision is off (Settings → AI).' : ui === 'connecting' ? 'Checking the Gemini connection…' : ui === 'quota' ? 'Gemini is temporarily unavailable because a usage limit has been reached.' : 'Gemini is not connected, so photos can’t be estimated. You can still add the meal manually.';

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setBusy(kind);
    setError(null);
    try {
      return await fn(c.signal);
    } catch (e) {
      const err = errorText(e);
      if (err.text) setError(err);
      if (e instanceof AiClientError) useAi.getState().noteError(e.kind);
      return undefined;
    } finally {
      if (abort.current === c) abort.current = null;
      setBusy(null);
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    setEstimate(null);
    setDiff(null);
    setExplanation(null);
    setManual(false);
    try {
      const [img, t] = await Promise.all([compressImage(file), settings.coach.ai.savePhotos ? thumbnail(file) : Promise.resolve(undefined)]);
      setImage(img);
      setThumb(t);
      if (aiOn) void analyze(img);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const analyze = async (img = image) => {
    if (!img) return;
    const est = await run('analyze', (signal) => analyzeMeal(img, { note: note.trim() || undefined, locale, signal }));
    if (est) {
      setEstimate(est);
      setCorrected(false);
      setEdited(false);
    }
  };

  const revise = async (message: string) => {
    if (!estimate || !message.trim()) return;
    const before = estimate;
    const next = await run('revise', (signal) => reviseMeal(before, message.trim(), { locale, signal }));
    if (next) {
      setEstimate(next);
      setCorrected(true);
      setDiff({ d: diffEstimates(before, next), summary: next.changeSummary });
      setCorrection('');
      setExplanation(null);
    }
  };

  const explain = async () => {
    if (!estimate) return;
    const text = await run('explain', (signal) => explainMeal(estimate, 'Why does this meal have this many calories?', { locale, signal }));
    if (text) setExplanation(text);
  };

  const updateFood = (i: number, f: FoodItemEstimate) => {
    if (!estimate) return;
    setEstimate(withTotals({ ...estimate, foods: estimate.foods.map((x, k) => (k === i ? f : x)) }));
    setEdited(true);
  };
  const removeFood = (i: number) => {
    if (!estimate) return;
    setEstimate(withTotals({ ...estimate, foods: estimate.foods.filter((_, k) => k !== i) }));
    setEdited(true);
  };

  const addToToday = async () => {
    if (!estimate) return;
    setBusy('save');
    try {
      const items = estimateToItems(estimate);
      const t = withTotals(estimate).mealTotals;
      await act(
        logMeal({
          name: estimate.mealName || defaultMealName(),
          items,
          kcal: t.calories,
          protein: t.protein,
          carbs: t.carbs,
          fat: t.fat,
          photo: settings.coach.ai.savePhotos ? thumb : undefined,
          source: 'ai',
          note: estimate.assumptions.slice(0, 3).join(' · ') || undefined,
          estimate: { confidence: estimate.overallConfidence, corrected, edited },
        }),
      );
      navigate('/nutrition', { replace: true });
    } finally {
      setBusy(null);
    }
  };

  const totals = estimate ? withTotals(estimate).mealTotals : null;
  const preview = image?.dataUrl;

  return (
    <div className="mx-auto min-h-full max-w-[640px] pb-[calc(var(--safe-bottom)+24px)]">
      <header className="glass sticky top-0 z-20 border-b border-line pt-safe">
        <div className="flex h-12 items-center gap-2 px-safe">
          <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/nutrition'))} className="-ml-2 flex h-11 items-center gap-0.5 pr-2 text-[17px] text-accent" aria-label="Back">
            <Icon name="chevronLeft" size={26} /> Back
          </button>
          <div className="flex-1 truncate text-center text-[16px] font-bold">{estimate ? 'Review meal' : 'Scan food'}</div>
          <span className="w-16" />
        </div>
      </header>

      <div className="px-safe pt-4">
        <div className={cx('relative w-full overflow-hidden rounded-3xl bg-surface-2 shadow-card', estimate ? 'aspect-[16/9]' : 'aspect-[4/3]')}>
          {preview ? (
            <motion.img initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} src={preview} alt="Your meal" className="h-full w-full object-cover" />
          ) : (
            <button type="button" onClick={() => camera.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted" aria-label="Take a photo of your meal">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface">
                <Icon name="camera" size={30} />
              </span>
              <span className="text-[15px] font-semibold">Point at your plate</span>
              <span className="text-[12px]">Good light, whole plate in frame, a fork or hand helps with size</span>
              <span className="pointer-events-none absolute inset-5 rounded-2xl border-2 border-dashed border-fg/15" />
            </button>
          )}
          {busy === 'analyze' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white">
              <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
                <Icon name="sparkles" size={28} />
              </motion.span>
              <span className="text-[15px] font-semibold">Estimating…</span>
              <button type="button" onClick={() => abort.current?.abort()} className="min-h-11 rounded-full bg-white/20 px-4 text-[14px] font-semibold">
                Cancel
              </button>
            </div>
          )}
        </div>

        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        <input ref={library} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

        {!image && (
          <div className="mt-4 space-y-2">
            <Button block size="lg" icon="camera" className="!h-16 !text-[18px]" onClick={() => camera.current?.click()}>
              TAKE PHOTO
            </Button>
            <Button block variant="secondary" icon="image" onClick={() => library.current?.click()}>
              CHOOSE PHOTO
            </Button>
            {aiOn && <TextInput voice value={note} onChange={setNote} placeholder="Optional note, e.g. “half portion, cooked in butter”" aria-label="Note for the estimate" />}
            <PrivacyNote aiOn={aiOn} savePhotos={settings.coach.ai.savePhotos} reason={aiOn ? undefined : aiBlockedReason} onSettings={() => navigate('/settings/ai')} />
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-2xl bg-danger/10 px-3 py-2 text-[13px] font-semibold text-danger" role="alert">
            {error.quota && <div className="text-[11px] font-extrabold tracking-[0.16em]">GEMINI LIMIT REACHED</div>}
            {error.text}
            <div className="mt-2 flex flex-wrap gap-2">
              {image && !estimate && !error.quota && (
                <Button size="sm" variant="secondary" onClick={() => void analyze()}>
                  Try again
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setManual(true)}>
                Add manually
              </Button>
              {error.quota && (
                <Button size="sm" variant="secondary" icon="external" onClick={() => window.open(OFFICIAL_USAGE_URL, '_blank', 'noopener')}>
                  View usage
                </Button>
              )}
            </div>
          </div>
        )}

        {image && !estimate && busy !== 'analyze' && !manual && (
          <div className="mt-3 space-y-2">
            {aiOn ? (
              <Button block icon="sparkles" onClick={() => void analyze()}>
                Estimate with Gemini
              </Button>
            ) : (
              <p className="rounded-2xl bg-surface-2 px-3 py-2 text-[13px] text-muted">{aiBlockedReason}</p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" icon="camera" className="flex-1" onClick={() => camera.current?.click()}>
                Retake
              </Button>
              <Button variant="secondary" icon="edit" className="flex-1" onClick={() => setManual(true)}>
                Add manually
              </Button>
            </div>
          </div>
        )}

        {estimate && !estimate.isFood && (
          <Card className="mt-3">
            <div className="text-[15px] font-bold">This doesn’t look like food.</div>
            <p className="mt-1 text-[13px] text-muted">Try another photo with the whole plate in frame, or add the meal manually.</p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" icon="camera" className="flex-1" onClick={() => camera.current?.click()}>
                Retake
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setManual(true)}>
                Add manually
              </Button>
            </div>
          </Card>
        )}

        {estimate && estimate.isFood && !manual && totals && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-full bg-accent/12 px-2.5 py-1 text-[11px] font-extrabold tracking-[0.14em] text-accent">AI ESTIMATE</span>
              <Chip color={CONF_COLOR[estimate.overallConfidence]}>{estimate.overallConfidence} confidence</Chip>
            </div>
            <TextInput value={estimate.mealName} onChange={(v) => setEstimate({ ...estimate, mealName: v.slice(0, 60) })} aria-label="Meal name" className="mt-2 !text-[18px] font-bold" />

            <Card className="mt-2 !p-3">
              <div className="num grid grid-cols-4 gap-1 text-center">
                <div>
                  <div className="text-[20px] font-extrabold">~{totals.calories}</div>
                  <div className="text-[11px] text-muted">kcal</div>
                </div>
                <div>
                  <div className="text-[18px] font-bold">{totals.protein} g</div>
                  <div className="text-[11px] text-muted">protein</div>
                </div>
                <div>
                  <div className="text-[18px] font-bold">{totals.carbs} g</div>
                  <div className="text-[11px] text-muted">carbs</div>
                </div>
                <div>
                  <div className="text-[18px] font-bold">{totals.fat} g</div>
                  <div className="text-[11px] text-muted">fat</div>
                </div>
              </div>
              <p className="mt-2 text-[12px] text-muted">Approximate values from a photo. Portions and hidden ingredients can change the real numbers.</p>
            </Card>

            {diff && <DiffCard diff={diff.d} summary={diff.summary} />}

            {estimate.questions.length > 0 && (
              <div className="mt-3 space-y-2">
                {estimate.questions.map((q) => (
                  <div key={q.id} className="rounded-2xl border border-line bg-surface p-3">
                    <div className="text-[14px] font-semibold">{q.text}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {q.options.map((o) => (
                        <button key={o} type="button" disabled={!!busy} onClick={() => void revise(`${q.text} → ${o}`)} className="min-h-11 rounded-full border border-accent/30 bg-surface px-4 text-[14px] font-semibold text-accent active:scale-95 disabled:opacity-50">
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 space-y-2">
              {estimate.foods.map((f, i) => (
                <FoodRow key={`${i}-${f.name}`} f={f} editing={editing} onChange={(x) => updateFood(i, x)} onRemove={() => removeFood(i)} />
              ))}
            </div>

            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void revise(correction);
              }}
            >
              <TextInput voice value={correction} onChange={setCorrection} placeholder="Correct it: “it was turkey”, “200 g of rice”…" aria-label="Correct the estimate" className="min-w-0 flex-1" />
              <Button type="submit" className="!h-12 shrink-0" loading={busy === 'revise'} disabled={!correction.trim() || !!busy}>
                Update
              </Button>
            </form>

            <button type="button" onClick={() => void explain()} disabled={!!busy} className="mt-2 flex min-h-11 items-center gap-1 text-[14px] font-semibold text-accent disabled:opacity-50">
              <Icon name="info" size={16} /> {busy === 'explain' ? 'Asking…' : 'Why so many calories?'}
            </button>
            {explanation && <p className="rounded-2xl bg-surface-2 px-3 py-2 text-[13px] leading-snug">{explanation}</p>}

            {(estimate.assumptions.length > 0 || estimate.unknowns.length > 0 || estimate.plateContext) && (
              <details className="mt-2 rounded-2xl bg-surface p-3 shadow-card">
                <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold">Assumptions & unknowns</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-muted">
                  {estimate.plateContext && <li>Portion size from: {estimate.plateContext}</li>}
                  {estimate.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                  {estimate.unknowns.map((u) => (
                    <li key={u}>Not visible: {u}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="sticky bottom-0 -mx-4 mt-4 bg-gradient-to-t from-bg via-bg to-transparent px-4 pt-4 pb-[max(8px,var(--safe-bottom))]">
              <Button block size="lg" icon="check" loading={busy === 'save'} disabled={!estimate.foods.length || (!!busy && busy !== 'save')} onClick={() => void addToToday()}>
                ADD TO TODAY · ~{totals.calories} kcal
              </Button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="secondary" icon="edit" onClick={() => setEditing((x) => !x)}>
                  {editing ? 'Done editing' : 'EDIT'}
                </Button>
                <Button variant="secondary" icon="close" onClick={() => navigate('/nutrition', { replace: true })}>
                  CANCEL
                </Button>
              </div>
            </div>
          </>
        )}

        {manual && (
          <div className="mt-4">
            <MealBuilder key={estimate ? 'est' : 'manual'} photo={settings.coach.ai.savePhotos ? thumb : undefined} source={estimate ? 'ai' : image ? 'photo' : 'manual'} name={estimate?.mealName || defaultMealName()} initial={estimate ? estimateToItems(estimate) : []} onDone={() => navigate('/nutrition', { replace: true })} />
          </div>
        )}
      </div>
    </div>
  );
}

function PrivacyNote({ aiOn, savePhotos, reason, onSettings }: { aiOn: boolean; savePhotos: boolean; reason?: string; onSettings: () => void }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2 text-[12px] leading-snug text-muted">
      {aiOn ? (
        <>
          The photo is compressed and sent to <b>Gemini (Google)</b> to estimate the meal. It isn’t stored on the LifeForge server. Values are approximate and you review everything before it’s logged.
        </>
      ) : (
        reason
      )}{' '}
      Save Food Photos: <b>{savePhotos ? 'ON (small thumbnail on this device)' : 'OFF'}</b>.{' '}
      <button type="button" className="hit-44 font-semibold text-accent" onClick={onSettings}>
        Settings
      </button>
    </div>
  );
}
