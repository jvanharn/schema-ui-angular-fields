
import { Injectable, Inject } from '@angular/core';
import {
    IdentityValue,
    SchemaNavigator,
    JsonFormSchema,
    SchemaHyperlinkDescriptor,
    ISchemaAgent,
    SchemaFieldDescriptor,
} from 'json-schema-services';

import { IAgentResolver, CachedDataProvider } from './cached-data-provider.service';
import { SimplifiedResourceMapper } from './simplified-resource-mapper';

import * as _ from 'lodash';
import debuglib from 'debug';
const debug = debuglib('schema-ui:linked-column-data-provider');

/**
 * Class that helps with resolving linked field data by a pointer and value, so they can be readably displayed to a user.
 *
 * This linked data provider is optimized to detect links to other schemas (optimally parent-child relations),
 * and to load the whole resource once (using a collection-link if it exists on the targetted resource).
 * It will then resolve the actual children using the uriTemplatePointers on the locally cached data.
 *
 * Warning: This class trades accuracy for performance, therefore do not use this class for scenarios that demand accuracy,
 * like forms or other scenarios where data is written.
 */
@Injectable()
export class LooselyLinkedDataProvider {
    /**
     * Cache of resolved data required to fetch the linked data for the given pointers.
     */
    private cache: CachedPointerInfo[] = [];

    public constructor(
        @Inject('AgentResolverFactory') private resolver: IAgentResolver,
        @Inject(CachedDataProvider) private provider: CachedDataProvider,
    ) { }

    /**
     * Resolves a single reference or identity value to something that can be displayed to the user.
     */
    public resolveSingleValueToDisplayName(schema: SchemaNavigator, pntr: string, value: IdentityValue): Promise<string> {
        return this.resolveData(schema, pntr, null).then(data => {
            if (data == null) {
                return '\u26A0';
            }

            var strval = String(value);
            var [mapper, items] = data;
            for (var item of items) {
                // tslint:disable-next-line:triple-equals
                if (strval == mapper.getIdentityValue(item)) {
                    return mapper.getDisplayName(item, items);
                }
            }
            return '-';
        });
    }

    /**
     * Resolves multiple references or identity values to something that can be displayed to the user.
     */
    public resolveMultiValueToDisplayName(schema: SchemaNavigator, pntr: string, values: IdentityValue[]): Promise<string> {
        var typed = _.groupBy(values, x => typeof x);
        return Promise.all(_.map(typed, vals =>
            this.resolveData(schema, pntr, values[0]).then(data => {
                if (data == null) {
                    return ['\u26A0'];
                }

                var result = [], strvals = vals.map(x => String(x));
                var [mapper, items] = data;
                for (var item of items) {
                    // tslint:disable-next-line:triple-equals
                    if (strvals.some(x => x == mapper.getIdentityValue(item))) {
                        result.push(mapper.getDisplayName(item, items));
                    }
                }
                return result;
            })))
            .then(items => {
                var result = [].concat(...items);
                if (result.length === 0) {
                    return '-';
                }
                return result.join(', ');
            });
    }

    /**
     * Resolves multiple references or identity values to something that can be displayed to the user.
     */
    public resolveAllPossibleValues(schema: SchemaNavigator, pntr: string): Promise<{ label: string, value: IdentityValue }[]> {
        return this.resolveData(schema, pntr, null).then(([mapper, items]) => items.map(item => ({
            label: mapper.getDisplayName(item, items),
            value: mapper.getIdentityValue(item),
        })));
    }

    /**
     * Resolve the data for the given column and value combination.
     *
     * @param schema The schema of the table the column resides in.
     * @param col The column to resolve and fetch data for.
     * @param value The value so we can determine it's type.
     */
    private resolveData(schema: SchemaNavigator, pntr: string, value: any): Promise<[SimplifiedResourceMapper, any[]] | null> {
        const   info = this.findOrCreateCache(schema, pntr),
                field = this.findSchemaFieldDescriptorForValue(info, value);
        if (field == null) {
            debug(`[warn] unable to resolve a field-descriptor for [${schema.schemaId}${pntr}] with value "${value}"`);
            return Promise.resolve(null);
        }
        return this.findOrCreateForValue(info, field).then(result => {
            if (result == null) {
                return null;
            }
            return this.provider.resolveDataThrough(result[0], result[1], !!field.data ? field.data.pointer : void 0, {}, false)
                .then(data => ([result[2], data] as [SimplifiedResourceMapper, any[]]))
        });
    }

    /**
     * Find or create the cached info for the given column.
     *
     * @param schema Schema navigator to fetch the info with.
     * @param col The column to fetch for.
     */
    private findOrCreateCache(schema: SchemaNavigator, pointer: string): CachedPointerInfo {
        var entry = this.cache.find(x => x.schema.schemaId === schema.schemaId && x.pointer === pointer);
        if (entry != null) {
            return entry;
        }

        // Create a new one.
        var info: CachedPointerInfo = {
            schema,
            pointer,
            fields: schema.getFieldDescriptorForPointer(pointer),
            mappers: new Map(),
        };
        this.cache.push(info);
        return info;
    }

    /**
     * Find or create a proper agent, *-link and mapper for the given field of a column.
     *
     * @param info
     * @param field
     */
    private findOrCreateForValue(info: CachedPointerInfo, field: SchemaFieldDescriptor): Promise<[ISchemaAgent, string, SimplifiedResourceMapper] | null> {
        var result = this.resolveCollectionAgent(info.schema, field)
            .then(([agent, linkName]) =>
                ([agent, linkName, new SimplifiedResourceMapper(field, agent.schema)] as [ISchemaAgent, string, SimplifiedResourceMapper]))
            .catch(err => {
                debug(
                    `[warn] findOrCreateForValue; something went wrong trying to resolve an external resource to use for a value`,
                    field, err);
                return null;
            });
        info.mappers.set(field, result);
        return result;
    }

    /**
     * Fetch a complete collection link that can be used to read *all* values for the given value.
     *
     * @param schema Original schema the field resides in.
     * @param field Linking field descriptor that describes how to reach the linked entity.
     */
    private resolveCollectionAgent(schema: SchemaNavigator, field: SchemaFieldDescriptor): Promise<[ISchemaAgent, string]> {
        if (!field || !field.link) {
            return Promise.reject(new Error(
                'LinkedColumnDataProvider; No link defined on the given field, and thus will not be able to resolve it to an agent.'));
        }

        var originalLink: SchemaHyperlinkDescriptor = schema.getLink(field.link);
        if (originalLink == null) {
            return Promise.reject(new Error(
                `LinkedColumnDataProvider; The link "${field.link}" defined on a field in "${schema.schemaId}" does not exist.`));
        }

        if (originalLink.rel.startsWith('list')) {
            // List
            if (!originalLink.targetSchema || !originalLink.targetSchema.$ref) {
                return Promise.reject(new Error(
                    `LinkedColumnDataProvider; The link "${field.link}" defined on a field in "${schema.schemaId}" ` +
                    'does not have a targetSchema set! This required to properly resolve it\'s collection link.'));
            }

            var result = this.resolver.getAgent(originalLink.targetSchema.$ref);
            if (!result) {
                return Promise.reject(new Error(
                    `LinkedColumnDataProvider; Unable to get an agent for id ${originalLink.targetSchema.$ref}, the resolver returned a falsy value.`));
            }

            return result.then(agent => {
                var link = agent.schema.getFirstLink(['collection', 'list']);
                if (link == null || agent.schema.hasLinkUriTemplatePointers(link)) {
                    throw new Error(
                        `LinkedColumnDataProvider; The list or collection link of schema "${originalLink.targetSchema.$ref}" contains dynamic parameters. ` +
                        'Therefore I cannot precache the entire list, and am unable to properly resolve it.');
                }
                return [agent, link.rel] as [ISchemaAgent, string];
            });
        }
        else {
            // Single resource list
            if (schema.hasLinkUriTemplatePointers(originalLink)) {
                return Promise.reject(new Error(
                    `LinkedColumnDataProvider; The link "${originalLink.rel}" is a dynamic link (non-list), and therefore I cannot precache it for ` +
                    'displaying in a referenced column. I would have to call it for every row, which would be terribly slow'));
            }

            return this.resolver.getAgent(schema.schemaId).then(agent => ([agent, originalLink.rel] as [ISchemaAgent, string]));
        }
    }

    /**
     * Determine the schema field descriptor to use to resolve a field value.
     */
    private findSchemaFieldDescriptorForValue(info: CachedPointerInfo, value: any): SchemaFieldDescriptor | null {
        var field: JsonFormSchema;

        // Links are mostly defined on the parent container when defining collections of references.
        if (info.fields.length === 1 && (info.fields[0].type === 'array' || info.fields[0].type === 'object')) {
            if (info.fields[0].field) {
                return info.fields[0].field;
            }

            // Then we should maybe look in the items itself
            else if (typeof info.fields[0].items === 'object') {
                field = info.fields[0].items as JsonFormSchema;
            }

            // Maybe it has pattern properties?
            else if (typeof info.fields[0].patternProperties === 'object' && Object.keys(info.fields[0].patternProperties).length === 1) {
                field = info.fields[0].patternProperties[Object.keys(info.fields[0].patternProperties)[0]] as JsonFormSchema;
            }
        }
        if (field == null) {
            field = info.schema.getFieldDescriptorForValue(info.fields, value);
        }

        // Check the link for the specific value type.
        if (field != null && !!field.field) {
            return field.field;
        }
    }
}

/**
 * Contains all related info to the retrieval of linked-data for a pointer.
 */
interface CachedPointerInfo {
    /**
     * The schema navigator that describes the collection item.
     */
    schema: SchemaNavigator;

    /**
     * The rendered column.
     */
    pointer: string;

    /**
     * Field descriptors that apply to the given referenced field.
     */
    fields: JsonFormSchema[];

    /**
     * Maps a field to the agent, link and mapper needed to render it's value for the given column.
     */
    mappers: Map<SchemaFieldDescriptor, Promise<[ISchemaAgent, string, SimplifiedResourceMapper] | null>>;
}
