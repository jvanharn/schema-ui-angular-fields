import { JsonPatchOperation, JsonFormSchema, EntityIdentity, ExtendedFieldDescriptor } from 'json-schema-services';
import { Subject } from 'rxjs';

/**
 * Form field implementation.
 */
export interface FormField<T> {
    /**
     * The value of the field.
     */
    value: T;

    /**
     * Initial value.
     */
    initialValue: T;

    /**
     * The disabled state of a field.
     */
    disabled: boolean;

    /**
     * Whether or not the value is different from it's initial value.
     */
    dirty: boolean;

    /**
     * Event that is fired after the value changes, preferably debounced or for example when the field loses focus.
     */
    changed: Subject<T>;

    /**
     * Whether or not this field is currently focus[s]ed.
     */
    focused: boolean;

    /**
     * Reset this field to it's initialValue.
     */
    reset(): void;
}

/**
 * Form field that can generate custom patch operations.
 *
 * When you implement this interface this method will be called once the template is rendered.
 */
export interface PatchableFormField<T> extends FormField<T> {
    /**
     * Get a list of patch operations for this field.
     *
     * This method is called when the parent form is saved as a patch operation.
     * @param includeTests Whether or not to include tests to verify that the previous value still is the same.
     */
    getPatchOperations(includeTests?: boolean): JsonPatchOperation[];
}
