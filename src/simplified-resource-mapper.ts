import { SchemaNavigator, ExtendedFieldDescriptor, IdentityValue, SchemaFieldDescriptor } from 'json-schema-services';
import { SimplifiedLinkedResource } from './simplified-resource';

import debuglib from 'debug';
const debug = debuglib('schema-ui:simplified-resource-mapper');

export class SimplifiedResourceMapper {
    public constructor(
        private schema: SchemaNavigator,
        private field: SchemaFieldDescriptor,
    ) { }

    /**
     * Transform the given data to a simplified resource.
     *
     * @param items The items to transform.
     * @param includeOriginal Whether or not to include the original resource.
     */
    public transform(items: any[], includeOriginal?: boolean): SimplifiedLinkedResource[] {
        return items
            .map(item => ({
                name: this.getDisplayName(item, items),
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

    public getDisplayName(item: any, items: any[] = [item]): string {
        if (this.field.data == null || this.field.data.label == null) {
            return item['name'] || item['displayName'] || item['internalName'] || item['entity'];
        }
        if (this.field.data.parent && this.field.data.mergeLabelWithParents === true) {
            return this.getDisplayNameForParent(items, item, item[this.field.data.label]);
        }
        return item[this.field.data.label];
    }

    public getDisplayNameForParent(items: any[], item: any, label: string): string {
        if (item[this.field.data.parent] != null) {
            var parent = (items || []).find(x => x[this.field.data.value] === item[this.field.data.parent]);
            if (parent != null) {
                label = parent[this.field.data.label] + ' › ' + label;
                if (parent[this.field.data.parent] != null) {
                    label = this.getDisplayNameForParent(items, parent, label);
                }
            }
        }
        return label;
    }

    public getDescription(item: any): string {
        if (this.field.data == null || this.field.data.description == null) {
            return item['description'];
        }
        return item[this.field.data.description];
    }

    public getOrder(item: any): number {
        if (this.field.data == null || this.field.data.order == null) {
            return parseInt(item['order'], 10) || 0;
        }
        return parseInt(item[this.field.data.order], 10);
    }

    public getIdentityValue(item: any): IdentityValue {
        if (this.field.data == null || this.field.data.label == null) {
            try {
                // This will only work with listed properties (not with sub properties)
                return this.schema.getIdentityValue(item);
            }
            catch (e) {
                debug(`[warn] I cannot fetch the identity property for ${this.schema.entity}, please set it manually using the "value" data-property!`);
                return item['id'] || item['name'] || item['entity'];
            }
        }
        return item[this.field.data.value];
    }

    public getParentValue(item: any): IdentityValue {
        if (this.field.data == null || this.field.data.parent == null) {
            return item['parent'];
        }
        return item[this.field.data.parent];
    }
}
