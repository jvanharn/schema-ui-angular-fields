import { FormField } from './form-field';

/**
 * Validatable form field.
 *
 * This interface adds functionality for custom validation (on top of the JSON-schema validation).
 */
export interface ValidatableFormField<T> extends FormField<T> {
    /**
     * Validate the value of the field against any custom validation rules.
     */
    validate(): FormFieldValidationResult | Promise<FormFieldValidationResult>;

    /**
     * Validate the value  of the field against any custom validation rules.
     *
     * @param results A list of error messages for the field that were given by the server.
     */
    validateWithServerResult(results: ServerValidationResult[]): FormFieldValidationResult;
}

/**
 * Validation result for a single field.
 */
export interface FormFieldValidationResult {
    /**
     * Optional, Error message describing what went wrong in the localized format of the user.
     */
    message?: string;

    /**
     * The validation level to show on the field.
     */
    level: ValidationLevel;

    /**
     * Whether or not the value is valid.
     */
    valid: boolean;
}

export interface ServerValidationResult {
    /**
     * The full field path as given by the server.
     */
    field: string;

    /**
     * The message as given by the server.
     */
    message: string;
}

/**
 * The validation colloring to show around the field.
 */
export enum ValidationLevel {
    /**
     * Pristine is default value, for unvalidated fields (e.g. ones that do not have)
     */
    Pristine,

    /**
     * Value is valid.
     */
    Success,

    /**
     * Value is acceptable but not ideal.
     */
    Warning,

    /**
     * Value is invalid.
     */
    Error
}
