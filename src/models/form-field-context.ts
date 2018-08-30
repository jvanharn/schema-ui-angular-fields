import { InjectionToken } from '@angular/core';
import { ExtendedFieldDescriptor } from 'json-schema-services';

/**
 * Form modes.
 */
export type FormModes = 'view' | 'edit' | 'copy' | 'create';

/**
 * Context required to create the field.
 */
export interface FieldComponentContext {
    /**
     * Identity to be used for the Label -> field relation
     *
     * Can be any string to uniquely identitfy this field in the form (like in the DOM).
     */
    id: string;

    /**
     * Name/id of the original property in the JSON object.
     */
    name?: string;

    /**
     * The JSON Pointer pointing to the field in the original JSON object.
     */
    pointer: string;

    /**
     * Initial value of the field.
     */
    initialValue: any;

    /**
     * Whether or not the field is required.
     */
    required: boolean;

    /**
     * Whether or not the field is read-only.
     */
    readonly: boolean;

    /**
     * The value the field should initialize with, this is meant for copy mode.
     * Undefined when not applicable.
     */
    value: any | undefined;

    /**
     * Metadata for the field (whatever was in the schema for the field).
     */
    meta: ExtendedFieldDescriptor;
}

export const fieldComponentContextToken = new InjectionToken('FieldComponentContextToken');
