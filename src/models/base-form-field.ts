import { Subject } from 'rxjs';

import debuglib from 'debug';
const debug = debuglib('schema-ui:base-form-field');

import { FormField } from './form-field';
import { FieldComponentContext } from './form-field-context';

/**
 * Base field implementation that contains the common logic for form fields.
 */
export abstract class BaseFormField<T> implements FormField<T>
{
    /**
     * Whether or not the field is loading.
     */
    public loading: boolean; //default: false

    /**
     * Whether or not this field is disabled.
     */
    public disabled: boolean;

    /**
     * Whether or not this field is currently focus[s]ed.
     */
    public focused: boolean;

    /**
     * Event fired when the value of this field changes.
     */
    public changed: Subject<T> = new Subject<T>();

    /**
     * The initial value of the field.
     */
    public initialValue: T | null;

//region (get/set) property: value
    /**
     * @access private
     * @hidden
     */
    private _value: T = null;

    /**
     * Access the current value of the field.
     */
    public get value(): T {
        return this._value;
    }
    public set value(val: T) {
        if (val === this._value || (val == null && this._value == null)) {
            return;
        }

        this._value = val;
        this._dirty = true;
        this.changed.next(val);
    }
//endregion

//region (get/set) property: dirty
    /**
     * Backing attribute of 'dirty' property.
     */
    protected _dirty: boolean = false;

    /**
     * Whether or not the value has changed from it's initial value.
     */
    public get dirty(): boolean {
        return this._dirty;
    }
    public set dirty(value: boolean) {
        console.warn(`Forced the dirty state of field ${this.context.id}!`);
        this._dirty = value;
        this.changed.next(this.value);
    }
//endregion

    /**
     * Creates an new instance of this field.
     */
    public constructor(public context: FieldComponentContext<BaseFormField<T>>, delayValueInit?: boolean) {
        if (delayValueInit !== true) {
            this.initializeFieldValue();
        }
    }

    /**
     * Initializes the values of the field.
     *
     * Makes it possible to delay the init of the field.
     */
    protected initializeFieldValue(): void {
        // Set the initial field value. This value is used to check dirty state etc.
        if (this.context.initialValue !== void 0) {
            if (Array.isArray(this.context.initialValue))
                this.initialValue = (<any> this.context.initialValue).slice();
            else
                this.initialValue = this.context.initialValue;
        }

        // Set the value itself correctly. Will differ from the initial value in, for example, copy mode.
        if(this.context.value !== void 0) {
            if (Array.isArray(this.context.value))
                this.value = (<any> this.context.value).slice();
            else
                this.value = this.context.value;
            this._dirty = this.context.initialValue !== this.context.value;
        }
        else if (this.context.initialValue !== void 0) {
            if (Array.isArray(this.context.initialValue))
                this.value = (<any> this.context.initialValue).slice();
            else
                this.value = this.context.initialValue;
            this._dirty = false;
        }
        else {
            this.value = this.emptyValue();
            this._dirty = false;
        }
    }

    /**
     * Reset's the value of this field to it's initial value.
     */
    public reset(): void {
        if (this.initialValue !== void 0) {
            if (Array.isArray(this.initialValue))
                this.value = (<any>this.initialValue).slice();
            else
                this.value = this.initialValue;
        }
        else {
            this.value = this.initialValue = this.emptyValue();
        }
        this._dirty = false;
    }

    /**
     * Returns the *empty* value for this field.
     */
    public emptyValue(): T {
        if (typeof this.context.meta.default !== 'undefined') {
            debug('asked for the default in the constructor instead of the parent form');
            return this.context.meta.default;
        }

        switch (this.context.meta.type) {
            case 'integer':
            case 'number':
                return <any>0;
            case 'string':
                return <any>'';
            case 'boolean':
                return <any>false;
            case 'array':
                return <any>[];
            default:
                return void 0;
        }
    }
}
