# Future iOS

LifeForge is a PWA, and a PWA on iOS **can't** access HealthKit, Live Activities, the Dynamic Island, widgets, the Apple
Watch or Screen Time data. The app doesn't fake any of these. This document explains what a native layer would add, what
the codebase already has ready for it, and which path to take when you want it.

> Short version: keep the web app as the product, and wrap it in a thin native shell (Capacitor) the day you want
> HealthKit or Live Activities. The domain, services and UI stay as they are.

---

## 1. What a native layer would unlock

| Capability | Framework | What LifeForge would do with it |
| --- | --- | --- |
| **Health data** | HealthKit | Read steps, walking/running distance, active energy, workouts, body weight, sleep and water automatically, instead of typing them into Quick Log. Optionally write completed workouts back to Health. |
| **Live Activities** | ActivityKit + WidgetKit | Lock-screen/Dynamic Island cards for: the **play-time timer** (live mm:ss vs the 90-min budget), the **rest timer** between sets, and the current quest ("Next: Brush teeth · 07:15"). |
| **Dynamic Island** | ActivityKit | Compact and expanded presentations of the Live Activities above, e.g. a ring that fills as play time is used. |
| **Reliable reminders** | UserNotifications | Schedule local notifications days ahead with no server. This removes the biggest PWA limitation (reminders only fire while the app is open unless Web Push is configured). |
| **Home & lock-screen widgets** | WidgetKit | Today Score ring, streak, HP/energy, next quest, play time left. |
| **Apple Watch** | watchOS app + WorkoutKit / HKWorkoutSession | Log sets and RPE from the wrist, rest-timer haptics, heart rate during cardio, a complication with the streak. |
| **Siri & Shortcuts** | App Intents | "Log 500 ml of water", "Start play timer", "What's my next quest?". Automations like "when I open TikTok → start the play timer". |
| **Screen Time** | FamilyControls + DeviceActivity + ManagedSettings | Automatic play-time tracking/limits for chosen apps (see the caveats below). |
| **Haptics** | Core Haptics / UIFeedbackGenerator | Proper haptics everywhere. The PWA only has the iOS `<input switch>` trick and `navigator.vibrate` where available. |

### Screen Time caveat (relevant for the play-time budget)
Apple's Screen Time APIs are privacy-preserving by design. An app **can't read your raw per-app usage minutes**. It can
(a) let you pick apps/categories, (b) get callbacks from a `DeviceActivityMonitor` extension when a usage *threshold* is
reached (e.g. 60 and 90 minutes of "Games + TikTok"), (c) show usage in a sandboxed `DeviceActivityReport` view, and
(d) shield apps with `ManagedSettings`. It needs the Family Controls entitlement (distribution requires Apple's approval).
The realistic design is threshold events → "Play time under budget" quest state, plus an optional shield at 90 min.
The manual timer stays as the fallback.

## 2. What's already prepared in the code

| Seam | Where | How a native layer plugs in |
| --- | --- | --- |
| **Repository layer** | `src/repositories/*` | All persistence goes through repositories, so a native store or sync could replace Dexie without touching services or UI. With a WebView shell, IndexedDB simply keeps working. |
| **Metric sources** | `MetricEntry.source` (`manual · timer · health · import`) | A HealthKit importer writes `source: 'health'` entries through `logMetric`, so quests, score, records and achievements react exactly as they do to manual input. De-duplicate per day/type by source. |
| **Notification providers** | `NotificationService` (`inapp · browser · webpush · native`) | Implement `NotificationProvider` with `id: 'native'` on top of Capacitor Local Notifications. The scheduler already produces a governed 24 h plan (`planReminders` → `governReminders`), which the native provider can schedule in full. |
| **Timers as data** | `meta.leisureTimer`, the workout logger's rest state | The play-time timer is `{ startedAt, kind }` and the rest timer is `{ endsAt, total }`. A Live Activity only needs a start/end time and the limit, and ActivityKit renders the countdown itself. |
| **Haptics facade** | `src/services/haptics.ts` | Swap the implementation for Capacitor Haptics. Call sites don't change. |
| **Pure domain** | `src/domain/*` | Engines are framework-free TypeScript and run unchanged in any JS runtime (WebView, React Native's Hermes, or a JSC-based widget pre-computation step). |

## 3. Options for the native shell

| | **Capacitor** (recommended) | Swift shell + WKWebView | React Native / Expo | Full SwiftUI rewrite |
| --- | --- | --- | --- | --- |
| Reuses the current app | ~100% (same React build) | ~100% | Domain/services only; the UI is rewritten | Game design only |
| HealthKit | Community plugins or a small custom plugin | Custom bridge | Libraries (e.g. `react-native-health`) | Native |
| Live Activities / Dynamic Island / widgets | Native Swift targets in the Xcode project + a small plugin to start/update activities | Same | Native targets + a module (Expo supports this with config plugins) | Native |
| Effort to first TestFlight | Low (days) | Low–medium (you write the bridge) | High (weeks) | Very high |
| Keeps the PWA for free | Yes (same codebase) | Yes | No | No |

**Why Capacitor:** it packages the existing `dist/` into an iOS app, gives a JS↔Swift plugin bridge, and lets you add Swift
targets (widget extension, Live Activity, Device Activity monitor, watch app) to the generated Xcode project. The same
repository keeps deploying the PWA to Vercel.

### Sketch of the Capacitor path
1. `npm i @capacitor/core @capacitor/ios && npx cap init LifeForge <bundle-id> --web-dir dist && npx cap add ios`.
2. Plugins: `@capacitor/local-notifications`, `@capacitor/haptics`, `@capacitor/app` (resume events → `onResume`), plus a
   HealthKit plugin (community or a custom one).
3. Add a `NativeProvider` to `NotificationService` and prefer it when `Capacitor.isNativePlatform()`.
4. Add `healthService.syncToday()` (read → `logMetric(type, value, { source: 'health', mode: 'set' })`), triggered on resume
   and from a background delivery observer.
5. Add a Widget Extension with an `ActivityAttributes` for `PlayTimer` and `RestTimer`, and a tiny custom plugin
   `LiveActivity.start/update/end`, called from `startLeisure/stopLeisure` and the workout logger.
6. Optional later: Device Activity Monitor extension (Screen Time thresholds), App Intents, watch app.

## 4. Building without a Mac

Compiling and signing an iOS app requires Xcode, which runs only on macOS. Without your own Mac you can use:

- **Cloud Mac CI**: GitHub Actions macOS runners, Codemagic, Bitrise, or Xcode Cloud. They build, sign and upload to
  TestFlight from the repository.
- **Expo EAS Build** (React Native path only), which builds in the cloud.
- **Rented cloud Macs** (e.g. MacStadium, AWS EC2 Mac) for occasional hands-on Xcode work.

You need an **Apple Developer Program** membership to install on your own iPhone through TestFlight or to publish.
Entitlements like HealthKit are self-service. **Family Controls (Screen Time) needs an approval request** for distribution.

## 5. Non-goals (still)

- No accounts, cloud profile, social or leaderboards, even with a native app. Data stays on the device, and iCloud backup
  of the app container (or the JSON export) is the backup story.
- No faked native features in the PWA: nothing pretends to be a Live Activity or to read Health data.
