import { Injectable, Inject } from '@angular/core';
import { from, concat, of, merge, Observable, throwError } from 'rxjs';
import { concatMap, debounceTime, map } from 'rxjs/operators';
import { ISchemaAgent, IRelatableSchemaAgent, IdentityValue, JsonSchema, SchemaHyperlinkDescriptor } from 'json-schema-services';

import { FieldContextProvider } from './field-context-provider.service';
import { fieldComponentContextToken, FieldComponentContext } from './models/form-field-context';
import { CachedDataProvider } from './cached-data-provider.service';
import { SimplifiedLinkedResource } from './simplified-resource';
import { SimplifiedResourceMapper } from './simplified-resource-mapper';

import debuglib from 'debug';
const debug = debuglib('schema-ui:linked-data-provider');

/**
 * The minimum time between context emitting (and thus reloading of resources).
 */
const contextStreamValueDebounceTime = 350;

/**
 * Class that helps with resolving linked field data.
 *
 * This class is used by some fields.
 *
 * TODO: Refactor this to make a version that does not depend on being in a form.
 */
@Injectable()
export class LinkedDataProvider {
    /**
     * Cached promise so we dont fetch the info twice.
     */
    private data: Promise<any[]>;

    /**
     * Simplified resource mapper instance.
     */
    private mapper: Promise<SimplifiedResourceMapper>;

    /**
     * Whether or not we are currently loading.
     */
    private loading: boolean = false;

    public constructor(
        @Inject('ISchemaAgent') private agent: IRelatableSchemaAgent, //@todo Make this optional, and require an ISchemaClient implementation with @schema-ui/core@1.0.0+
        @Inject(fieldComponentContextToken) private field: FieldComponentContext,
        @Inject(CachedDataProvider) private provider: CachedDataProvider,
        @Inject(FieldContextProvider) private context: FieldContextProvider,
    ) { }

    /**
     * Whether or not we are currently loading a resource.
     */
    public isLoading(): boolean {
        return this.loading;
    }

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
        }

        return this.data = this.provider.resolveDataThrough(
            this.agent, this.field.meta.field.link as string, !!this.field.meta.field.data ? this.field.meta.field.data.pointer : void 0, context, forceReload);
    }

    /**
     * Get an linked resource as simplified data.
     *
     * @param context The context of the form (e.g. other form values)
     */
    public resolveLinkedResource(includeOriginal?: boolean): Promise<SimplifiedLinkedResource[]> {
        var link = this.agent.schema.getLink(this.field.meta.field.link);
        if (link == null) {
            return Promise.reject(new Error(
                `The field by absolute json-pointer "${this.agent.schema.schemaId}${this.field.pointer}" defines relation by link ` +
                `"${this.field.meta.field.link}", but it does not exist on the parent schema!`));
        }
        var context = this.getLinkContext(link),
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
        if (this.field.meta.field.link == null || this.field.meta.field.link === '') {
            return throwError(new Error(`The field "${this.field.pointer}" has no linked resource!`));
        }

        var link = this.agent.schema.getLink(this.field.meta.field.link),
            isDynamic = this.isDynamicHyperSchemaLink(link);

        if (!isDynamic) {
            return from(this.resolveLinkedResource(includeOriginal));
        }

        return this.streamLinkContext(link).pipe(
            concatMap(context => from(
                this.resolveLinkedData(context, true).then(items =>
                    this.mapMultipleChoice(items, context, isDynamic, includeOriginal)))));
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
        return this.provider.resolveAgentChild(this.agent, this.field.meta.field.link as string, context, forceReload, true).then(([agent]) => agent);
    }

    /**
     * Get mapper to transform data into simplified form.
     *
     * @param context
     * @param forceReload
     */
    protected getSimplifiedResourceMapper(context?: any, forceReload?: boolean): Promise<SimplifiedResourceMapper> {
        if (!forceReload && !!this.mapper) {
            return this.mapper;
        }

        return this.mapper = this.provider.resolveAgentChild(this.agent, this.field.meta.field.link as string, context, forceReload, true)
            .then(([agent]) => new SimplifiedResourceMapper(this.field.meta.field, agent.schema));
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
        return this.getSimplifiedResourceMapper(context, forceReload).then(mapper => mapper.transform(items, includeOriginal));
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
     * On every change of a field that is mentioned in the uriTemplate a new context will be emitted with the changed uri template values.
     */
    protected streamLinkContext(link: SchemaHyperlinkDescriptor): Observable<any> {
        var pointers = this.agent.schema.getLinkUriTemplatePointers(link),
            observables: Observable<any>[] = [ ];
        for (var key in pointers) {
            if (pointers.hasOwnProperty(key) && this.context.visible.indexOf(String(pointers[key])) > -1) {
                var field = this.context.findByPointer(pointers[key]);
                if (field != null && field.instance != null) {
                    if (this.context.isCreateMode()) {
                        observables.push(field.instance.changed);
                    }
                    else {
                        observables.push(concat(of(field.ctx.initialValue), field.instance.changed));
                    }
                }
            }
        }

        return merge(...observables).pipe(
            debounceTime(contextStreamValueDebounceTime),
            map(x => this.getLinkContext(link))
        );
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
