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
     * Lists all fields
     */
    private components: CachedFieldComponent[] = [];

    /**
     * Constructs the form field service.
     */
    public constructor(
        @Inject(Injector) injector: Injector,
    ) {
        this.registerFieldsFromInjector(injector);
    }

    /**
     * Register a field by it's alias.
     *
     * @param alias The alias to register the component by.
     */
    public registerField<T>(component: RegisterableFormField, alias: string | string[] = []): void {
        var aliases = Array.isArray(alias) ? alias : [alias];
        if (component.fieldName && aliases.indexOf(component.fieldName) < 0) {
            aliases.unshift(component.fieldName);
        }
        if (Array.isArray(component.fieldAliases)) {
            for (var a of component.fieldAliases) {
                if (aliases.indexOf(a) < 0) {
                    aliases.push(a);
                }
            }
        }

        this.components.unshift({
            aliases,
            component,
        });
    }

    /**
     * Register all field components setup in LOAD_FORM_FIELDS multi injector-tokens.
     *
     * @param injector Injector that contains the registrations to add to the form-field-service.
     */
    public registerFieldsFromInjector(injector: Injector): void {
        if (injector == null) {
            throw new Error('Invalid injector given! Cannot fetch form-field registrations from something that isn\'t an injector!');
        }

        try {
            var fields: formFieldRegistration[] = [].concat.apply([], injector.get<formFieldRegistration[]>(LOAD_FORM_FIELDS));
        }
        catch(err) {
            console.error('Unable to fetch the available fields.', err);
            return null;
        }

        for (var field of fields) {
            if (Array.isArray(field)) {
                this.registerField(field[1] as any, field[0]);
            }
        }
    }

    /**
     * Check wheather the field with the given name exists.
     */
    public hasFieldName(name: string): boolean {
        return this.components.some(x => x.aliases.indexOf(name) >= 0);
    }

    /**
     * Get the field component for the given name.
     *
     * @param name The name of the field to fetch the class for.
     * @param injector Optionally, an injector that should be looked in first before checking other injectors.
     */
    public getFieldComponentByName<T extends FormField<any>>(name: string, injector?: Injector): Type<T> | null {
        var result: Type<T> | null;

        if (injector) {
            // Search the provided injector.
            result = this.tryGetFieldComponentByName(name, injector);
        }

        if (result == null && this.hasFieldName(name)) {
            return this.components.find(x => x.aliases.indexOf(name) >= 0).component as any;
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
     * @param injector (Optionally) The injector that should be searched for the field.
     */
    private tryGetFieldComponentByName<T extends FormField<any>>(name: string, injector: Injector): Type<T> | null {
        try {
            var fields: formFieldRegistration[] = [].concat.apply([], injector.get<formFieldRegistration[]>(LOAD_FORM_FIELDS));
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
                return (entry as RegisterableFormField).fieldName === name || ((entry as RegisterableFormField).fieldAliases || []).some(x => x === name);
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

interface CachedFieldComponent {
    aliases: string[];
    component: RegisterableFormField;
}
