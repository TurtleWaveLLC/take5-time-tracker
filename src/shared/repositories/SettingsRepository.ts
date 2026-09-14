/**
 * SettingsRepository - Data access layer for ExtensionSettings
 *
 * Manages user settings and preferences.
 */

import type { ExtensionSettings } from "../../../types";
import type { PersistenceManager } from "../storage/PersistenceManager";

const STORAGE_KEY = "settings";

// Exposed for snapshot-style readers (export); see ExportService
export const SETTINGS_STORAGE_KEY = STORAGE_KEY;

export class SettingsRepository {
  private static instance: SettingsRepository | null = null;
  private storage: PersistenceManager;

  private constructor(storage: PersistenceManager) {
    this.storage = storage;
  }

  public static getInstance(storage?: PersistenceManager): SettingsRepository {
    if (!SettingsRepository.instance) {
      if (!storage) {
        throw new Error(
          "SettingsRepository must be initialized with storage parameter on first call"
        );
      }
      SettingsRepository.instance = new SettingsRepository(storage);
    }
    return SettingsRepository.instance;
  }

  public static resetInstance(): void {
    SettingsRepository.instance = null;
  }

  /**
   * Get extension settings
   */
  async getSettings(): Promise<ExtensionSettings> {
    try {
      const result = await this.storage.get(STORAGE_KEY);
      return (result[STORAGE_KEY] as ExtensionSettings) || this.getDefaultSettings();
    } catch (error) {
      console.error("SettingsRepository.getSettings error:", error);
      return this.getDefaultSettings();
    }
  }

  /**
   * Update extension settings (partial update)
   */
  async updateSettings(updates: Partial<ExtensionSettings>): Promise<void> {
    try {
      const currentSettings = await this.getSettings();
      const updatedSettings: ExtensionSettings = {
        ...currentSettings,
        ...updates,
      };
      await this.storage.set({ [STORAGE_KEY]: updatedSettings });
    } catch (error) {
      console.error("SettingsRepository.updateSettings error:", error);
      throw new Error(`Failed to update settings: ${error}`);
    }
  }

  /**
   * Set all settings (full replacement)
   */
  async setSettings(settings: ExtensionSettings): Promise<void> {
    try {
      await this.storage.set({ [STORAGE_KEY]: settings });
    } catch (error) {
      console.error("SettingsRepository.setSettings error:", error);
      throw new Error(`Failed to set settings: ${error}`);
    }
  }

  /**
   * Get default extension settings
   */
  getDefaultSettings(): ExtensionSettings {
    return {
      // Default to top-right: use large x value that will be clamped to right edge
      pillPosition: { x: 9999, y: 20 },
      pillVisibility: true,
      pillShowFullInfo: false, // Start in minimal mode
      pillHidden: false, // Show all elements by default
      dataRetentionDays: 30,
      excludedDomains: [],
    };
  }

  /**
   * Check if a domain is in the excluded list
   */
  async isDomainExcluded(domain: string): Promise<boolean> {
    try {
      const settings = await this.getSettings();
      return settings.excludedDomains.includes(domain);
    } catch (error) {
      console.error("SettingsRepository.isDomainExcluded error:", error);
      return false;
    }
  }

  /**
   * Add a domain to the excluded list
   */
  async addExcludedDomain(domain: string): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (!settings.excludedDomains.includes(domain)) {
        settings.excludedDomains.push(domain);
        await this.setSettings(settings);
      }
    } catch (error) {
      console.error("SettingsRepository.addExcludedDomain error:", error);
      throw error;
    }
  }

  /**
   * Remove a domain from the excluded list
   */
  async removeExcludedDomain(domain: string): Promise<void> {
    try {
      const settings = await this.getSettings();
      settings.excludedDomains = settings.excludedDomains.filter(
        (d) => d !== domain
      );
      await this.setSettings(settings);
    } catch (error) {
      console.error("SettingsRepository.removeExcludedDomain error:", error);
      throw error;
    }
  }
}
