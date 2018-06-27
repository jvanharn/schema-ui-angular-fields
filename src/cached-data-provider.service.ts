import { Injectable, Inject } from '@angular/core';
import { IRelatableSchemaAgent } from 'json-schema-services';

import { LinkedDataCache } from './linked-data-cache.service';

import * as pointer from 'json-pointer';
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
    public resolveDataThrough(agent: IRelatableSchemaAgent, linkName: string = 'list', pntr: string = '/', context?: any, forceReload?: boolean): Promise<any[]> {
        if (forceReload !== true) {
            // Fetch state from cache.
            var state = this.cache.fetch(agent.schema.schemaId, linkName);
            if (state !== null) {
                return state;
            }
        }
        else {
            this.cache.invalidate(agent.schema.schemaId);
        }

        var result = this.resolveDataFromAgent(agent, linkName, pntr, context);

        this.cache.push(agent.schema.schemaId, linkName, [], result);
        return result;
    }

    /**
     * Get an linked resource as simplified data.
     *
     * @param schemaId The schema id of the schema to execute on.
     * @param linkName The name of the link to execute.
     * @param pntr When the link is a read-* link, provide the inlined array that you want to return.
     * @param context The context of the form (e.g. other form values)
     */
    public resolveData(schemaId: string, linkName?: string, pntr: string = '/', context?: any, forceReload?: boolean): Promise<any[]> {
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

        var result = this.resolveAgent(schemaId, linkName, context, forceReload)
            .then(([agent, resolvedThrough]) =>
                this.resolveDataFromAgent(agent, resolvedThrough ? 'list' : String(linkName), pntr, context));

        this.cache.push(schemaId, linkName, [], result);
        return result;
    }

    /**
     * Resolve a list of data from the given agent.
     */
    private resolveDataFromAgent(agent: IRelatableSchemaAgent, linkName: string, pntr?: string, context?: any): Promise<any[]> {
        if (linkName.startsWith('list')) {
            return agent
                .list(1, 1000, linkName, context)
                .then(cursor => cursor.all());
        }
        else {
            return agent
                .read<any>(context, linkName)
                .then(item => {
                    try {
                        return pointer.get(item, pntr) || [];
                    }
                    catch (e) {
                        debug(`[warn] unable to get the data for pointer "${pointer}"`);
                    }
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
     * Resolve the child
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
            var link = agent.schema.getLink(linkName);

            // Check whether or not the requested schema can be resolved through (give the original schema) or whether it must be executed using the link.
            if (link.href.indexOf('{') >= 0 || link.href.indexOf('?') >= 0) {
                return Promise.resolve([agent, false] as [IRelatableSchemaAgent, boolean]);
            }
        }

        // We can resolve through
        return this.agents[cacheKey] = agent.createChildByLink(linkName, context).then(child => [child, true] as [IRelatableSchemaAgent, boolean]);
    }

    /**
     * Get the linked agent.
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
