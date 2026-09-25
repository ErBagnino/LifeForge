import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { TextInput } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { aiReady } from '@/services/ai/claude';
import { downscale, estimateFromPhoto, type FoodEstimate, roundItem } from '@/services/foodService';
import { useGame } from '@/store/gameStore';
import { defaultMealName, MealBuilder } from './MealBuilder';

/** Food camera: take (or pick) a photo, optionally estimate it with AI, review and log. */
export default function FoodScanScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ thumb: string; full: string } | null>(null);
  const [estimate, setEstimate] = useState<FoodEstimate | null>(null);
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;
  const canEstimate = aiReady(settings.coach.ai.enabled, settings.coach.ai.model);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    setEstimate(null);
    try {
      const [thumb, full] = await Promise.all([downscale(file, 360, 0.7), downscale(file, 1024, 0.8)]);
      setPhoto({ thumb, full });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const analyze = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      setEstimate(await estimateFromPhoto(photo.full, settings.coach.ai.model, hint.trim() || undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto min-h-full max-w-[640px] pb-[calc(var(--safe-bottom)+24px)]">
      <header className="glass sticky top-0 z-20 border-b border-line pt-safe">
        <div className="flex h-12 items-center gap-2 px-safe">
          <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/nutrition'))} className="-ml-2 flex h-11 items-center gap-0.5 pr-2 text-[17px] text-accent" aria-label="Back">
            <Icon name="chevronLeft" size={26} /> Back
          </button>
          <div className="flex-1 text-center text-[16px] font-bold">Food photo</div>
          <span className="w-16" />
        </div>
      </header>

      <div className="px-safe pt-4">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-surface-2 shadow-card">
          {photo ? (
            <motion.img initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} src={photo.full} alt="Your meal" className="h-full w-full object-cover" />
          ) : (
            <button type="button" onClick={() => camera.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted" aria-label="Take a photo of your meal">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface">
                <Icon name="camera" size={30} />
              </span>
              <span className="text-[15px] font-semibold">Point at your plate</span>
              <span className="text-[12px]">Good light, whole plate in frame</span>
              <span className="pointer-events-none absolute inset-5 rounded-2xl border-2 border-dashed border-fg/15" />
            </button>
          )}
        </div>

        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        <input ref={library} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

        {!photo ? (
          <div className="mt-4 space-y-2">
            <Button block size="lg" icon="camera" className="!h-16 !text-[18px]" onClick={() => camera.current?.click()}>
              Take Photo
            </Button>
            <Button block variant="secondary" icon="image" onClick={() => library.current?.click()}>
              Choose from library
            </Button>
            <p className="px-1 pt-1 text-[12px] text-muted">
              {canEstimate ? 'Your AI key can estimate the meal from the photo — you review everything before it’s logged.' : 'The photo is saved with your meal. Add the foods below in a few taps (AI estimates are optional: Settings → Coach & AI).'}
            </p>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" icon="camera" className="flex-1" onClick={() => camera.current?.click()}>
              Retake
            </Button>
            {canEstimate && !estimate && (
              <Button icon="sparkles" className="flex-[1.4]" loading={busy} onClick={() => void analyze()}>
                Estimate with AI
              </Button>
            )}
          </div>
        )}

        {photo && canEstimate && !estimate && (
          <TextInput value={hint} onChange={setHint} placeholder="Optional hint, e.g. “half portion, no dressing”" aria-label="Hint for the estimate" className="mt-2" />
        )}
        {error && <p className="mt-3 rounded-2xl bg-danger/10 px-3 py-2 text-[13px] font-semibold text-danger">{error}</p>}

        {estimate && (
          <Card className="mt-3 !p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-muted">AI estimate</div>
              <Chip>{estimate.confidence} confidence</Chip>
            </div>
            {estimate.note && <p className="mt-1 text-[12px] text-muted">{estimate.note}</p>}
          </Card>
        )}

        {photo && (
          <div className="mt-4">
            <MealBuilder
              key={estimate ? 'est' : 'manual'}
              photo={photo.thumb}
              source={estimate ? 'ai' : 'photo'}
              name={estimate?.meal_name || defaultMealName()}
              initial={estimate?.items.map(roundItem) ?? []}
              onDone={() => navigate('/nutrition', { replace: true })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
