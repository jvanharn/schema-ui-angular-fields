import { Injectable, Inject } from '@angular/core';
import { IRelatableSchemaAgent, ISchemaAgent, SchemaNavigator, pointerGet } from 'json-schema-services';

import { LinkedDataCache } from './linked-data-cache.service';

import debuglib from 'debug';
const debug = debuglib('schema-ui:data-provider');

/**
 * Class that helps with resolving linked field data.
 *
 * This class is used by some fields.
 */
@Injectable()
export class CachedDataProvider {
    /**
     * Cached schema agent for the linked resource.
     */
    private agents: { [cacheKey: string]: Promise<[IRelatableSchemaAgent, boolean]> } = {};

    public constructor(
        @Inject('AgentResolverFactory') private resolver: IAgentResolver, //@todo Require an ISchemaClient implementation with @schema-ui/core@1.0.0+
        @Inject(LinkedDataCache) private cache: LinkedDataCache,
    ) { }

    /**
     * Resolve data through the given data instance.
     *
     * @param agent
     * @param linkName
     * @param pntr
     * @param context
     * @param forceReload
     */
    public resolveDataThrough(agent: ISchemaAgent, linkName: string = 'list', pntr: string = '/', context?: any, forceReload?: boolean): Promise<any[]> {
        var targetSchemaId: string;
        var link = agent.schema.getLink(linkName);
        if (link == null) {
            return Promise.reject(new Error(`The given link by name "${linkName}" does not exist on schema "${agent.schema.schemaId}"!`));
        }
        if (link.targetSchema != null) {
            targetSchemaId = link.targetSchema.$ref
        }

        if (forceReload !== true) {
            // Fetch state from cache.
            var state = this.cache.fetch(agent.schema.schemaId, link.rel, targetSchemaId);
            if (state !== null) {
                return state;
            }
        }
        else {
            this.cache.remove(agent.schema.schemaId, link.rel);
        }

        // Resolve data as promise
        var result = this.resolveDataFromAgent(agent, linkName, pntr, context);

        // Check what pointers it refers to in the context, and save to cache
        var pointers = Object.values(agent.schema.getLinkUriTemplatePointers(link));
        this.cache.push(agent.schema.schemaId, linkName, targetSchemaId, pointers, result);

        return result;
    }

    /**
     * Resolve linked data through a compatible agent, and check a data-cache before doing so to to preserve bandwidth.
     *
     * @see resolveDataThrough Using the resolveDataThrough method is preferred over this one, since it prevents double checks!
     *
     * @param schema The schema to execute on.
     * @param linkName The name of the link to execute.
     * @param pntr When the link is a read-* link, provide the inlined array that you want to return.
     * @param context The context of the form (e.g. other form values)
     */
    public resolveDataWithSchema(schema: SchemaNavigator, linkName?: string, pntr: string = '/', context?: any, forceReload?: boolean): Promise<any[]> {
        var targetSchemaId: string;
        var link = schema.getLink(linkName);
        if (link == null) {
            return Promise.reject(new Error(`The given link by name "${linkName}" does not exist on schema "${schema.schemaId}"!`));
        }
        if (link.targetSchema != null) {
            targetSchemaId = link.targetSchema.$ref
        }

        if (forceReload !== true) {
            // Fetch state from cache.
            var state = this.cache.fetch(schema.schemaId, link.rel, targetSchemaId);
            if (state !== null) {
                return state;
            }
        }
        else {
            this.cache.remove(schema.schemaId, link.rel);
        }

        var result = this.resolveAgent(schema.schemaId, linkName, context, forceReload).then(([agent, resolvedThrough]) => {
            // this is going to overwrite the last value with a more acurate version
            this.cache.remove(schema.schemaId, linkName);
            return this.resolveDataThrough(agent, resolvedThrough ? 'list' : linkName, pntr, context, forceReload);
        });

        // Check what pointers it refers to in the context, and save to cache
        var pointers = Object.values(schema.getLinkUriTemplatePointers(link));
        this.cache.push(schema.schemaId, linkName, targetSchemaId, pointers, result);

        return result;
    }

    /**
     * Get an linked resource as simplified data.
     *
     * @deprecated Use resolveDataThrough instead if you have an agent, or use resolveDataWithSchema if you have a SchemaNavigator.
     * @param schemaId The schema id of the schema to execute on.
     * @param linkName The name of the link to execute.
     * @param pntr When the link is a read-* link, provide the inlined array that you want to return.
     * @param context The context of the form (e.g. other form values)
     */
    public resolveData(schemaId: string, linkName?: string, pntr: string = '/', context?: any, forceReload?: boolean): Promise<any[]> {
        debug('[DEPRECATED] resolveData(schemaId, ...) rather not use this method, as it makes it harder to prefetch data. Use resolveDataThrough or resolveDataWithSchema instead.');

        if (forceReload !== true) {
            // Fetch state from cache.
            var state = this.cache.fetch(schemaId, linkName);
            if (state !== null) {
                return state;
            }
        }
        else {
            this.cache.invalidate(schemaId);
        }

        var result = this.resolveAgent(schemaId, linkName, context, forceReload).then(([agent, resolvedThrough]) => {
            // this is going to overwrite the last value with a more acurate version
            this.cache.remove(schemaId, linkName);
            return this.resolveDataThrough(agent, resolvedThrough ? 'list' : linkName, pntr, context, forceReload);
        });

        // Since we do not have a schema, we have no idea what all these parameters are, thats why this method is now DEPRECATED
        this.cache.push(schemaId, linkName, void 0, [], result);

        return result;
    }

    /**
     * Resolve a list of data from the given agent.
     */
    private resolveDataFromAgent(agent: ISchemaAgent, linkName: string, pntr?: string, context?: any): Promise<any[]> {
        if (linkName.startsWith('list') || linkName.startsWith('collection')) {
            return agent
                .list(1, 1000, linkName, context)
                .then(cursor => cursor.all());
        }
        else {
            return agent
                .read<any>(context, linkName)
                .then(item => {
                    if (typeof pntr === 'string' && pntr.length > 1) {
                        try {
                            return pointerGet(item, pntr) || [];
                        }
                        catch (e) {
                            debug(`[warn] unable to get the data for pointer "${pntr}"`);
                        }
                    }
                    else if (Array.isArray(item)) {
                        return item;
                    }

                    debug(`[warn] the item retrieved from link ${linkName} is not an array! returning empty set.`);
                    return [];
                });
        }
    }

    /**
     * Get an agent by the given schema id, and cache the result.
     *
     * @param schemaId
     * @param linkName
     * @param context
     * @param forceReload
     *
     * @return [IResolveableSchemaAgent, resolvedChild] Tuple containing the agent, and a boolean indicating whether or not the linkName should be included in the request, or that a simple list will suffice.
     */
    public resolveAgent(schemaId: string, linkName: string = 'list', context?: any, forceReload?: boolean): Promise<[IRelatableSchemaAgent, boolean]> {
        const cacheKey = schemaId + linkName;
        if (this.agents[cacheKey] && forceReload !== false) {
            return this.agents[cacheKey];
        }

        var result = this.resolver.getAgent(schemaId);
        if (!result) {
            return Promise.reject(new Error('Unable to get an agent for id ${schemaId}, the resolver returned a falsy value.'));
        }

        return this.agents[cacheKey] = result.then(agent => this.resolveAgentChild(agent, linkName, context, forceReload));
    }

    /**
     * Resolve the child agent of the given agent link (if it is reffed).
     *
     * @param agent
     * @param linkName
     * @param context
     * @param forceReload
     */
    public resolveAgentChild(agent: IRelatableSchemaAgent, linkName: string = 'list', context?: any, forceReload?: boolean, forceResolveChild?: boolean): Promise<[IRelatableSchemaAgent, boolean]> {
        const cacheKey = agent.schema.schemaId + linkName + 'child';
        if (this.agents[cacheKey] && forceReload !== false) {
            return this.agents[cacheKey];
        }

        if (linkName === 'create' || linkName === 'read' || linkName === 'update' || linkName === 'delete' || linkName === 'list') {
            return Promise.resolve([agent, false] as [IRelatableSchemaAgent, boolean]);
        }

        if (!agent.schema.hasLink(linkName)) {
            throw new Error(`CachedDataProvider: Requested link "${linkName}" does not exist on schema [${agent.schema.schemaId}].`);
        }

        if (forceResolveChild !== true) {
            // Check whether or not the requested schema can be resolved through (give the original schema) or whether it must be executed using the link.
            var link = agent.schema.getLink(linkName);
            if (agent.schema.hasLinkUriTemplatePointers(link)) {
                return Promise.resolve([agent, false] as [IRelatableSchemaAgent, boolean]);
            }
        }

        // We can resolve through
        return this.agents[cacheKey] = agent.createChildByLink(linkName, context).then(child => [child, true] as [IRelatableSchemaAgent, boolean]);
    }

    /**
     * (Forcably) Resolve the given link untill there are no more $ref's to resolve.
     *
     * @param schemaId
     * @param linkName
     * @param context
     * @param forceReload
     */
    public resolveLinkedAgent(schemaId: string, linkName: string = 'list', context?: any, forceReload?: boolean): Promise<IRelatableSchemaAgent> {
        const cacheKey = schemaId + linkName + 'child';
        if (this.agents[cacheKey] && forceReload !== false) {
            return this.agents[cacheKey].then(([x]) => x);
        }

        return this.resolveAgent(schemaId, linkName, context, forceReload).then(([agent, isChild]) => {
            if (isChild) {
                return agent;
            }
            return this.resolveAgentChild(agent, linkName, context, forceReload, true).then(([x]) => x);
        });
    }
}

export interface IAgentResolver {
    getAgent(schemaId: string): Promise<IRelatableSchemaAgent>;
}
