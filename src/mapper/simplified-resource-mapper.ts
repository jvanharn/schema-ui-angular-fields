import { SchemaNavigator, IdentityValue, SchemaFieldDescriptor, tryPointerGet } from 'json-schema-services';

import { SimplifiedLinkedResource } from './simplified-resource';

import cmptpl from 'string-template/compile';
import debuglib from 'debug';
const debug = debuglib('schema-ui:simplified-resource-mapper');

/**
 * Class that simplifies a schema into a simplified object with the same properties for commonly used values in an UI.
 */
export class SimplifiedResourceMapper {
    /**
     * Method that automagically generates a display name for this field using its template.
     */
    private readonly compiledDisplaynameGenerator: (item: any) => string;

    /**
     * @param field The form field descriptor of the field that refers to the external resource.
     * @param schema The targetted resource schema (by the field given below), so NOT of the schema the field resides in.
     */
    public constructor(
        protected field: SchemaFieldDescriptor,
        protected schema?: SchemaNavigator,
    ) {
        if (!(schema instanceof SchemaNavigator)) {
            throw new Error('SimplifiedResourceMapper.constructor; The given schema is not a SchemaNavigator!');
        }

        if (this.field.data && typeof this.field.data.displayTemplate === 'string') {
            this.compiledDisplaynameGenerator = cmptpl(this.field.data.displayTemplate);
        }
    }

    /**
     * Transform the given data to a simplified resource.
     *
     * @param items The items to transform.
     * @param includeOriginal Whether or not to include the original resource.
     */
    public transform(items: any[], includeOriginal?: boolean): SimplifiedLinkedResource[] {
        return items
            .map(item => ({
                name: this.getDisplayName(item),
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
            });
    }

    /**
     * Get the display name of the given item.
     *
     * @param item The item to get the displayed name for.
     * @param items A complete list of all other items, used to find the parent of the current item.
     */
    public getDisplayName(item: any): string {
        if (!!this.compiledDisplaynameGenerator) {
            return this.compiledDisplaynameGenerator(item);
        }

        if (this.field.data == null || this.field.data.label == null) {
            return item['name'] || item['displayName'] || item['internalName'] || item['entity'];
        }

        return item[this.field.data.label];
    }

    /**
     * Get the description for the given item.
     *
     * @param item
     */
    public getDescription(item: any): string {
        if (this.field.data == null || this.field.data.description == null) {
            return item['description'];
        }
        return item[this.field.data.description];
    }

    /**
     * Get an numeric ordering indicator for the given item.
     *
     * @param item
     */
    public getOrder(item: any): number {
        if (this.field.data == null || this.field.data.order == null) {
            return parseInt(item['order'], 10) || 0;
        }
        return parseInt(item[this.field.data.order], 10);
    }

    /**
     * Get the referenced primary key identity value for the given item.
     *
     * @param item
     */
    public getIdentityValue(item: any): IdentityValue {
        if (this.field.data != null && this.field.data.value != null) {
            return item[this.field.data.value];
        }
        if (this.field.targetIdentity != null && typeof this.field.targetIdentity === 'string' && this.field.targetIdentity.length > 1) {
            return tryPointerGet(item, this.field.targetIdentity.startsWith('/') ? this.field.targetIdentity : '/' + this.field.targetIdentity);
        }

        try {
            // This will only work with listed properties (not with sub properties)
            return this.schema.getIdentityValue(item);
        }
        catch (e) {
            debug(`[warn] I cannot fetch the identity property for ${this.schema.entity}, please set it manually using the "value" data-property!`);
            return item['id'] || item['name'] || item['entity'];
        }
    }

    /**
     * Get the identity key for the given parent item.
     *
     * @param item
     */
    public getParentValue(item: any): IdentityValue {
        if (this.field.data == null || this.field.data.parent == null) {
            return item['parent'];
        }
        return item[this.field.data.parent];
    }
}
