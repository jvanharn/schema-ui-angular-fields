import { Injectable, Inject } from '@angular/core';
import { ISchemaAgent, IRelatableSchemaAgent, IdentityValue, SchemaNavigator, JsonSchema, ExtendedFieldDescriptor } from 'json-schema-services';

import { FieldContextProvider } from './field-context-provider.service';
import { FormField } from './models/form-field';
import { fieldComponentContextToken, FieldComponentContext } from './models/form-field-context';

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
     * Cached linked-data.
     */
    private data: Promise<any[]>;

    /**
     * Cached schema agent for the linked resource.
     */
    private linkedAgent: Promise<ISchemaAgent>;

    public constructor(
        @Inject('ISchemaAgent') private agent: IRelatableSchemaAgent,
        @Inject(fieldComponentContextToken) private field: FieldComponentContext<FormField<any>>,
        @Inject(FieldContextProvider) private context: FieldContextProvider
    ) { }

    /**
     * Get an linked resource as simplified data.
     *
     * @param context The context of the form (e.g. other form values)
     */
    public resolveLinkedData(context?: any, forceReload?: boolean): Promise<any[]> {
        if (!this.field.meta.field) {
            return Promise.reject(new Error('MultiSelectField: Field-data not set.'));
        }

        if (!this.field.meta.field.link) {
            return Promise.reject(new Error('MultiSelectField: Field-data does not contain a link! Without a set hyperlink we cannot load the filter values.'));
        }

        if (forceReload !== true && this.data != null) {
            return this.data;
        }

        if (this.agent.schema.hasLink(this.field.meta.field.link)) {
            this.linkedAgent = null;
            return this.data = this.chooseAppropriateContext(context).then(ctx => {
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
    public resolveSimplifiedLinkedData(context?: any, forceReload?: boolean): Promise<SimplifiedLinkedResource[]> {
        return this.chooseAppropriateContext(context).then(ctx =>
            this.resolveLinkedData(ctx, forceReload).then(items =>
                this.mapLinkedData(items, ctx, forceReload)));
    }

    /**
     * Convert already received values to the simplified format.
     *
     * @param items The data to convert/map.
     * @param context The context of the form (e.g. other form values)
     */
    public mapLinkedData(items: any[], context?: any, forceReload?: boolean): Promise<SimplifiedLinkedResource[]> {
        return this.chooseAppropriateContext(context).then(ctx =>
            this.mapMultipleChoice(items, ctx, forceReload));
    }

    /**
     * Convert the given list of simplified values to a list of the actual linked objects.
     *
     * @param items The simplified linked resource items.
     */
    public getLinkedDataFromSimplifiedLinkedData(items: SimplifiedLinkedResource[]): Promise<any | IdentityValue[]> {
        if (typeof this.field.meta.items === 'object') {
            if ((this.field.meta.items as JsonSchema).type === 'object') {
                return Promise.all([this.resolveLinkedData(), this.createLinkedAgent()])
                    .then(([data, agent]) =>
                        items.map(item => data.find(x => item.value === x[agent.schema.identityProperty])));
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
        return this.linkedAgent =
            this.chooseAppropriateContext(context).then(ctx =>
                this.agent.createChildByLink(this.field.meta.field.link as string, ctx));
    }

    /**
     * Map an entity object to a multiple choice item.
     *
     * @param linkName The link that you want to map the choices for.
     * @param items The items that should be mapped.
     */
    private mapMultipleChoice(items: any[], context: any, forceReload?: boolean): Promise<SimplifiedLinkedResource[]> {
        return this.createLinkedAgent(context, forceReload).then(agent => items
            .map(item => ({
                name: getDisplayName(this.field.meta, items, item),
                description: getDescription(this.field.meta, item),
                order: getOrder(this.field.meta, item),
                value: getIdentityValue(agent.schema, this.field.meta, item)
            } as SimplifiedLinkedResource))
            .sort((a: SimplifiedLinkedResource, b: SimplifiedLinkedResource) => {
                if (a.order === b.order) {
                    return a.name.localeCompare(b.name);
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
    private chooseAppropriateContext(context?: any): Promise<any> {
        if (context != null && Object.keys(context).length) {
            return Promise.resolve(context);
        }
        return this.context.getData();
    }
}

function getDisplayName(field: ExtendedFieldDescriptor, items: any[], item: any): string {
    if (field.field.data == null || field.field.data.label == null) {
        return item['name'] || item['displayName'] || item['internalName'] || item['entity'];
    }
    if (field.field.data.parent) {
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

function startsWith(str, target) {
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
}
