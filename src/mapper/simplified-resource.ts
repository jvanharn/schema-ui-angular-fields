import { IdentityValue } from 'json-schema-services';

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
