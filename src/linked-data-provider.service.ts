import { SchemaHyperlinkDescriptor } from 'json-schema-services/esm';
import { Injectable, Inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ISchemaAgent, IRelatableSchemaAgent, IdentityValue, SchemaNavigator, JsonSchema, ExtendedFieldDescriptor } from 'json-schema-services';

import { FieldContextProvider } from './field-context-provider.service';
import { FormField } from './models/form-field';
import { fieldComponentContextToken, FieldComponentContext } from './models/form-field-context';
import { LinkedDataCache } from './linked-data-cache.service';

import * as pointer from 'json-pointer';
import * as debuglib from 'debug';
var debug = debuglib('schema-ui:linked-data-provider');

/**
 * Class that helps with resolving linked field data.
 *
 * This class is used by some fields.
 */
@Injectable()
export class LinkedDataProvider {
    /**
     * Cached promise so we dont fetch the info twice.
     */
    private data: Promise<any[]>;

    /**
     * Cached schema agent for the linked resource.
     */
    private linkedAgent: Promise<ISchemaAgent>;

    public constructor(
        @Inject('ISchemaAgent') private agent: IRelatableSchemaAgent,
        @Inject(fieldComponentContextToken) private field: FieldComponentContext<FormField<any>>,
        @Inject(FieldContextProvider) private context: FieldContextProvider,
        @Inject(LinkedDataCache) private cache: LinkedDataCache
    ) { }

    /**
     * Get an linked resource as simplified data.
     *
     * @param context The context of the form (e.g. other form values)
     */
    protected resolveLinkedData(context: any, forceReload?: boolean): Promise<any[]> {
        if (!this.field.meta.field) {
            return Promise.reject(new Error('MultiSelectField: Field-data not set.'));
        }

        if (!this.field.meta.field.link) {
            return Promise.reject(new Error('MultiSelectField: Field-data does not contain a link! Without a set hyperlink we cannot load the filter values.'));
        }

        if (forceReload !== true) {
            // Check if we already cached it locally.
            if (this.data != null) {
                return this.data;
            }

            // Fetch state from cache.
            var state = this.cache.fetch(this.agent.schema.schemaId, this.field.meta.field.link as string);
            if (state !== null) {
                return Promise.resolve(state);
            }
        }

        if (this.agent.schema.hasLink(this.field.meta.field.link)) {
            this.linkedAgent = null;
            return this.data = Promise.resolve(context)
                .then(ctx => {
                    if (startsWith(this.field.meta.field.link as string, 'list')) {
                        return this.agent
                            .list(1, 1000, this.field.meta.field.link as any, ctx)
                            .then(cursor => cursor.all());
                    }
                    else if (startsWith(this.field.meta.field.link as string, 'read')) {
                        return this.agent
                            .read<any>(ctx, this.field.meta.field.link as any)
                            .then(item => {
                                try {
                                    return pointer.get(item, this.field.meta.field.data['pointer'] || '/');
                                }
                                catch (e) {
                                    debug(`[warn] unable to get the data for pointer "${this.field.meta.field.data['pointer']}"`);
                                }
                                return [];
                            });
                    }
                    else {
                        throw new Error('I cannot resolve this link, tip: prefix the link name with "read-" or "list-" so we know what to do.');
                    }
                })
                .then(state => {
                    this.cache.push(this.agent.schema.schemaId, this.field.meta.field.link as string, [], state);
                    return state;
                });
        }
        else {
            return Promise.reject(new Error('MultiSelectField: Field link is not a valid hyperlink: it doesnt exist on the current schema.'));
        }
    }

    /**
     * Get an linked resource as simplified data.
     *
     * @param context The context of the form (e.g. other form values)
     */
    public resolveLinkedResource(includeOriginal?: boolean): Promise<SimplifiedLinkedResource[]> {
        var link = this.agent.schema.getLink(this.field.meta.field.link),
            context = this.getLinkContext(link),
            isDynamic = this.isDynamicHyperSchemaLink(link);
        return this.resolveLinkedData(context).then(items =>
            this.mapMultipleChoice(items, context, isDynamic, includeOriginal));
    }

    /**
     * Resolve the simplified resource, if any of the (in the url referenced) variables is changed, the resource will be reloaded based on the new value.
     *
     * If the link does not contain any variables that can change in the current form, the observable is immediately completed.
     * You cannot change the context, because if you would, the stream would not change anyway, so you can use the promisable version for that.
     *
     * @param includeOriginal Whether or not to include the original item in the resulting simplified resource. Defaults to: false.
     *
     * @return An observable that emits a new array of simplified resources every time an dependency value/field is changed.
     */
    public streamLinkedResource(includeOriginal?: boolean): Observable<SimplifiedLinkedResource[]> {
        var link = this.agent.schema.getLink(this.field.meta.field.link),
            isDynamic = this.isDynamicHyperSchemaLink(link);

        if (!isDynamic) {
            return Observable.fromPromise(this.resolveLinkedResource(includeOriginal));
        }

        return this.streamLinkContext(link).map(context =>
            this.resolveLinkedData(context).then(items =>
                this.mapMultipleChoice(items, context, isDynamic, includeOriginal)) as any) as any;
    }

    /**
     * Convert the given list of simplified values to a list of the actual linked objects.
     *
     * @param items The simplified linked resource items.
     *
     * @return The non-simplified data linked using the described identity values.
     */
    public getLinkedDataFromSimplifiedLinkedData(items: SimplifiedLinkedResource[]): Promise<any | IdentityValue[]> {
        if (typeof this.field.meta.items === 'object') {
            if ((this.field.meta.items as JsonSchema).type === 'object') {
                return Promise.all([
                    this.resolveLinkedData(this.getLinkContext(this.agent.schema.getLink(this.field.meta.field.link))),
                    this.createLinkedAgent()
                ]).then(([data, agent]) => items.map(item => data.find(x => item.value === x[agent.schema.identityProperty])));
            }
            else {
                return Promise.resolve(items.map(x => x.value));
            }
        }
        else {
            return Promise.reject(new Error('The given field cannot be converted to linked items, indexed array schemas are unsupported.'));
        }
    }

    /**
     * Create an linked schema agent to perform requests on the linked resource.
     *
     * @param context The context of the form (e.g. other form values)
     */
    public createLinkedAgent(context?: any, forceReload?: boolean): Promise<ISchemaAgent> {
        if (forceReload !== true && this.linkedAgent != null) {
            return this.linkedAgent;
        }
        return this.linkedAgent = this.agent.createChildByLink(this.field.meta.field.link as string, context);
    }

    /**
     * Map an entity object to a multiple choice item.
     *
     * @param linkName The link that you want to map the choices for.
     * @param items The items that should be mapped.
     * @param forceReload
     * @param includeOriginal Whether or not original.
     */
    protected mapMultipleChoice(items: any[], context: any, forceReload?: boolean, includeOriginal?: boolean): Promise<SimplifiedLinkedResource[]> {
        return this.createLinkedAgent(context, forceReload).then(agent => items
            .map(item => ({
                name: getDisplayName(this.field.meta, items, item),
                description: getDescription(this.field.meta, item),
                order: getOrder(this.field.meta, item),
                value: getIdentityValue(agent.schema, this.field.meta, item),
                parent: getParentValue(this.field.meta, item),
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
     * Chooses between the ambient context and the one given, and returns the correct one (eventually).
     */
    protected getLinkContext(link: SchemaHyperlinkDescriptor): any {
        var pointers = this.agent.schema.getLinkUriTemplatePointers(link),
            context: any = { };
        for (var key in pointers) {
            if (pointers.hasOwnProperty(key)) {
                context[key] = this.context.getFieldValueByPointer(pointers[key]);
            }
        }
        return context;
    }

    /**
     * On every change of an
     */
    protected streamLinkContext(link: SchemaHyperlinkDescriptor): Observable<any> {
        var pointers = this.agent.schema.getLinkUriTemplatePointers(link),
            observables: Observable<any>[] = [];
        for (var key in pointers) {
            if (pointers.hasOwnProperty(key) && this.context.visible.indexOf(String(pointers[key])) > -1) {
                var field = this.context.findByPointer(pointers[key]);
                if (field != null && field.instance != null) {
                    observables.push(field.instance.changed);
                }
            }
        }

        return Observable.concat(observables).debounceTime(500).map(x => this.getLinkContext(link));
    }

    /**
     * Check whether the schema hyperlink contains variables that can dynamically change, depending on fields visible in the form.
     *
     * This methiod is used to determine if the result of the fetching of the target list can change based upon
     *
     * @param link The link to check.
     */
    private isDynamicHyperSchemaLink(link: SchemaHyperlinkDescriptor): boolean {
        var pointers = this.agent.schema.getLinkUriTemplatePointers(link);
        for (var key in pointers) {
            if (pointers.hasOwnProperty(key) && this.context.visible.indexOf(String(pointers[key])) > -1) {
                return true;
            }
        }
        return false;
    }
}

function getDisplayName(field: ExtendedFieldDescriptor, items: any[], item: any): string {
    if (field.field.data == null || field.field.data.label == null) {
        return item['name'] || item['displayName'] || item['internalName'] || item['entity'];
    }
    if (field.field.data.parent && field.field.data.mergeLabelWithParents === true) {
        return getDisplayNameForParent(field, items, item, item[field.field.data.label]);
    }
    return item[field.field.data.label];
}

function getDisplayNameForParent(field: ExtendedFieldDescriptor, items: any[], item: any, label: string): string {
    if (item[field.field.data.parent] != null) {
        var parent = (items || []).find(x => x[field.field.data.value] === item[field.field.data.parent]);
        if (parent != null) {
            label = parent[field.field.data.label] + ' › ' + label;
            if (parent[field.field.data.parent] != null) {
                label = getDisplayNameForParent(field, items, parent, label);
            }
        }
    }
    return label;
}

function getDescription(field: ExtendedFieldDescriptor, item: any): string {
    if (field.field.data == null || field.field.data.description == null) {
        return item['description'];
    }
    return item[field.field.data.description];
}

function getOrder(field: ExtendedFieldDescriptor, item: any): number {
    if (field.field.data == null || field.field.data.order == null) {
        return parseInt(item['order'], 10) || 0;
    }
    return parseInt(item[field.field.data.order], 10);
}

function getIdentityValue(schema: SchemaNavigator, field: ExtendedFieldDescriptor, item: any): IdentityValue {
    if (field.field.data == null || field.field.data.label == null) {
        try {
            // This will only work with listed properties (not with sub properties)
            return schema.getIdentityValue(item);
        }
        catch (e) {
            debug(`[warn] I cannot fetch the identity property for ${schema.entity}, please set it manually using the "value" data-property!`);
            return item['id'] || item['name'] || item['entity'];
        }
    }
    return item[field.field.data.value];
}

function getParentValue(field: ExtendedFieldDescriptor, item: any): IdentityValue {
    if (field.field.data == null || field.field.data.parent == null) {
        return item['parent'];
    }
    return item[field.field.data.parent];
}

function startsWith(str: string, target: string) {
    return String(str).slice(0, target.length) == String(target);
}

/**
 * Standardized object that represents the linked object, but only contains the values necesarry to display/choose the linked resource.
 */
export interface SimplifiedLinkedResource {
    /**
     * A short name that can be used for short displays.
     */
    name: string;

    /**
     * An completer description.
     */
    description: string;

    /**
     * The ordering number if applicable or 0.
     */
    order: number;

    /**
     * Whether or not this item is disabled.
     */
    disabled?: boolean;

    /**
     * The actual identity value(s) that link the two objects.
     */
    value: IdentityValue;

    /**
     * The identity value of the parent item, if set in the schema.
     */
    parent?: IdentityValue;

    /**
     * Original unmapped item.
     */
    original?: any;
}
