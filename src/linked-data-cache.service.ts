import { Injectable } from '@angular/core';

import debuglib from 'debug';
const debug = debuglib('schema-ui:linked-data-cache');

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
    private cache: LinkedDataCacheItem[] = [];

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
     * @param targetSchemaId
     */
    public fetch(schemaId: string, link: string, targetSchemaId?: string): Promise<any> {
        for (var item of this.cache) {
            if (item.schemaId === schemaId && item.link === link && (item.targetSchemaId === targetSchemaId || targetSchemaId == null)) {
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
        var removed = this.removeBy(item =>
            item.schemaId === schemaId && item.link === link);
        debug(`removing cached data for schema(and link) "${schemaId}"->${link} resulted in ${removed} items being invalidated`);
    }

    /**
     * Purge all cached items with the given schemaId.
     *
     * @param schemaId
     */
    public purge(schemaId: string): void {
        var removed = this.removeBy(item =>
            item.schemaId === schemaId || item.targetSchemaId === schemaId);
        debug(`purging cache for schema "${schemaId}" resulted in ${removed} items being invalidated`);
    }

    /**
     * Invalidate all data for the given schemaId that reference the given properties.
     *
     * @param schemaId The schemaId that is affected.
     * @param properties Properties that have to be referenced by the given link href to qualify it for removal.
     */
    public invalidate(schemaId: string, properties?: string[]): void {
        var removed = this.removeBy(item =>
            item.schemaId === schemaId && (properties == null || item.properties.some(x => properties.indexOf(x) >= 0)));
        debug(`invalidating cache for schema "${schemaId}" resulted in ${removed} items being invalidated`);
    }

    /**
     * Remove all cached items for which the selector returns true.
     *
     * @param selector The selector that decides what items to remove (true = remove, false = keep).
     * @returns The number of removed cached items.
     */
    private removeBy(selector: (item: LinkedDataCacheItem) => boolean): number {
        var filtered: LinkedDataCacheItem[] = [];
        for (var i = 0; i < this.cache.length; i++) {
            if (selector(this.cache[i]) === true) {
                filtered.push(this.cache[i]);
            }
        }

        var removed = this.cache.length - filtered.length;
        if (removed > 0) {
            this.cache = filtered;
        }
        return removed;
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
