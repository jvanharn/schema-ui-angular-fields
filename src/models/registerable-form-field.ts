import { Type } from '@angular/core';
import { FormField } from './form-field';

/**
 * Formfield that can be registred in the form-field-service.
 */
export interface RegisterableFormField {
    /**
     * The name of the field.
     */
    fieldName: string;

    readonly prototype: FormField<any>;
}

/**
 * Definition of a field-registration for the module.
 */
export type formFieldRegistration = [string, Type<FormField<any>>] | RegisterableFormField;
