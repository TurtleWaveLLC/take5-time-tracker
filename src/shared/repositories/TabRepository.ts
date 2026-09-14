/**
 * TabRepository - Data access layer for ActiveTab state
 *
 * Manages the currently active tab tracking state.
 */

import type { ActiveTab } from "../../../types";
import type { PersistenceManager } from "../storage/PersistenceManager";

const STORAGE_KEY = "activeTab";

// Exposed for snapshot-style readers (export); see ExportService
export const ACTIVE_TAB_STORAGE_KEY = STORAGE_KEY;

export class TabRepository {
  private static instance: TabRepository | null = null;
  private storage: PersistenceManager;

  private constructor(storage: PersistenceManager) {
    this.storage = storage;
  }

  public static getInstance(storage?: PersistenceManager): TabRepository {
    if (!TabRepository.instance) {
      if (!storage) {
        throw new Error(
          "TabRepository must be initialized with storage parameter on first call"
        );
      }
      TabRepository.instance = new TabRepository(storage);
    }
    return TabRepository.instance;
  }

  public static resetInstance(): void {
    TabRepository.instance = null;
  }

  /**
   * Get the currently active tab state
   */
  async getActiveTab(): Promise<ActiveTab | null> {
    try {
      const result = await this.storage.get(STORAGE_KEY);
      return (result[STORAGE_KEY] as ActiveTab) || null;
    } catch (error) {
      console.error("TabRepository.getActiveTab error:", error);
      return null;
    }
  }

  /**
   * Set the active tab state
   */
  async setActiveTab(tab: ActiveTab | null): Promise<void> {
    try {
      if (tab === null) {
        await this.storage.remove(STORAGE_KEY);
      } else {
        await this.storage.set({ [STORAGE_KEY]: tab });
      }
    } catch (error) {
      console.error("TabRepository.setActiveTab error:", error);
      throw new Error(`Failed to set active tab: ${error}`);
    }
  }

  /**
   * Create a new active tab state
   */
  static createActiveTab(
    domain: string,
    totalTime: number = 0
  ): ActiveTab {
    const now = Date.now();
    return {
      domain,
      totalTime,
      active: true,
      lastActivated: now,
      lastTimerCheck: now,
    };
  }
}
