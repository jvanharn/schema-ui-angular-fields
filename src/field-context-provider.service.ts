import { Inject, Optional } from '@angular/core';
import { MessageBundle } from '@angular/compiler';
import {
    ISchemaAgent,
    IRelatableSchemaAgent,
    EndpointSchemaAgent,
    SchemaNavigator,
    ExtendedFieldDescriptor,
    defaultFieldsetId,
    JsonPatchOperation,
    ValidatorCache,
    ISchemaValidator,
    EntityIdentity,
    ValidationError,
    fixJsonPointerPath
} from 'json-schema-services';

import { FormField, PatchableFormField } from './models/form-field';
import { FieldComponentContext, FormModes } from './models/form-field-context';
import { ValidatableFormField, FormFieldValidationResult, ValidationLevel } from './models/form-field-validation';

import * as _ from 'lodash';
import * as pointer from 'json-pointer';

import * as debuglib from 'debug';
var debug = debuglib('schema-ui:field-context-provider');

/**
 * Class that maintains a list of fieldsets and fields for a form builder.
 */
export class FieldContextProvider {
    /**
     * Validator used to validate fields in this context.
     */
    protected readonly validator: Promise<ISchemaValidator>;

    /**
     * List of all fieldsets and fields.
     */
    public readonly mapped: FormFieldSet[];

    /**
     * List of all visible fieldsets and fields in the form.
     */
    public readonly sets: ReadonlyArray<FormFieldSet>;

    /**
     * A list of JSON-Pointers to fields that should be displayed.
     */
    public get visible(): ReadonlyArray<string> {
        return this._visible as any;
    }
    public set visible(val: ReadonlyArray<string>) {
        if (!_.isArray(val)) {
            return;
        }
        this._visible = val as any;
        this.changeFieldVisibility(x => _.isEmpty(this._visible) || _.includes(this._visible, x.ctx.pointer));
    }
    private _visible: string[] = [];

//region Formmode check methods
    /**
     * Whether or not any fields are still loading.
     */
    public isLoading(): boolean {
        return !_.every(
            this.sets,
            set => _.every(
                set.fields,
                field => this.isFieldAvailable(field)
            )
        );
    }

    /**
     * Whether or not all values are valid, is true by default unless you force the validation execution.
     */
    public isValid(): boolean {
        return _.every(
            this.sets,
            set => _.every(
                set.fields,
                field => field.validation.valid
            )
        );
    }

    /**
     * Whether or not any values have been changed.
     */
    public isDirty(): boolean {
        return _.some(
            this.sets,
            set => _.some(
                set.fields,
                // If the field hasnt initialized yet; it is not dirty, except when we are in create mode.
                field => this.isFieldAvailable(field) && field.instance != null && !!field.instance.dirty
            )
        );
    }

    /**
     * This value is true when no single value has been touched, and so not validators have been fired yet.
     */
    public isPristine(): boolean {
        return _.every(
            this.sets,
            set => _.every(
                set.fields,
                field => field.validation.level === ValidationLevel.Pristine
            )
        );
    }

    /**
     * Whether or not this form is in create-mode.
     */
    public isCreateMode(): boolean {
        return this.mode === 'create' || this.mode === 'copy';
    }

    /**
     * Whether or not this form is in edit-mode.
     */
    public isEditMode(): boolean {
        return this.mode === 'edit' || this.mode === 'copy' || this.mode === 'create';
    }

    /**
     * Whether or not this form is in copy-mode.
     */
    public isCopyMode(): boolean {
        return this.mode === 'copy';
    }

    /**
     * Whether or not this form is in view-mode.
     */
    public isViewMode(): boolean {
        return this.mode === 'view';
    }
//endregion

    public constructor(
        @Inject(SchemaNavigator) public schema: SchemaNavigator,
        @Inject(ValidatorCache) public validators: ValidatorCache,
        @Inject('formMode') @Optional() public readonly mode: FormModes = 'edit',
        @Inject('formInitialValues') @Optional() public readonly initialValues?: any,
        @Inject('parentFieldContext') @Optional() private readonly parent?: FieldContextProvider,
        @Inject('translateMessageOrDefault') @Optional() private translateMessageOrDefault?: translateMessageOrDefaultFunc,
        @Inject(MessageBundle) @Optional() private messages?: MessageBundle,
    ) {
        this.sets = this.mapped = this._mapSchemaToFieldsets(initialValues);
        this.validator = validators.getValidator(schema);
    }

//region Schema Mapping
    /**
     * Define the field mapper (Is written with the "FormFieldSet" as the "this".)
     */
    private _mapFieldFromSchema(
        fieldsetId: string,
        field: ExtendedFieldDescriptor,
        initialValue: any
    ): FormFieldViewModel<FormField<any>> {
        var translationObj = this.translateField(fieldsetId, field);

        // Make sure the field.type is set.
        if (field.field.type == null || field.field.type === '') {
            field.field.type = this._resolveFieldType(field);
        }
        return <FormFieldViewModel<FormField<any>>> {
            label: translationObj.label,
            description: translationObj.description,
            validation: FieldContextProvider.createPristineFieldvalidationResult(),
            visible: true,
            instance: void 0,
            ctx: {
                id: (_.isEmpty(fieldsetId) ? defaultFieldsetId : fieldsetId) + '-' + field.name,
                name: field.name,
                pointer: field.pointer,
                required: field.isRequired,
                readonly: this.isViewMode(),
                initialValue: this.isCreateMode() || _.isEmpty(this.initialValues) ? field.default : initialValue,
                value: initialValue,
                meta: field
            } as FieldComponentContext<any>
        };
    }

    /**
     * Define the fieldset mapper.
     */
    private _mapFieldsetFromSchema(
        fields: ExtendedFieldDescriptor[],
        fieldsetId: string,
        initialValueSelector: initialFieldValueFetcher
    ): FormFieldSet {
        // Map fields.
        var mapped = _(fields)
            .map(definition =>
                this._mapFieldFromSchema(fieldsetId, definition, initialValueSelector(definition)))
            .value();
        debug('mapped fields from the schema:', _.map(mapped, x => x.ctx.name));

        return <FormFieldSet> {
            id: _.isEmpty(fieldsetId) ? defaultFieldsetId : fieldsetId,
            label: this.translateFieldsetLabel(fieldsetId),
            fields: mapped
        };
    }

    /**
     * Map the current schema object to the locally set fieldsets and fields.
     *
     * @param schema Schemanavigator to fetch the fields from.
     * @param initialValues An array containing the initial values for the form fields.
     * @return void
     */
    private _mapSchemaToFieldsets(initialValues?: any): FormFieldSet[] {
        // Fetch the schema so we now the location of the initial values per field, and the fieldsets.
        return _.map(this.schema.fieldsets, (fields, fieldsetId) =>
            this._mapFieldsetFromSchema(fields, this.schema.entity + '_' + fieldsetId, this.getFieldInitialValue.bind(this)));
    }
//endregion

//region State management
    /**
     * Reset every initialized instance to it's initial value.
     */
    public reset(): void {
        this.each(x => !!x.instance && x.instance.reset());
    }

    /**
     * Create an clone of this field context provider using the given initialValues.
     *
     * @param initialValues The new initial values for the clone.
     * @param mode The form mode for the clone.
     *
     * @return Cloned field context provider.
     */
    public clone(initialValues?: any, mode: FormModes = this.mode): FieldContextProvider {
        var sibbling = new FieldContextProvider(this.schema, this.validators, mode, initialValues, this.parent, this.translateMessageOrDefault, this.messages);
        sibbling.visible = this.visible;
        return sibbling;
    }
//endregion

//region Field (default) values
    /**
     * Get the initial value for the given field.
     */
    public getFieldInitialValue(field: ExtendedFieldDescriptor): any {
        if (_.isEmpty(this.initialValues)) {
            return void 0;
        }

        try {
            return pointer.get(this.initialValues, field.pointer);
        }
        catch (e) {
            if (field.isRequired) {
                debug(`getFieldInitialValue: something went wrong fetching the initial value for the required field "${field.id}" on path [${field.pointer}].`, e);
            }
            return null;
        }
    }

    /**
     * Get the value of the field with the given id.
     *
     * @param fieldId Field identity.
     */
    public getFieldValue(matcher: (field: FormFieldViewModel<FormField<any>>) => boolean): any {
        var field = this.find(matcher);
        if (field && field.instance) {
            return field.instance.value;
        }

        return this.getFieldInitialValue(field.ctx.meta);
    }

    /**
     * Get the value of the field with the given id.
     *
     * @param fieldId Field identity.
     */
    public getFieldValueById(fieldId: string): any {
        return this.getFieldValue(x => x.ctx.id === fieldId);
    }

    /**
     * Get the value of the field with the given id.
     *
     * @param fieldName
     */
    public getFieldValueByName(fieldName: string): any {
        var field = this.find(x => x.ctx.name === fieldName);
        if (field && field.instance) {
            return field.instance.value;
        }

        if (_.isEmpty(this.initialValues)) {
            return void 0;
        }

        try {
            return this.schema.getPropertyValue(fieldName, this.initialValues);
        }
        catch (e) {
            debug(`getFieldValueByName: something went wrong fetching the initial value for the field "${fieldName}".`, e);
            return null;
        }
    }

    /**
     * Get the value of the field located at the given pointer.
     *
     * @param pointer
     */
    public getFieldValueByPointer(pointer: string): any {
        return this.getFieldValue(x => x.ctx.pointer === pointer);
    }
//endregion

    /**
     * Find the field type for the given form field.
     * @return string the field.type
     */
    private _resolveFieldType(descriptor: ExtendedFieldDescriptor): string {
        if (!!descriptor.field.type) {
            return descriptor.field.type;
        }

        // Add and remove field types here.
        if (descriptor.enum != null) {
            return 'EnumDropdownField';
        }
        else if (descriptor.type === 'object' && descriptor.patternProperties != null) {
            return 'ShopsFormField';
        }
        else if (descriptor.type === 'string') {
            if (descriptor.format === 'date-time' || descriptor.format === 'iso8601')
                return 'DateTimeField';
            else
                return 'TextField';
        }
        else if (descriptor.type === 'integer' || descriptor.type === 'number') {
            return 'NumericField';
        }
        else if (descriptor.type === 'boolean') {
            return 'CheckboxField';
        }

        // Safe default (turns into a JSON editor for unknwon subschemas)
        return 'LargeTextField';
    }

//region Form validation
    /**
     * Validates the form field asynchronously, and sets the viewmodel's validation result object.
     */
    public validateField(field: FormFieldViewModel<FormField<any>>): Promise<FormFieldValidationResult> {
        if (field.instance == null) {
            return Promise.resolve(field.validation = FieldContextProvider.createPristineFieldvalidationResult());
        }

        try {
            var requiredState = this._validateRequiredField(field);
            if (requiredState != null) {
                return Promise.resolve(field.validation = requiredState);
            }

            if ((<ValidatableFormField<any>>field.instance).validate) {
                // Allow the field to handle the validation.
                return Promise.resolve<FormFieldValidationResult>((<ValidatableFormField<any>>field.instance).validate()).then(x => field.validation = x);
            }

            return this.validator
                .then(x => x.validateProperty(field.ctx.name, field.instance.value))
                .then(valid => {
                    if (!valid.valid) {
                        return field.validation = {
                            message: _(valid.errors)
                                .map(err => this.translateValidationMessage(err))
                                .join(', '),
                            valid: false,
                            level: ValidationLevel.Error
                        };
                    }

                    return field.validation = {
                        message: null,
                        valid: true,
                        level: ValidationLevel.Success
                    };
                });
        }
        catch (e) {
            debug('something went wrong while validating field', field.ctx.name);
            return Promise.reject<FormFieldValidationResult>(e);
        }
    }

    /**
     * Validates the required state of a field.
     *
     * @return Returns a formfield validation result if the field validation state can be determined by it's required state, or null otherwise.
     */
    private _validateRequiredField(field: FormFieldViewModel<FormField<any>>): FormFieldValidationResult {
        if (this._validationResultIsEmpty(field)) {
            if (field.ctx.required === true) {
                // Value is required and the field is empty.
                return field.validation = {
                    message: 'Dit veld heeft een waarde nodig.',
                    valid: false,
                    level: ValidationLevel.Error
                };
            }
            else {
                // Validation is not required, because the value can be empty, so well just ignore validation if its not required.
                return field.validation = FieldContextProvider.createPristineFieldvalidationResult();
            }
        }
        return null;
    }

    /**
     * Check whether or not the field value is considered empty by validation.
     */
    private _validationResultIsEmpty(field: FormFieldViewModel<FormField<any>>): boolean {
        if (field.instance == null) {
            return field.ctx.initialValue == null;
        }

        if (field.instance.value === null || typeof field.instance.value === 'undefined') {
            return true;
        }
        switch (field.ctx.meta.type) {
            case 'string':
                return (field.instance.value.length <= 0);
            case 'integer':
            case 'number':
                return (field.instance.value == null);
            //case 'object':
            //    return _.isPlainObject(field.instance.value);
            case 'array':
                return _.isEmpty(field.instance.value);
            default:
                return false;
        }
    }

    /**
     * Force validation on all fields asynchronously.
     */
    public validate(): Promise<FormFieldValidationResult[]> {
        return Promise.all(
            _.flatMap(this.sets, set =>
                _.map(set.fields, field => this.isFieldAvailable(field) ? this.validateField(field) : FieldContextProvider.createPristineFieldvalidationResult())));
    }

    /**
     * Set the validation state for a field with the given name.
     */
    public setFieldValidationState(name: string, valid: boolean, message?: string, level: ValidationLevel = ValidationLevel.Warning): boolean {
        var field = this.find(x => x.ctx.name === name);
        if (field == null) {
            return false;
        }
        field.validation = {
            message: message,
            valid: valid,
            level: !!valid ? ValidationLevel.Success : level
        };
        return true;
    }

    /**
     * Generates an empty/pristine validation result.
     */
    public static createPristineFieldvalidationResult(): FormFieldValidationResult {
        return {
            message: null,
            valid: true,
            level: ValidationLevel.Pristine
        };
    }
//endregion

//region Field and fieldset iteration helpers
    /**
     * Find a field by it's property name.
     */
    public find(matcher: (field: FormFieldViewModel<FormField<any>>) => boolean): FormFieldViewModel<FormField<any>> {
        var i = 0, j = 0, numFields = 0;
        var numSets = this.sets.length;
        while (i < numSets) {
            numFields = this.sets[i].fields.length;
            j = 0;
            while (j < numFields) {
                if (matcher(this.sets[i].fields[j]) === true)
                    return this.sets[i].fields[j];
                j++;
            }
            i++;
        }

        return null;
    }

    /**
     * Iterates over all fields in the form.
     */
    public each(iterator: (item: FormFieldViewModel<FormField<any>>) => void, visibleOnly: boolean = true): void {
        var i = 0, j = 0, numFields = 0,
            sets = visibleOnly ? this.mapped : this.sets,
            numSets = this.sets.length;
        while (i < numSets) {
            numFields = sets[i].fields.length;
            j = 0;
            while (j < numFields) {
                iterator(sets[i].fields[j]);
                j++;
            }
            i++;
        }
    }

    /**
     * Extract information from all the fields.
     *
     * @param iterator The iterator that will extract the information.
     * @param visibleOnly Whether or not to only iterate over visible fields.
     *
     * @return The extracted information.
     */
    public extract<T>(iterator: (item: FormFieldViewModel<FormField<any>>) => T, visibleOnly: boolean = true): T[] {
        var i = 0, j = 0, numFields = 0,
            sets = visibleOnly ? this.mapped : this.sets,
            numSets = this.sets.length,
            result = [];
        while (i < numSets) {
            numFields = sets[i].fields.length;
            j = 0;
            while (j < numFields) {
                result.push(iterator(sets[i].fields[j]));
                j++;
            }
            i++;
        }
        return result;
    }

    /**
     * Checks whether the given field is loaded, and if loaded, whether it's done loading.
     */
    public isFieldAvailable(field: FormFieldViewModel<any>): boolean {
        // undefined = busy initializing by directive
        // null = Field was not avialable, cant be initialized.
        // FormField<any> = Field is initialized, and can be considered loaded when "loading" is set to a falsy value.
        return field.instance === null || (field.instance !== null && field.instance !== void 0 && !field.instance.loading);
    }

    /**
     * Set the field visibility per field.
     *
     * @param iterator
     */
    private changeFieldVisibility(iterator: (field: Readonly<FormFieldViewModel<any>>) => boolean): void {
        this.each(x => x.visible = iterator(x));
        (this as any).sets = this.mapped
            .map(x => ({
                    id: x.id,
                    label: x.label,
                    fields: x.fields.filter(y => y.visible),
                } as FormFieldSet))
            .filter(x => x.fields.length > 0);
    }
//endregion

//region Field(set) translation
    /**
     * Translate the title of a fieldset.
     */
    private translateFieldsetLabel(fieldsetId: string): string {
        return this.translateToken([String(fieldsetId).toLowerCase() + '_fieldset_title']);
    }

    /**
     * Translate the field using one of the available translation strategies.
     */
    private translateField(fieldsetId: string, field: ExtendedFieldDescriptor): { label: string, description: string } {
        var schemaMessages = {
            label: this.schema.getFieldTitle(field.name),
            description: this.schema.getFieldDescription(field.name),
        };

        if (!this.translateMessageOrDefault && !this.messages) {
            return schemaMessages;
        }

        var result: { label: string[], description: string[] } = { label: [], description: [] },
            entity = this.schema.entity;

        if (field.name == null) {
            throw new Error('The field.name is required to generate translation tokens.');
        }

        // Generate title token
        if (!!entity && !_.isEmpty(fieldsetId) && fieldsetId !== 'default') {
            if (_.startsWith(fieldsetId, entity)) {
                result.label.push((fieldsetId + '_' + field.name + '_label').toLowerCase());
            }
            else {
                result.label.push((entity + '_' + fieldsetId + '_' + field.name + '_label').toLowerCase());
            }
        }
        if (!!entity) {
            result.label.push((entity + '_' + field.name + '_label').toLowerCase());
        }
        result.label.push(field.name.toLowerCase() + '_label');

        // find description token
        if (!!entity && !_.isEmpty(fieldsetId) && fieldsetId !== 'default') {
            if (_.startsWith(fieldsetId, entity)) {
                result.description.push((fieldsetId + '_' + field.name + '_description').toLowerCase());
            }
            else {
                result.description.push((entity + '_' + fieldsetId + '_' + field.name + '_description').toLowerCase());
            }
        }
        if (!!entity) {
            result.description.push((entity + '_' + field.name + '_description').toLowerCase());
        }
        result.description.push(field.name.toLowerCase() + '_description');

        return {
            label: this.translateToken(result.label, schemaMessages.label),
            description: this.translateToken(result.description, schemaMessages.description),
        };
    }

    /**
     * Translate the error given back by the validation backends.
     */
    private translateValidationMessage(mess: ValidationError): string {
        //@todo implement translation for error messages
        return mess.message;
    }

    /**
     * Translate token.
     *
     * @param tokens
     */
    private translateToken(tokens: string[], defaultValue?: string): string {
        if (this.translateMessageOrDefault) {
            return this.translateMessageOrDefault(tokens, defaultValue);
        }
        else if (this.messages) {
            var messages = this.messages.getMessages();
            return messages.find(z => z.id === tokens.find(x => _.some(messages, y => y.id === x))).description;
        }
    }
//endregion

//region Data retrieval methods
    /**
     * Get the identity of the current item.
     */
    public getIdentity(): EntityIdentity {
        if (this.isCreateMode() || !this.initialValues) {
            return null;
        }
        try {
            return this.schema.getIdentityValue(this.initialValues);
        }
        catch(e) {
            return null;
        }
    }

    /**
     * Get the data object for the form.
     *
     * @param changedOnly Whether or not to only include the properties that have changed.
     * @return The form's data model (Untested).
     */
    public getData(changedOnly: boolean = true): any {
        // @todo maybe do something with JSON Paths here if this does not always apply.
        // @todo This code now assumes that all variables should always go in the root of the request object.
        var result: any = {};
        this.each(field => {
            if (!!field.instance && (changedOnly === false || !!field.instance.dirty)) {
                if (!!field.ctx.pointer) {
                    pointer.set(result, field.ctx.pointer, field.instance.value);
                }
                else if (field.ctx.required || (!field.ctx.required && field.instance.value !== '')) {
                    result[field.ctx.name || field.ctx.id] = field.instance.value;
                }
            }
            else if(!field.instance && changedOnly === false) {
                if (!!field.ctx.pointer) {
                    pointer.set(result, field.ctx.pointer, field.ctx.initialValue);
                }
                else {
                    result[field.ctx.name || field.ctx.id] = field.ctx.initialValue;
                }
            }
        });
        return result;
    }

    /**
     * Get the data for the form as a list of Json Patch objects.
     *
     * @param includeTests  (Optional, default: true) Whether or not to include tests for the old values in the patch object,
     *                      so that the data only get's altered if the old data is still the same.
     *
     * @return The form's data in the form of an patch object.
     */
    public getPatchOperations(includeTests: boolean = true): JsonPatchOperation[] {
        var result: any = [];
        this.each(field => {
            if (!!field.instance && !!field.instance.dirty) {
                // Check if the field instance implements PatchableFormField<T>
                if (!!(<PatchableFormField<any>>field.instance).getPatchOperations) {
                    // Let the field generate the ops
                    try {
                        var ops = (<PatchableFormField<any>>field.instance).getPatchOperations(includeTests);
                        if (!!ops) {
                            result = result.concat(ops);
                        }
                        else {
                            debug('getPatchObject: Got invalid patch operations list! Something went wrong?');
                        }
                    }
                    catch (e) {
                        debug(`getPatchObject: Retrieval of patch ops for field "${field.ctx.id}" went wrong: `, e);
                    }
                }
                else {
                    // Calculate the ops ourselves.
                    var path = field.ctx.pointer || '/' + field.ctx.name, iv;

                    try {
                        iv = pointer.get(this.initialValues, path);
                    }
                    catch (e) { }

                    if (field.instance.initialValue === void 0 || iv === void 0) {
                        result.push({ op: 'add', path: path, value: field.instance.value });
                    }
                    else {
                        if (includeTests) {
                            result.push({ op: 'test', path: path, value: field.instance.initialValue });
                        }
                        result.push({ op: 'replace', path: path, value: field.instance.value });
                    }
                }
            }
        });
        return result;
    }
//endregion

    /**
     * Create an field context provider form an schema and this instance's initial values.
     */
    public createChildFromNavigator(schema: SchemaNavigator): FieldContextProvider {
        var ctx = new FieldContextProvider(schema, this.validators, this.mode, this.initialValues, this, this.translateMessageOrDefault, this.messages);
        if (!_.isEmpty(this.visible)) {
            ctx.visible = this.visible;
        }
        return ctx;
    }

    /**
     * Create an field context provider form an agent and this instance's initial values.
     */
    public createChildFromAgent(agent: IRelatableSchemaAgent): FieldContextProvider {
        if (agent.parent.schema !== this.schema) {
            throw new Error('Given agent is not a child of the current one.');
        }
        return this.createChildFromNavigator(agent.schema);
    }

    /**
     * Create an field context provider form pointer resolving to a field in the current schema and this instance's initial values.
     */
    public createChildFromPointer(pointer: string): FieldContextProvider {
        var pnt = fixJsonPointerPath(pointer),
            sub = this.schema.getFieldDescriptorForPointer(pnt);

        // Check property validity
        if (sub.length === 0) {
            throw new Error(`Couldn\'t create a child field-context-provider, the pointer "${pointer}" most likely doesn\'t exist.`);
        }
        if (sub.length > 1) {
            // Friendly reminder about the successrate of this code-path
            debug(`[warn] PRE-ALPHA FUNCTIONALITY; having multiple definitions for a single field is not tested!`);
        }

        // Check if the field refers to an external schema.
        if (sub[0].$ref) {
            if (sub.length > 1) {
                console.warn(`PRE-ALPHA FUNCTIONALITY! having multiple schema definitions, with one external ref (especially if it is not embedded in the same schema, will most likely fail spectacularly.`);
            }

            var schema = this.validators.cache.getSchema(sub[0].$ref);
            if (schema == null) {
                throw new Error(`Unable to find the schema with id "${sub[0].$ref}" for child-context with pointer "${pointer}".`);
            }

            return this.createChildFromNavigator(new SchemaNavigator(schema, void 0, x => this.validators.cache.getSchema(x)));
        }

        // Create the child if it is embedded.
        return this.createChildFromNavigator(new SchemaNavigator(this.schema.original, pnt, x => this.validators.cache.getSchema(x)));
    }

    /**
     * Create an field context provider form an agent and some initial values.
     */
    public static createFromAgent(
        agent: EndpointSchemaAgent,
        trans: MessageBundle | translateMessageOrDefaultFunc,
        mode: FormModes = 'edit',
        initialValues?: any,
        parent?: FieldContextProvider
    ): FieldContextProvider {
        if (trans instanceof MessageBundle) {
            return new FieldContextProvider(agent.schema, agent.validators, mode, initialValues, parent, void 0, trans as MessageBundle);
        }
        return new FieldContextProvider(agent.schema, agent.validators, mode, initialValues, parent, trans as translateMessageOrDefaultFunc);
    }
}

export interface FormFieldSet {
    /**
     * Identifier string. (Without spaces etc.)
     */
    id: string;

    /**
     * The label as used in the UI.
     */
    label?: string;

    /**
     * All fields in the fieldset
     */
    fields: FormFieldViewModel<FormField<any>>[];
}

export interface FormFieldViewModel<T extends FormField<any>> {
    /**
     * Field label.
     */
    label: string;

    /**
     * Optionally, the localized field description.
     */
    description?: string;

    /**
     * Whether or not the field is visible, if it is invisible it *should* not be initialized at all versus just be visually hidden.
     */
    visible: boolean;

    /**
     * Validation report containing reports about the validity of the field.
     */
    validation: FormFieldValidationResult;

    /**
     * Instance of the field.
     *
     * Set once the field component is initialized.
     */
    instance?: T;

    /**
     * Instance of the field to track the value for the field etc.
     */
    ctx: FieldComponentContext<T>;
}

type initialFieldValueFetcher = (field: ExtendedFieldDescriptor) => any;

export type translateMessageOrDefaultFunc = (tokens: string[], placeholder?: string) => string;
