import { Injectable, Inject, Injector, Type, InjectionToken, ANALYZE_FOR_ENTRY_COMPONENTS } from '@angular/core';
import { FormField } from './models/form-field';
import { formFieldRegistration, RegisterableFormField } from './models/registerable-form-field';

export const LOAD_FORM_FIELDS = new InjectionToken('LoadFormFields');

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
        @Inject(Injector) private injector: Injector,
    ) { }

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
     *
     * @param name The name of the field to fetch the class for.
     * @param injector Optionally, an injector that should be looked in first before checking other injectors.
     */
    public getFieldComponentByName<T extends FormField<any>>(name: string, injector?: Injector): Type<T> | null {
        if (this.hasFieldName(name)) {
            return this.components[name];
        }

        var result: Type<T> | null;

        if (injector) {
            // Search the provided injector.
            result = this.tryGetFieldComponentByName(name, injector);
        }

        if (result === null) {
            result = this.tryGetFieldComponentByName(name, this.injector);
        }

        return result;
    }

    /**
     * Get the first field component that matches the given field names.
     *
     * @param names The names of the fields to fetch the first matching class for.
     * @param injector Optionally, an injector that should be looked in first before checking other injectors.
     */
    public getFirstFieldComponentByNames(names: string[], injector?: Injector): Type<any> | null {
        var field: Type<any>;
        for (var name of names) {
            field = this.getFieldComponentByName(name, injector);
            if (field != null) {
                return field;
            }
        }
        return null;
    }

    /**
     * Attempt to fetch the field list from the given injector.
     *
     * @param name Name of the field to fetch the class for.
     * @param injector The injector that should be searched for the field.
     */
    private tryGetFieldComponentByName<T extends FormField<any>>(name: string, injector: Injector): Type<T> | null {
        try {
            var fields: formFieldRegistration[] = [].concat.apply([], this.injector.get<formFieldRegistration[]>(LOAD_FORM_FIELDS));
        }
        catch(err) {
            console.error('Unable to fetch the available fields.', err);
            return null;
        }

        var result: formFieldRegistration | null = fields.find(entry => {
            if (Array.isArray(entry as any)) {
                return (entry as any)[0] === name;
            }
            else if ((entry as RegisterableFormField).fieldName == null) {
                console.warn(`Warning: The field by name "${(entry as any).name}" does not contain a static name, which will result in this field failing to load when using it in packers like Webpack!
Add something like "public static fieldName: string = '${removeRight((entry as any).name, 'Component')}';", take care to not include the "Component" part in this name!`);
                (entry as RegisterableFormField).fieldName = (entry as any).name;
                return (entry as RegisterableFormField).fieldName === name;
            }
            else {
                return (entry as RegisterableFormField).fieldName === name;
            }
        });

        if (result != null) {
            return Array.isArray(result) ? result[1] as any : result;
        }
        return null;
    }

    /**
     * Provide form fields to extend the form.
     */
    public static provideFormFields(fields: formFieldRegistration[]): any[] {
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
