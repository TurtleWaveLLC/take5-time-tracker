/**
 * HistoryRepository - Data access layer for History, Day, and Hour data
 *
 * Provides domain-specific operations while PersistenceManager remains
 * a pure generic storage abstraction.
 */

import type { History, Day, HourData } from "../../../types";
import { getDateKey, getMidnightTimestamp, DAY_STORAGE_PREFIX } from "../utils";
import type { PersistenceManager } from "../storage/PersistenceManager";

// Storage keys for v2 schema
const STORAGE_KEYS = {
  HISTORY: "history",
  DAY_PREFIX: DAY_STORAGE_PREFIX,
} as const;

// Exposed for snapshot-style readers (export); see ExportService
export const HISTORY_STORAGE_KEY = STORAGE_KEYS.HISTORY;

export class HistoryRepository {
  private static instance: HistoryRepository | null = null;
  private storage: PersistenceManager;

  private constructor(storage: PersistenceManager) {
    this.storage = storage;
  }

  public static getInstance(storage?: PersistenceManager): HistoryRepository {
    if (!HistoryRepository.instance) {
      if (!storage) {
        throw new Error(
          "HistoryRepository must be initialized with storage parameter on first call",
        );
      }
      HistoryRepository.instance = new HistoryRepository(storage);
    }
    return HistoryRepository.instance;
  }

  public static resetInstance(): void {
    HistoryRepository.instance = null;
  }

  /**
   * Get history metadata
   */
  async getHistory(): Promise<History> {
    try {
      const result = await this.storage.get(STORAGE_KEYS.HISTORY);
      return (
        (result[STORAGE_KEYS.HISTORY] as History) || this.createEmptyHistory()
      );
    } catch (error) {
      console.error("HistoryRepository.getHistory error:", error);
      return this.createEmptyHistory();
    }
  }

  /**
   * Set history metadata
   */
  async setHistory(history: History): Promise<void> {
    try {
      await this.storage.set({ [STORAGE_KEYS.HISTORY]: history });
    } catch (error) {
      console.error("HistoryRepository.setHistory error:", error);
      throw new Error(`Failed to set history: ${error}`);
    }
  }

  /**
   * Get a specific day's data by date key (YYYY-MM-DD format)
   */
  async getDay(dateKey: string): Promise<Day | null> {
    try {
      const storageKey = `${STORAGE_KEYS.DAY_PREFIX}${dateKey}`;
      const result = await this.storage.get(storageKey);
      return (result[storageKey] as Day) || null;
    } catch (error) {
      console.error(`HistoryRepository.getDay error for ${dateKey}:`, error);
      return null;
    }
  }

  /**
   * Set a specific day's data
   */
  async setDay(dateKey: string, day: Day): Promise<void> {
    try {
      const storageKey = `${STORAGE_KEYS.DAY_PREFIX}${dateKey}`;
      await this.storage.set({ [storageKey]: day });

      // Update history metadata
      const history = await this.getHistory();
      if (!history.days[dateKey]) {
        history.days[dateKey] = day;
      }

      // Update earliest/latest
      const dayTimestamp = day.timestamp;
      if (history.earliest === 0 || dayTimestamp < history.earliest) {
        history.earliest = dayTimestamp;
      }
      if (dayTimestamp > history.latest) {
        history.latest = dayTimestamp;
      }

      await this.setHistory(history);
    } catch (error) {
      console.error(`HistoryRepository.setDay error for ${dateKey}:`, error);
      throw new Error(`Failed to set day ${dateKey}: ${error}`);
    }
  }

  /**
   * Delete a specific day's data
   */
  async deleteDay(dateKey: string): Promise<void> {
    try {
      const storageKey = `${STORAGE_KEYS.DAY_PREFIX}${dateKey}`;
      await this.storage.remove(storageKey);

      // Update history metadata
      const history = await this.getHistory();
      delete history.days[dateKey];

      // Recalculate earliest/latest
      const dayKeys = Object.keys(history.days);
      if (dayKeys.length === 0) {
        history.earliest = 0;
        history.latest = 0;
      } else {
        const timestamps = dayKeys.map((k) => history.days[k].timestamp);
        history.earliest = Math.min(...timestamps);
        history.latest = Math.max(...timestamps);
      }

      await this.setHistory(history);
    } catch (error) {
      console.error(`HistoryRepository.deleteDay error for ${dateKey}:`, error);
      throw new Error(`Failed to delete day ${dateKey}: ${error}`);
    }
  }

  /**
   * Get days in a date range (inclusive)
   */
  async getDaysInRange(
    startDate: string,
    endDate: string,
  ): Promise<Record<string, Day>> {
    try {
      const history = await this.getHistory();
      const days: Record<string, Day> = {};

      for (const dateKey of Object.keys(history.days)) {
        if (dateKey >= startDate && dateKey <= endDate) {
          const day = await this.getDay(dateKey);
          if (day) {
            days[dateKey] = day;
          }
        }
      }

      return days;
    } catch (error) {
      console.error("HistoryRepository.getDaysInRange error:", error);
      return {};
    }
  }

  /**
   * Clear expired days older than retention period
   * Process: while History.days.earliest().timestamp > retentionDays from now, pop it
   */
  async clearExpiredDays(retentionDays: number): Promise<number> {
    try {
      const history = await this.getHistory();
      const now = Date.now();
      const cutoffTime = now - retentionDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      // Sort days by timestamp (oldest first)
      const sortedDayKeys = Object.keys(history.days).sort(
        (a, b) => history.days[a].timestamp - history.days[b].timestamp,
      );

      for (const dateKey of sortedDayKeys) {
        const day = history.days[dateKey];
        if (day.timestamp < cutoffTime) {
          await this.deleteDay(dateKey);
          deletedCount++;
        } else {
          // Days are sorted, so we can stop once we hit a non-expired day
          break;
        }
      }

      return deletedCount;
    } catch (error) {
      console.error("HistoryRepository.clearExpiredDays error:", error);
      return 0;
    }
  }

  /**
   * Create an empty day structure
   */
  createEmptyDay(timestamp: number): Day {
    // Initialize 24 hours with empty domain records
    const hours: HourData[] = Array.from({ length: 24 }, () => ({
      domains: {},
      totalTime: 0,
    }));

    return {
      totalTime: 0,
      hours,
      domains: {},
      timestamp,
      shiftedHours: {},
    };
  }

  /**
   * Create empty history structure
   */
  private createEmptyHistory(): History {
    return {
      earliest: 0,
      latest: 0,
      days: {},
    };
  }

  /**
   * Get date key from timestamp (YYYY-MM-DD format)
   * @deprecated Use getDateKey from src/shared/dateUtils instead
   */
  static getDateKey(timestamp: number): string {
    return getDateKey(timestamp);
  }

  /**
   * Get midnight timestamp for a date (in local timezone)
   * @deprecated Use getMidnightTimestamp from src/shared/dateUtils instead
   */
  static getMidnightTimestamp(timestamp: number): number {
    return getMidnightTimestamp(timestamp);
  }
}
