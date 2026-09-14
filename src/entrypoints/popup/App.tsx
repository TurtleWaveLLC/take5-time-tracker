import { type FunctionComponent } from "preact";
import { useState, useEffect } from "preact/hooks";
import type {
  ActiveTab,
  Day,
  History,
  ExtensionSettings,
} from "../../../types";
import { getDateKey } from "../../shared/utils";
import { extractHourTimes } from "../../shared/session";
import {
  TimelineChart,
  DomainList,
  type DomainListItem,
} from "../../shared/components";
import { useDataExport } from "./useDataExport";

interface SessionData {
  domain: string;
  currentTime: number;
  isActive: boolean;
  isPaused: boolean;
  startTime: number;
}

interface StorageData {
  activeTab: ActiveTab | null;
  todayData: Day | null;
  history: History | null;
  settings: ExtensionSettings | null;
}

interface PopupState {
  currentSession: SessionData | null;
  todayTotal: number;
  loading: boolean;
  error: string | null;
  showDebug: boolean;
  storageData: StorageData | null;
}

/**
 * Format milliseconds to HH:MM:SS display string
 */
function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Get default settings (matches SettingsRepository.getDefaultSettings)
 */
function getDefaultSettings(): ExtensionSettings {
  return {
    pillPosition: { x: 9999, y: 20 },
    pillVisibility: true,
    pillShowFullInfo: false,
    pillHidden: false,
    dataRetentionDays: 30,
    excludedDomains: [],
  };
}

export const App: FunctionComponent = () => {
  const [state, setState] = useState<PopupState>({
    currentSession: null,
    todayTotal: 0,
    loading: true,
    error: null,
    showDebug: false,
    storageData: null,
  });

  useEffect(() => {
    async function loadData(): Promise<void> {
      try {
        const timestamp = Date.now();
        // Get current browser tab to determine domain
        const [browserTab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const currentDomain = browserTab?.url
          ? new URL(browserTab.url).hostname
          : null;

        // Get all storage data
        const data = await browser.storage.local.get(null);
        const activeTab = data.activeTab as ActiveTab | null;
        const todayKey = getDateKey();
        const todayData = data[`day_${todayKey}`] as Day | null;
        const history = data.history as History | null;

        // Calculate today's total from day record
        let todayTotal = todayData?.totalTime ?? 0;
        // If active session exists, add elapsed time since last checkpoint
        if (activeTab?.active) {
          todayTotal += timestamp ? timestamp - activeTab.lastTimerCheck : 0;
        }

        // Get current session data if active and matches current tab
        let currentSession: SessionData | null = null;
        if (activeTab && currentDomain && activeTab.domain === currentDomain) {
          // Calculate display time: totalTime + elapsed if actively tracking
          const elapsed = activeTab.active && timestamp
            ? timestamp - activeTab.lastTimerCheck
            : 0;
          const displayTime = activeTab.totalTime + elapsed;

          currentSession = {
            domain: activeTab.domain,
            currentTime: displayTime,
            isActive: activeTab.active,
            isPaused: !activeTab.active,
            startTime: activeTab.lastActivated,
          };
        }

        setState((prev) => ({
          ...prev,
          currentSession,
          todayTotal,
          loading: false,
          error: null,
          storageData: {
            activeTab: activeTab,
            todayData: todayData,
            history: history,
            settings:
              (data.settings as ExtensionSettings) ?? getDefaultSettings(),
          },
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load data",
        }));
      }
    }

    loadData();

    // Update every second for live time display
    const interval = window.setInterval(loadData, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const toggleDebug = (): void => {
    setState((prev) => ({ ...prev, showDebug: !prev.showDebug }));
  };

  const dataExport = useDataExport();

  // Derive domain items for the DomainList
  const domainItems: DomainListItem[] = (() => {
    const domains = state.storageData?.todayData?.domains;
    if (!domains) return [];

    const activeTab = state.storageData?.activeTab;
    const now = Date.now();

    return Object.entries(domains).map(([domain, data]) => {
      const isActiveDomain = !!(activeTab?.active && activeTab.domain === domain);

      // Add elapsed time for the currently active domain
      let activeTime = data.totalTime;
      if (isActiveDomain) {
        activeTime += now - activeTab.lastTimerCheck;
      }

      return {
        domain,
        visitCount: data.visitCount,
        activeTime,
        isActive: isActiveDomain,
      };
    });
  })();

  if (state.loading) {
    return (
      <div class="popup-container">
        <div class="loading">Loading...</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div class="popup-container">
        <div class="error">{state.error}</div>
      </div>
    );
  }

  return (
    <div class="popup-container">
      <header class="header">
        <h1>Web Time Tracker</h1>
      </header>

      <section class="current-session">
        <h2>Current Session</h2>
        {state.currentSession ? (
          <div class="session-info">
            <div class="time-display">
              {formatTime(state.currentSession.currentTime)}
            </div>
            <div class="domain-name">{state.currentSession.domain}</div>
            {state.currentSession.isPaused && (
              <div class="status paused">Paused</div>
            )}
          </div>
        ) : (
          <div class="no-session">No active session</div>
        )}
      </section>

      <div class="divider" />

      <section class="today-total">
        <h2>Today's Total</h2>
        <div class="time-display total">{formatTime(state.todayTotal)}</div>
      </section>

      <div class="divider" />

      <section class="timeline-section">
        <h2>Browsing Time, Today</h2>
        <TimelineChart
          hourTimes={extractHourTimes(state.storageData?.todayData ?? null)}
          currentDatetime={new Date()}
        />
      </section>

      <div class="divider" />

      <section class="domains-section">
        <h2>Most Active Sites</h2>
        {domainItems.length > 0 ? (
          <DomainList
            items={domainItems}
            sortBy={(a, b) => b.activeTime - a.activeTime}
            maxRows={10}
          />
        ) : (
          <div class="no-domains">No sites tracked yet</div>
        )}
      </section>

      <div class="divider" />

      <section class="data-section">
        <div class="export-anchor">
          <button
            class="secondary-button export-button"
            onClick={dataExport.startExport}
            disabled={dataExport.status === "pending"}
          >
            <span>
              {dataExport.status === "success"
                ? "Exported ✓"
                : "Export My Data"}
            </span>
            {dataExport.status === "pending" && (
              <span class="spinner" aria-hidden="true" />
            )}
          </button>
          <div class="export-tooltip" role="tooltip">
            {dataExport.status === "error"
              ? `Export failed: ${dataExport.error}`
              : "Downloads a JSON file with your browsing-time history and settings. Your data stays on your device."}
          </div>
        </div>
      </section>

      <section class="debug-section">
        <button class="secondary-button" onClick={toggleDebug}>
          {state.showDebug ? "Hide" : "Show"} Storage Data
        </button>

        {state.showDebug && state.storageData && (
          <div class="debug-data">
            <div class="debug-item">
              <h3>Active Tab</h3>
              <pre>{JSON.stringify(state.storageData.activeTab, null, 2)}</pre>
            </div>

            <div class="debug-item">
              <h3>Today's Data</h3>
              <pre>{JSON.stringify(state.storageData.todayData, null, 2)}</pre>
            </div>

            <div class="debug-item">
              <h3>History</h3>
              <pre>{JSON.stringify(state.storageData.history, null, 2)}</pre>
            </div>

            <div class="debug-item">
              <h3>Settings</h3>
              <pre>{JSON.stringify(state.storageData.settings, null, 2)}</pre>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
