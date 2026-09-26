import { MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { FxLayer } from '@/components/fx/FxLayer';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { AskSheet } from '@/components/layout/AskSheet';
import { Tutorial } from '@/features/tutorial/Tutorial';
import { TabBar } from '@/components/layout/TabBar';
import { Skeleton } from '@/components/ui/primitives';
import { useKeyboardInset, useOnline, useThemeSync } from '@/hooks';
import { onResume, useGame } from '@/store/gameStore';
import { APP_CONFIG } from '@/config/app';
import { usePwaUpdate } from './pwa';
import TodayScreen from '@/features/today/TodayScreen';

const QuestsScreen = lazy(() => import('@/features/quests/QuestsScreen'));
const RoutinesScreen = lazy(() => import('@/features/quests/RoutinesScreen'));
const TrainScreen = lazy(() => import('@/features/train/TrainScreen'));
const WorkoutLogger = lazy(() => import('@/features/train/WorkoutLogger'));
const ExercisesScreen = lazy(() => import('@/features/train/ExercisesScreen'));
const ExerciseDetail = lazy(() => import('@/features/train/ExerciseDetail'));
const PlanEditor = lazy(() => import('@/features/train/PlanEditor'));
const CardioScreen = lazy(() => import('@/features/train/CardioScreen'));
const WorldScreen = lazy(() => import('@/features/world/WorldScreen'));
const ShopScreen = lazy(() => import('@/features/world/ShopScreen'));
const AvatarEditor = lazy(() => import('@/features/world/AvatarEditor'));
const StatsScreen = lazy(() => import('@/features/stats/StatsScreen'));
const CalendarScreen = lazy(() => import('@/features/stats/CalendarScreen'));
const AdvancedStats = lazy(() => import('@/features/stats/AdvancedStats'));
const RecordsScreen = lazy(() => import('@/features/stats/RecordsScreen'));
const DailyRecap = lazy(() => import('@/features/review/DailyRecap'));
const WeeklyReview = lazy(() => import('@/features/review/WeeklyReview'));
const ProfileScreen = lazy(() => import('@/features/profile/ProfileScreen'));
const AchievementsScreen = lazy(() => import('@/features/profile/AchievementsScreen'));
const PlayTimeScreen = lazy(() => import('@/features/play/PlayTimeScreen'));
const SearchScreen = lazy(() => import('@/features/search/SearchScreen'));
const SettingsScreen = lazy(() => import('@/features/settings/SettingsScreen'));
const SettingsSection = lazy(() => import('@/features/settings/SettingsSection'));
const AdminScreen = lazy(() => import('@/features/admin/AdminScreen'));
const ActivitiesAdmin = lazy(() => import('@/features/admin/ActivitiesAdmin'));
const ActivityEditor = lazy(() => import('@/features/admin/ActivityEditor'));
const RulesEditor = lazy(() => import('@/features/admin/RulesEditor'));
const EconomyEditor = lazy(() => import('@/features/admin/EconomyEditor'));
const AiImportScreen = lazy(() => import('@/features/admin/AiImportScreen'));
const RoutinesAdmin = lazy(() => import('@/features/admin/RoutinesAdmin'));
const DevToolbox = lazy(() => import('@/features/dev/DevToolbox'));
const Onboarding = lazy(() => import('@/features/onboarding/Onboarding'));
const CoachScreen = lazy(() => import('@/features/coach/CoachScreen'));
const NutritionScreen = lazy(() => import('@/features/nutrition/NutritionScreen'));
const FoodScanScreen = lazy(() => import('@/features/nutrition/FoodScanScreen'));

function PageFallback() {
  return (
    <div className="space-y-3 px-4 pt-[calc(var(--safe-top)+24px)]">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-32" />
      <Skeleton className="h-24" />
    </div>
  );
}

function Shell() {
  const location = useLocation();
  const hideTabs = location.pathname.startsWith('/train/workout') || location.pathname.startsWith('/coach') || location.pathname.startsWith('/nutrition/scan');
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <>
      <main id="main" className="mx-auto w-full max-w-[640px]">
        <ErrorBoundary inline key={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      {!hideTabs && <TabBar />}
      <AskSheet />
      <Tutorial />
    </>
  );
}

function Banner() {
  const online = useOnline();
  const { needRefresh, update } = usePwaUpdate();
  if (online && !needRefresh) return null;
  return (
    <div className="fixed inset-x-0 z-[75] flex justify-center px-3" style={{ bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 10px)' }}>
      {!online ? (
        <div className="rounded-full bg-fg px-4 py-2 text-[13px] font-semibold text-bg shadow-float">Offline — everything still works locally ✓</div>
      ) : (
        <button type="button" onClick={update} className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent shadow-float">
          New version available — tap to update
        </button>
      )}
    </div>
  );
}

function Boot() {
  const status = useGame((s) => s.status);
  const error = useGame((s) => s.error);
  const boot = useGame((s) => s.boot);
  useThemeSync();
  useKeyboardInset();

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void onResume();
    };
    document.addEventListener('visibilitychange', onVis);
    const id = setInterval(() => void onResume(), 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(id);
    };
  }, []);

  if (status === 'booting') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" aria-busy="true">
        <div className="text-6xl">⚒️</div>
        <div className="text-[22px] font-black tracking-[0.2em]">{APP_CONFIG.name}</div>
        <div className="h-1 w-28 overflow-hidden rounded-full bg-surface-2">
          <div className="lf-skeleton h-full w-full" />
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-3xl bg-surface p-6 text-center shadow-card">
          <div className="text-5xl">💾</div>
          <h1 className="mt-3 text-[20px] font-bold">Could not open local storage</h1>
          <p className="mt-2 text-[14px] text-muted">
            {APP_CONFIG.displayName} stores everything on this device (IndexedDB). Private browsing or blocked storage can prevent that.
          </p>
          <pre className="mt-3 rounded-xl bg-surface-2 p-2 text-left text-[11px] text-muted">{error}</pre>
          <button type="button" className="mt-4 h-11 w-full rounded-2xl bg-accent font-semibold text-on-accent" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (status === 'onboarding') {
    return (
      <Suspense fallback={<PageFallback />}>
        <Onboarding />
      </Suspense>
    );
  }
  return (
    <>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<TodayScreen />} />
          <Route path="quests" element={<QuestsScreen />} />
          <Route path="quests/routines" element={<RoutinesScreen />} />
          <Route path="train" element={<TrainScreen />} />
          <Route path="train/workout" element={<WorkoutLogger />} />
          <Route path="train/exercises" element={<ExercisesScreen />} />
          <Route path="train/exercise/:id" element={<ExerciseDetail />} />
          <Route path="train/plan" element={<PlanEditor />} />
          <Route path="train/cardio" element={<CardioScreen />} />
          <Route path="world" element={<WorldScreen />} />
          <Route path="world/shop" element={<ShopScreen />} />
          <Route path="world/avatar" element={<AvatarEditor />} />
          <Route path="stats" element={<StatsScreen />} />
          <Route path="stats/calendar" element={<CalendarScreen />} />
          <Route path="stats/advanced" element={<AdvancedStats />} />
          <Route path="stats/records" element={<RecordsScreen />} />
          <Route path="review/day" element={<DailyRecap />} />
          <Route path="review/week" element={<WeeklyReview />} />
          <Route path="profile" element={<ProfileScreen />} />
          <Route path="achievements" element={<AchievementsScreen />} />
          <Route path="play" element={<PlayTimeScreen />} />
          <Route path="search" element={<SearchScreen />} />
          <Route path="coach" element={<CoachScreen />} />
          <Route path="nutrition" element={<NutritionScreen />} />
          <Route path="nutrition/scan" element={<FoodScanScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="settings/:section" element={<SettingsSection />} />
          <Route path="admin" element={<AdminScreen />} />
          <Route path="admin/activities" element={<ActivitiesAdmin />} />
          <Route path="admin/activities/:id" element={<ActivityEditor />} />
          <Route path="admin/rules" element={<RulesEditor />} />
          <Route path="admin/economy" element={<EconomyEditor />} />
          <Route path="admin/ai" element={<AiImportScreen />} />
          <Route path="admin/routines" element={<RoutinesAdmin />} />
          <Route path="dev" element={<DevToolbox />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <FxLayer />
      <Banner />
    </>
  );
}

export function App() {
  const reduced = useGame((s) => s.settings?.reducedMotion ?? 'system');
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion={reduced === 'on' ? 'always' : reduced === 'off' ? 'never' : 'user'}>
        <BrowserRouter>
          <Boot />
        </BrowserRouter>
      </MotionConfig>
    </ErrorBoundary>
  );
}
