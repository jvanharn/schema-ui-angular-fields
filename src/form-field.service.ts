import { Injectable, Inject, Injector, Type, OpaqueToken, ANALYZE_FOR_ENTRY_COMPONENTS } from '@angular/core';
import { FormField } from './models/form-field';

export const LOAD_FORM_FIELDS = new OpaqueToken('LoadFormFields');

/**
 * This service supplies component instances to load for the FormBuilder.
 * Other modules can register custom fields here.
 */
@Injectable()
export class FormFieldService {
    /**
     * Component map that maps field names to their component classes.
     */
    private components: { [key: string]: Type<any> } = { };

    /**
     * Constructs the form field service.
     */
    public constructor(
        @Inject(Injector) private injector: Injector
    ) {

    }

    /**
     * Register field.
     */
    public registerField<T>(name: string, component: Type<T>): void {
        if (this.hasFieldName(name)) {
            throw new Error('FormFieldService.registerField: Field already registered.');
        }
        this.components[name] = component;
    }

    /**
     * Check wheather the field with the given name exists.
     */
    public hasFieldName(name: string): boolean {
        return this.components.hasOwnProperty(name);
    }

    /**
     * Get the field component for the given name.
     */
    public getFieldComponentByName<T extends FormField<any>>(name: string): Type<T> | null {
        if (this.hasFieldName(name)) {
            return this.components[name];
        }
        try {
            var fields = [].concat.apply([], this.injector.get(LOAD_FORM_FIELDS));
        }
        catch(err) {
            console.error('Unable to fetch the available fields.');
            return null;
        }
        return fields.find(x => removeRight(x['name'], 'Component') === name);
    }

    /**
     * Get the first field component that matches the given field names.
     */
    public getFirstFieldComponentByNames(names: string[]): Type<any> | null {
        var field: Type<any>;
        for (var name of names) {
            field = this.getFieldComponentByName(name);
            if (field != null) {
                return field;
            }
        }
        return null;
    }

    /**
     * Provide form fields to extend the form.
     */
    public static provideFormFields(fields: Type<FormField<any>>[]): any[] {
        return [
            { provide: ANALYZE_FOR_ENTRY_COMPONENTS, useValue: fields, multi: true },
            { provide: LOAD_FORM_FIELDS, useValue: fields, multi: true }
        ];
    }
}

function removeRight(str: string, remove: string): string {
    if (str.lastIndexOf(remove) + remove.length === str.length) {
        return str.substr(0, str.length - remove.length);
    }
    return str;
}
