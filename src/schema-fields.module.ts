import { NgModule, ModuleWithProviders } from '@angular/core';

import { FormFieldService } from './form-field.service';
import { CachedDataProvider } from './cached-data-provider.service';
import { LooselyLinkedDataProvider } from './loosely-linked-data-provider.service';
import { LinkedDataCache } from './linked-data-cache.service';
import { FieldComponentSwitchDirective } from './field-component-swap.directive';
import { formFieldRegistration } from './models/registerable-form-field';

@NgModule({
    declarations: [
        FieldComponentSwitchDirective,
    ],
    providers: [
        CachedDataProvider,
        LooselyLinkedDataProvider,
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
    public static forRoot(entryFields?: formFieldRegistration[]): ModuleWithProviders<SchemaFieldsModule> {
        return {
            ngModule: SchemaFieldsModule,
            providers: [
                FormFieldService,
                FormFieldService.provideFormFields(entryFields || []),
                LinkedDataCache,
            ],
        };
    }

    /**
     * Returns a NgModule that supplies the given (additional) fields.
     *
     * @param entryFields A list of dynamically inserted fields (components implementing FormField).
     * @returns ModuleWithProviders
     */
    public static withFields(entryFields?: formFieldRegistration[]): ModuleWithProviders<SchemaFieldsModule> {
        return {
            ngModule: SchemaFieldsModule,
            providers: FormFieldService.provideFormFields(entryFields || []),
        };
    }
}
