import { NgModule, ModuleWithProviders } from '@angular/core';

import { FormFieldService, LOAD_FORM_FIELDS } from './form-field.service';
import { LinkedDataCache } from './linked-data-cache.service';
import { FieldComponentSwitchDirective } from './field-component-swap.directive';
import { formFieldRegistration } from './models/registerable-form-field';

@NgModule({
    declarations: [
        FieldComponentSwitchDirective,
    ],
    providers: [
        //FormFieldService,
        LinkedDataCache,
    ],
    exports: [
        FieldComponentSwitchDirective,
    ]
})
export class SchemaFieldsModule {
    /**
     * Returns a NgModule for use in the root Module.
     *
     * @param entryFields A list of dynamically inserted fields (components implementing FormField).
     * @returns ModuleWithProviders
     */
    public static forRoot(entryFields?: formFieldRegistration[]): ModuleWithProviders {
        return {
            ngModule: SchemaFieldsModule,
            providers: [
                FormFieldService,
                FormFieldService.provideFormFields(entryFields || []),
            ],
        };
    }

    /**
     * Returns a NgModule that supplies the given (additional) fields.
     *
     * @param entryFields A list of dynamically inserted fields (components implementing FormField).
     * @returns ModuleWithProviders
     */
    public static withFields(entryFields?: formFieldRegistration[]): ModuleWithProviders {
        return {
            ngModule: SchemaFieldsModule,
            providers: FormFieldService.provideFormFields(entryFields || []),
        };
    }
}
