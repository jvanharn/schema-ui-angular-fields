import { SchemaNavigator, SchemaFieldDescriptor } from 'json-schema-services';

import { SimplifiedLinkedResource } from './simplified-resource';
import { SimplifiedResourceMapper } from './simplified-resource-mapper';
import { CachedDataProvider } from '../cached-data-provider.service';

import debuglib from 'debug';
const debug = debuglib('schema-ui:linked-simplified-resource-mapper');

/**
 * Class that simplifies a schema into a simplified object with the same properties for commonly used values in an UI.
 */
export class LinkableSimplifiedResourceMapper extends SimplifiedResourceMapper {
    /**
     * @param field The form field descriptor of the field that refers to the external resource.
     * @param schema The targetted resource schema (by the field given below), so NOT of the schema the field resides in.
     * @param cache
     */
    public constructor(
        field: SchemaFieldDescriptor,
        schema: SchemaNavigator,
        protected cache?: CachedDataProvider,
    ) {
        super(field, schema);

        if (!(schema instanceof SchemaNavigator)) {
            throw new Error('SimplifiedResourceMapper.constructor; The given schema is not a SchemaNavigator!');
        }
    }

    /**
     * Transform the given data to a simplified resource.
     *
     * @param items The items to transform.
     * @param includeOriginal Whether or not to include the original resource.
     */
    public resolvedTransform(items: any[], includeOriginal?: boolean): Promise<SimplifiedLinkedResource[]> {
        return this.createTemplateVariableCache(items)
            .then(cache => items
                .map(item => ({
                    name: this.getLinkedDisplayName(cache, item),
                    description: this.getDescription(item),
                    order: this.getOrder(item),
                    value: this.getIdentityValue(item),
                    parent: this.getParentValue(item),
                    original: includeOriginal ? item : null
                } as SimplifiedLinkedResource))
                .sort((a: SimplifiedLinkedResource, b: SimplifiedLinkedResource) => {
                    if (a.order === b.order) {
                        return String(a.name).localeCompare(String(b.name));
                    }
                    if (a.order > b.order) {
                        return 1;
                    }
                    return -1;
                }));
    }

    /**
     * Get the display name of the given item.
     *
     * @param item The item to get the displayed name for.
     * @param items A complete list of all other items, used to find the parent of the current item.
     */
    public getLinkedDisplayName(cache: LocalLinkableCache, item: any): string {
        var resolved = this.resolveTemplateVariables(cache, item);

        // Resolve via old-style parent
        if (this.field.data && this.field.data.parent && this.field.data.mergeLabelWithParents === true) {
            return this.getLinkedDisplayNameForParent(cache[this.schema.schemaId].items, resolved, resolved[this.field.data.label]);
        }

        // Just find any prop that can represent the resource.
        return this.getDisplayName(resolved);
    }

    /**
     * Fetch the display name for the parent item of the same type for the given item.
     *
     * @param items
     * @param item
     * @param label
     */
    private getLinkedDisplayNameForParent(items: any[], item: any, label: string): string {
        if (item[this.field.data.parent] != null) {
            var parent = (items || []).find(x => x[this.field.data.value] === item[this.field.data.parent]);
            if (parent != null) {
                label = parent[this.field.data.label] + ' › ' + label;
                if (parent[this.field.data.parent] != null) {
                    label = this.getLinkedDisplayNameForParent(items, parent, label);
                }
            }
        }
        return label;
    }

    /**
     * Resolve all display value template variables.
     *
     * @param items The original items to resolve.
     *
     * @ignore
     */
    public createTemplateVariableCache(items: any[]): Promise<LocalLinkableCache> {
        var cache: LocalLinkableCache = { };
        if (Array.isArray(items)) {
            cache[this.schema.schemaId] = {
                mapper: this,
                items,
            };
        }

        if (!this.field.data || !this.field.data.displayTemplatePointers || typeof this.field.data.displayTemplatePointers !== 'object') {
            return Promise.resolve(cache);
        }

        var eventuals: Promise<void>[] = [];
        for (var prop in this.field.data.displayTemplatePointers) {
            if (Object.prototype.hasOwnProperty.call(this.field.data.displayTemplatePointers, prop)) {
                var schemaId = this.field.data.displayTemplatePointers[prop];
                eventuals.push(this.cache.resolveAgent(schemaId)
                    .then(([agent]) => this.cache.resolveDataWithSchema(agent.schema, agent.schema.getFirstLink(['collection', 'list']).rel)
                        .then(items => {
                            if (Array.isArray(items)) {
                                var descriptors = this.schema.getFieldDescriptorForPointer(agent.schema.identityPointer);
                                cache[schemaId] = {
                                    mapper: new SimplifiedResourceMapper(descriptors.length > 0 ? descriptors[0] : {}, agent.schema),
                                    items,
                                };
                            }
                            else {
                                debug(`[warn] no items returned!`);
                                cache[schemaId] = {
                                    mapper: null,
                                    items: [],
                                };
                            }
                        })));
            }
        }

        return Promise.all(eventuals).then(() => cache);
    }

    /**
     * Resolve all display value template variables.
     *
     * @ignore
     */
    public resolveTemplateVariables(cache: LocalLinkableCache, item: any): any {
        if (!this.field.data || !this.field.data.displayTemplatePointers || typeof this.field.data.displayTemplatePointers !== 'object') {
            return item;
        }

        var resolved: any = {}, resolvedAny = false;
        for (var prop in this.field.data.displayTemplatePointers) {
            if (Object.prototype.hasOwnProperty.call(this.field.data.displayTemplatePointers, prop) &&
                !Object.prototype.hasOwnProperty.call(item, prop)) {
                var { items, mapper } = cache[this.field.data.displayTemplatePointers[prop]];
                var target = items.find(x => mapper['schema'].getIdentityValue(x) === mapper.getIdentityValue(item));
                if (target != null) {
                    resolved[prop] = mapper.getDisplayName(target);
                }
                else {
                    resolved[prop] = '-';
                }
                resolvedAny = true;
            }
        }

        if (!resolvedAny) {
            return item;
        }
        return Object.assign(resolved, item);
    }
}

/**
 * Cache used to temporarily cache all linked item collections in during the transformation.
 */
export interface LocalLinkableCache {
    [schemaId: string]: {
        mapper: SimplifiedResourceMapper,
        items: any[],
    };
}
