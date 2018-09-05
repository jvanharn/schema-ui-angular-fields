import { Injectable } from '@angular/core';

/**
 * Caches any linked data that was retrieved for any form, based on it's link descriptor.
 */
@Injectable({
    providedIn: 'root'
})
export class LinkedDataCache {
    /**
     * Cache containing all the data-sets.
     */
    private readonly cache: LinkedDataCacheItem[] = [];

    /**
     * Push a state object to the stack for the given schemaId + link-rel combination.
     *
     * Will overwrite any existing data for the given combination.
     *
     * @param schemaId
     * @param link
     * @param properties
     * @param state
     */
    public push(schemaId: string, link: string, targetSchemaId: string, properties: string[], state: Promise<any>): void {
        this.remove(schemaId, link);
        this.cache.push({
            schemaId,
            link,
            targetSchemaId,
            properties,
            state,
        });
    }

    /**
     * Fetch data from the cache for the given schema/link combo.
     *
     * @param schemaId
     * @param link
     */
    public fetch(schemaId: string, link: string): Promise<any> {
        for (var item of this.cache) {
            if (item.schemaId === schemaId && item.link === link) {
                return item.state;
            }
        }
        return null;
    }

    /**
     * Remove a cached item about.
     *
     * @param schemaId
     * @param link
     */
    public remove(schemaId: string, link: string): void {
        var item: LinkedDataCacheItem;
        for (var i = 0; i < this.cache.length; i++) {
            item = this.cache[i];
            if (item.schemaId === schemaId && item.link === link) {
                this.cache.splice(i, 1);
            }
        }
    }

    /**
     * Purge all cached items with the given schemaId.
     *
     * @param schemaId
     */
    public purge(schemaId: string): void {
        var item: LinkedDataCacheItem;
        for (var i = 0; i < this.cache.length; i++) {
            item = this.cache[i];
            if (item.schemaId === schemaId || item.targetSchemaId === schemaId) {
                this.cache.splice(i, 1);
            }
        }
    }

    /**
     * Invalidate all data for the given schemaId that reference the given properties.
     *
     * @param schemaId The schemaId that is affected.
     * @param properties Properties that have to be referenced by the given link href to qualify it for removal.
     */
    public invalidate(schemaId: string, properties?: string[]): void {
        var item: LinkedDataCacheItem;
        for (var i = 0; i < this.cache.length; i++) {
            item = this.cache[i];
            if (item.schemaId === schemaId && (properties == null || item.properties.some(x => properties.indexOf(x) >= 0))) {
                this.cache.splice(i, 1);
            }
        }
    }

    /**
     * Clear whole cache.
     */
    public clear(): void {
        this.cache.splice(0, this.cache.length);
    }
}

interface LinkedDataCacheItem {
    schemaId: string;
    link: string;
    targetSchemaId?: string;
    properties: string[];
    state: Promise<any>;
}
