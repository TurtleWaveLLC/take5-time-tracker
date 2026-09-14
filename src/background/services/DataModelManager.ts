/**
 * DataModelManager - Business logic layer for time tracking data
 *
 * Manages the data model lifecycle, including:
 * - ActiveTab state management (in-memory)
 * - Lifecycle event handling (TabEnter, TabExit, HourElapsed, DayElapsed)
 * - History/Day/Hour aggregations
 * - Hour/day boundary detection
 *
 * Coordinates with repositories for persistence while keeping
 * domain-specific logic separate from storage operations.
 */

import type {
  ActiveTab,
  Day,
  LifecycleEventContext,
} from "../../../types";
import {
  HistoryRepository,
  type TabRepository,
  type SettingsRepository,
} from "../../shared/repositories";

export class DataModelManager {
  private static instance: DataModelManager | null = null;

  private historyRepository: HistoryRepository;
  private tabRepository: TabRepository;
  private settingsRepository: SettingsRepository;

  // In-memory active tab state for fast access
  private activeTab: ActiveTab | null = null;

  private constructor(
    historyRepository: HistoryRepository,
    tabRepository: TabRepository,
    settingsRepository: SettingsRepository
  ) {
    this.historyRepository = historyRepository;
    this.tabRepository = tabRepository;
    this.settingsRepository = settingsRepository;
  }

  public static getInstance(
    historyRepository?: HistoryRepository,
    tabRepository?: TabRepository,
    settingsRepository?: SettingsRepository
  ): DataModelManager {
    if (!DataModelManager.instance) {
      if (!historyRepository || !tabRepository || !settingsRepository) {
        throw new Error(
          "DataModelManager must be initialized with all repositories on first call"
        );
      }
      DataModelManager.instance = new DataModelManager(
        historyRepository,
        tabRepository,
        settingsRepository
      );
    }
    return DataModelManager.instance;
  }

  public static resetInstance(): void {
    if (DataModelManager.instance) {
      DataModelManager.instance.cleanup();
    }
    DataModelManager.instance = null;
  }

  /**
   * Initialize the data model manager
   * Restores active tab state from storage and sets up boundary detection
   */
  async initialize(): Promise<void> {
    try {
      // Restore active tab state from storage
      this.activeTab = await this.tabRepository.getActiveTab();

      // If there was an active tab, update lastTimerCheck to now
      if (this.activeTab) {
        this.activeTab.lastTimerCheck = Date.now();
        await this.tabRepository.setActiveTab(this.activeTab);
      }

      // Setup boundary detection using browser.alarms (MV3 compatible)
      this.setupAlarmBoundaryDetection();

      // Clear expired days based on retention settings
      await this.clearExpiredDays();

      console.log("DataModelManager initialized successfully");
    } catch (error) {
      console.error("DataModelManager.initialize error:", error);
      throw new Error(`Failed to initialize DataModelManager: ${error}`);
    }
  }

  /**
   * Handle tab enter event - called when user navigates to a new domain
   */
  async handleTabEnter(context: LifecycleEventContext): Promise<ActiveTab> {
    const { domain, timestamp } = context;

    try {
      // First, handle any existing active tab exit
      if (this.activeTab && this.activeTab.domain !== domain) {
        await this.handleTabExit();
      }

      // Get or create today's day record
      const today = await this.getOrCreateToday();
      const existingDomainData = today.domains[domain];

      // Calculate accumulated time for this domain today
      const accumulatedTime = existingDomainData?.totalTime ?? 0;

      // Create new active tab state
      this.activeTab = {
        domain,
        totalTime: accumulatedTime,
        active: true,
        lastActivated: timestamp,
        lastTimerCheck: timestamp,
      };

      // Persist to storage
      await this.tabRepository.setActiveTab(this.activeTab);

      // Update domain visit count in today's record
      await this.incrementDomainVisit(domain, timestamp);

      console.log(`Tab entered: ${domain}, accumulated time: ${accumulatedTime}ms`);

      return this.activeTab;
    } catch (error) {
      console.error("DataModelManager.handleTabEnter error:", error);
      throw new Error(`Failed to handle tab enter: ${error}`);
    }
  }

  /**
   * Handle tab exit event - called when user leaves the current domain
   */
  async handleTabExit(): Promise<void> {
    if (!this.activeTab) {
      return;
    }

    try {
      const now = Date.now();
      const elapsed = now - this.activeTab.lastTimerCheck;

      // Update time records
      await this.recordElapsedTime(elapsed, now);

      // Clear active tab
      this.activeTab = null;
      await this.tabRepository.setActiveTab(null);

      console.log("Tab exited");
    } catch (error) {
      console.error("DataModelManager.handleTabExit error:", error);
      throw new Error(`Failed to handle tab exit: ${error}`);
    }
  }

  /**
   * Handle hour elapsed event - called when crossing an hour boundary
   */
  async handleHourElapsed(): Promise<void> {
    if (!this.activeTab || !this.activeTab.active) {
      return;
    }

    try {
      await this.checkpointNow();
      console.log("Hour boundary crossed, time recorded");
    } catch (error) {
      console.error("DataModelManager.handleHourElapsed error:", error);
    }
  }

  /**
   * Checkpoint the live session into storage immediately.
   *
   * Folds elapsed time since the last checkpoint into today's day record so
   * that storage reflects this exact moment. The single checkpoint
   * implementation: hour boundaries delegate here, and export calls it so
   * the file isn't missing un-checkpointed seconds. No-op when nothing is
   * actively tracking.
   */
  async checkpointNow(): Promise<void> {
    if (!this.activeTab || !this.activeTab.active) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.activeTab.lastTimerCheck;

    await this.recordElapsedTime(elapsed, now);

    this.activeTab.lastTimerCheck = now;
    await this.tabRepository.setActiveTab(this.activeTab);
  }

  /**
   * Handle day elapsed event - called when crossing a day boundary
   */
  async handleDayElapsed(): Promise<void> {
    if (!this.activeTab || !this.activeTab.active) {
      return;
    }

    try {
      const now = Date.now();
      const elapsed = now - this.activeTab.lastTimerCheck;

      // Record remaining time to yesterday
      await this.recordElapsedTime(elapsed, this.activeTab.lastTimerCheck);

      // Reset accumulated time for the new day
      this.activeTab.totalTime = 0;
      this.activeTab.lastTimerCheck = now;
      this.activeTab.lastActivated = now;
      await this.tabRepository.setActiveTab(this.activeTab);

      // Clear expired days
      await this.clearExpiredDays();

      console.log("Day boundary crossed, new day started");

      // Re-setup boundary alarms for the new day
      this.setupAlarmBoundaryDetection();
    } catch (error) {
      console.error("DataModelManager.handleDayElapsed error:", error);
    }
  }

  /**
   * Pause the current session
   */
  async pauseSession(): Promise<ActiveTab | null> {
    if (!this.activeTab) {
      return null;
    }

    try {
      const now = Date.now();
      const elapsed = now - this.activeTab.lastTimerCheck;

      // Record elapsed time before pausing
      await this.recordElapsedTime(elapsed, now);

      // Mark as inactive
      this.activeTab.active = false;
      this.activeTab.lastTimerCheck = now;
      await this.tabRepository.setActiveTab(this.activeTab);

      console.log(`Session paused for ${this.activeTab.domain}`);
      return this.activeTab;
    } catch (error) {
      console.error("DataModelManager.pauseSession error:", error);
      return null;
    }
  }

  /**
   * Resume the current session
   */
  async resumeSession(): Promise<ActiveTab | null> {
    if (!this.activeTab) {
      return null;
    }

    try {
      const now = Date.now();

      // Mark as active and update checkpoint
      this.activeTab.active = true;
      this.activeTab.lastTimerCheck = now;
      await this.tabRepository.setActiveTab(this.activeTab);

      console.log(`Session resumed for ${this.activeTab.domain}`);
      return this.activeTab;
    } catch (error) {
      console.error("DataModelManager.resumeSession error:", error);
      return null;
    }
  }

  /**
   * Get the current display time for the active tab
   * Returns totalTime + time since lastTimerCheck if active
   */
  getCurrentDisplayTime(): number {
    if (!this.activeTab) {
      return 0;
    }

    if (!this.activeTab.active) {
      return this.activeTab.totalTime;
    }

    const now = Date.now();
    const elapsed = now - this.activeTab.lastTimerCheck;
    return this.activeTab.totalTime + elapsed;
  }

  /**
   * Get the current active tab state
   */
  getActiveTab(): ActiveTab | null {
    return this.activeTab;
  }

  /**
   * Check if a domain is excluded from tracking
   */
  async isDomainExcluded(domain: string): Promise<boolean> {
    return this.settingsRepository.isDomainExcluded(domain);
  }

  /**
   * Clear expired days based on retention settings
   */
  private async clearExpiredDays(): Promise<void> {
    try {
      const settings = await this.settingsRepository.getSettings();
      const deletedCount = await this.historyRepository.clearExpiredDays(
        settings.dataRetentionDays
      );
      if (deletedCount > 0) {
        console.log(`Cleared ${deletedCount} expired days`);
      }
    } catch (error) {
      console.error("DataModelManager.clearExpiredDays error:", error);
    }
  }

  /**
   * Get or create today's day record
   */
  private async getOrCreateToday(): Promise<Day> {
    const now = Date.now();
    const dateKey = HistoryRepository.getDateKey(now);
    let today = await this.historyRepository.getDay(dateKey);

    if (!today) {
      const midnightTimestamp = HistoryRepository.getMidnightTimestamp(now);
      today = this.historyRepository.createEmptyDay(midnightTimestamp);
      await this.historyRepository.setDay(dateKey, today);
    }

    return today;
  }

  /**
   * Record elapsed time to the appropriate hour and day
   */
  private async recordElapsedTime(elapsed: number, timestamp: number): Promise<void> {
    if (elapsed <= 0 || !this.activeTab) {
      return;
    }

    const domain = this.activeTab.domain;
    const dateKey = HistoryRepository.getDateKey(timestamp);
    const hour = new Date(timestamp).getHours();

    // Get or create today's record
    let today = await this.historyRepository.getDay(dateKey);
    if (!today) {
      const midnightTimestamp = HistoryRepository.getMidnightTimestamp(timestamp);
      today = this.historyRepository.createEmptyDay(midnightTimestamp);
    }

    // Update day total
    today.totalTime += elapsed;

    // Update hour data
    if (!today.hours[hour]) {
      today.hours[hour] = { domains: {}, totalTime: 0 };
    }
    if (!today.hours[hour].domains[domain]) {
      today.hours[hour].domains[domain] = { totalTime: 0, visitCount: 0 };
    }
    today.hours[hour].domains[domain].totalTime += elapsed;
    today.hours[hour].totalTime = (today.hours[hour].totalTime ?? 0) + elapsed;

    // Update domain day data
    if (!today.domains[domain]) {
      today.domains[domain] = {
        totalTime: 0,
        visitCount: 0,
        lastVisited: timestamp,
        lastTimerCheck: timestamp,
      };
    }
    today.domains[domain].totalTime += elapsed;
    today.domains[domain].lastTimerCheck = timestamp;

    // Persist changes
    await this.historyRepository.setDay(dateKey, today);

    // Update in-memory active tab
    if (this.activeTab) {
      this.activeTab.totalTime += elapsed;
      this.activeTab.lastTimerCheck = timestamp;
    }
  }

  /**
   * Increment domain visit count
   */
  private async incrementDomainVisit(domain: string, timestamp: number): Promise<void> {
    const dateKey = HistoryRepository.getDateKey(timestamp);
    const hour = new Date(timestamp).getHours();

    let today = await this.historyRepository.getDay(dateKey);
    if (!today) {
      return;
    }

    // Increment hour visit count
    if (today.hours[hour]?.domains[domain]) {
      today.hours[hour].domains[domain].visitCount++;
    }

    // Increment day visit count
    if (today.domains[domain]) {
      today.domains[domain].visitCount++;
      today.domains[domain].lastVisited = timestamp;
    } else {
      today.domains[domain] = {
        totalTime: 0,
        visitCount: 1,
        lastVisited: timestamp,
        lastTimerCheck: timestamp,
      };
    }

    await this.historyRepository.setDay(dateKey, today);
  }

  /**
   * Setup boundary detection using browser.alarms API (MV3 compatible)
   * Replaces setTimeout-based approach which doesn't work in MV3 service workers
   */
  private setupAlarmBoundaryDetection(): void {
    // Clear any existing alarms
    browser.alarms.clear('hour-boundary');
    browser.alarms.clear('day-boundary');

    const now = new Date();

    // Calculate minutes until next hour (minimum 1 minute for Chrome alarms)
    const minutesUntilNextHour = Math.max(1, 60 - now.getMinutes());
    browser.alarms.create('hour-boundary', {
      delayInMinutes: minutesUntilNextHour,
      periodInMinutes: 60, // Repeat every hour
    });

    // Calculate minutes until midnight
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const minutesUntilMidnight = Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 60000));
    browser.alarms.create('day-boundary', {
      delayInMinutes: minutesUntilMidnight,
      periodInMinutes: 1440, // Repeat every 24 hours
    });

    console.log(`Boundary alarms set: hour in ${minutesUntilNextHour}min, day in ${minutesUntilMidnight}min`);
  }

  /**
   * Cleanup alarms and resources
   */
  private cleanup(): void {
    browser.alarms.clear('hour-boundary');
    browser.alarms.clear('day-boundary');
  }
}
