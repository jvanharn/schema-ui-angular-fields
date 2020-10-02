import { Inject, Injectable, Optional } from '@angular/core';
import { MessageBundle } from '@angular/compiler';
import { Subject, Subscription, timer } from 'rxjs';
import { debounce, map, bufferTime, filter } from 'rxjs/operators';
import {
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
    fixJsonPointerPath,
    JsonSchema,
    ValidationResult,
    IdentityValues,
    ISchemaCache,
    pointerGet,
    tryPointerGet,
    pointerSet,
    pointerRemove,
    pointerHas,
    isRelativeJsonPointer,
    isAbsoluteJsonPointer,
} from 'json-schema-services';

import { FormField, PatchableFormField } from './models/form-field';
import { FieldComponentContext, FormModes } from './models/form-field-context';
import { ValidatableFormField, FormFieldValidationResult, ValidationLevel, FormFieldsetFieldValidationResult } from './models/form-field-validation';
import {
    parseRelativePointer,
    parseAbsolutePointer,
    traverseFieldContextsWithRelativePointer,
    traverseFieldContextsWithAbsolutePointer,
} from './pointer-tools';

import * as _ from 'lodash';

import debuglib from 'debug';
const debug = debuglib('schema-ui:field-context-provider');

/**
 * Class that maintains a list of fieldsets and fields for a form builder.
 */
// @dynamic
@Injectable()
export class FieldContextProvider {
    /**
     * Validator used to validate fields in this context.
     */
    protected readonly validator: Promise<ISchemaValidator>;

    /**
     * List of all fieldsets and fields.
     */
    protected readonly mapped: FormFieldSet[];

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
        if (!Array.isArray(val)) {
            return;
        }
        this._visible = val as any;

        this.changeFieldVisibility(x => _.isEmpty(this._visible) || this._visible.indexOf(x.ctx.pointer) > -1);
    }
    private _visible: string[];

    /**
     * Setting to control whether when all fields are rendered we need to validate all fields.
     */
    public validateOnceReady: boolean = true;

//#region RX Event Emitters
    /**
     * An observable that emits the context of a field when it's value has changed.
     */
    public fieldChanged$: Subject<FormFieldViewModel<FormField<any>>> = new Subject();

    /**
     * An observable that emits the context of a fieldset when a field within it has it's value changed.
     */
    public fieldsetChanged$: Subject<FormFieldSet> = new Subject();

    /**
     * An observable that emits once any field instance in the form is ready, by the field-component-swap directive.
     *
     * @access protected
     * @ignore
     */
    public fieldReady$: Subject<FormFieldViewModel<FormField<any>>> = new Subject();

    /**
     * An observable that emits once all the instances in the form are ready.
     *
     * When the visibility changes and new instances are added, this value will be re-emitted!
     */
    public ready$: Subject<boolean> = new Subject();

    /**
     * Subscription that listens to fields that become ready.
     */
    private fieldReadySubscription: Subscription;

    /**
     * Subscription that listens to field-values changing, in order to update their validation status.
     */
    private fieldValidationSubscription: Subscription;

    /**
     * Subscription that listens to field-values changing, in order to notify fieldsetChanged$ of the change.
     */
    private fieldsetRedirectionSubscription: Subscription;

    /**
     * Subscription that listens to fieldsets that have one one their fields change values, in order to update their validation status.
     */
    private fieldsetValidationSubscription: Subscription;
//#endregion

//#region Form-mode check methods
    /**
     * Whether or not any fields are still loading.
     */
    public isLoading(): boolean {
        return !this.sets.every(
            set => set.fields.every(
                field => this.isFieldAvailable(field)));
    }

    /**
     * Whether or not any fields are still loading.
     */
    public isReady(): boolean {
        return this.sets.every(
            set => set.fields.every(
                field => this.isFieldReady(field)));
    }

    /**
     * Whether or not all values are valid, is true by default unless you force the validation execution.
     */
    public isValid(): boolean {
        return this.sets.every(
            set => set.validation.valid && set.fields.every(
                field => field.validation.valid));
    }

    /**
     * Whether or not any values have been changed.
     */
    public isDirty(): boolean {
        return this.sets.some(
            set => set.fields.some(
                // If the field hasnt initialized yet; it is not dirty, except when we are in create mode.
                field => this.isFieldReady(field) && !!field.instance.dirty));
    }

    /**
     * This value is true when no single value has been touched, and so not validators have been fired yet.
     */
    public isPristine(): boolean {
        return this.sets.every(
            set => set.fields.every(
                field => field.validation.level === ValidationLevel.Pristine));
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
//#endregion

    /**
     * @param schema The schema to generate the form context for.
     * @param validators The validators cache to fetch validators from.
     * @param mode The mode in which the form will operate.
     * @param initialValues The initial values of the form fields.
     * @param parent The parent context if applicable.
     * @param translateMessageOrDefault Method to translate messages with within the form/
     * @param messages An optional messagebundle instead of the translation function, to be used to translate labels and descriptions.
     */
    public constructor(
        @Inject(SchemaNavigator) public schema: SchemaNavigator,
        @Inject('ISchemaCache') public cache: ISchemaCache,
        @Inject(ValidatorCache) public validators: ValidatorCache,
        @Inject('formMode') @Optional() public readonly mode: FormModes = 'edit',
        @Inject('formInitialValues') @Optional() public readonly initialValues?: any,
        @Inject('parentFieldContext') @Optional() public readonly parent?: FieldContextProvider,
        @Inject('translateMessageOrDefault') @Optional() private translateMessageOrDefault?: translateMessageOrDefaultFunc,
        @Inject(MessageBundle) @Optional() private messages?: MessageBundle,
        @Inject('readonlyFields') @Optional() private readonlyFields?: string[],
    ) {
        this.sets = this.mapped = this._mapSchemaToFieldsets(initialValues);
        this._visible = this.extract(f => f.ctx.pointer);
        this.validator = validators.getValidator(schema);

        // Emit form ready events.
        var lastReadyState: boolean = false;
        this.fieldReadySubscription = this.fieldReady$.pipe(debounce(() => timer(50))).subscribe(() => {
            var isReady = this.isReady();
            if (isReady && !lastReadyState) {
                this.ready$.next(lastReadyState = true);
                debug(`form by id "${this.schema.schemaId}${this.schema.propertyPrefix}" is ready`);

                if (this.validateOnceReady) {
                    debug('doing initial validation because validateOnceReady = true..');
                    this.validate()
                        .then(results => debug(`initial validation run yielded ${results.length} errors`, results))
                        .catch(err => debug('initial validation run failed!', err));
                }
            }
            else if (!isReady && !!lastReadyState) {
                this.ready$.next(lastReadyState = false);
                debug(
                    `form by id "${this.schema.schemaId}${this.schema.propertyPrefix}" started reloading`,
                    this.extract(x => this.isFieldReady(x) ? null : x.ctx.pointer).filter(x => x != null));
            }
        });

        // Validate fields on change.
        this.fieldValidationSubscription = this.fieldChanged$.subscribe(field => {
            this.validateField(field).catch(err => {
                debug(`[warn] on-change validation of field [${field.ctx.id}] failed: `, err);
            });
        });

        // Redirect and buffer field change events to the fieldset event emitter.
        this.fieldsetRedirectionSubscription = this.fieldChanged$
            .pipe(
                map(field => this.sets.find(x => x.fields.indexOf(field) > -1)),
                bufferTime(2000),
                filter(x => x.length > 0))
            .subscribe(sets =>
                this.augmentRedirectedFieldsetsWithParents(_.uniq(sets).filter(x => x != null))
                    .forEach(set => this.fieldsetChanged$.next(set)));

        // Validate whole fieldsets when one of it's fields changes.
        this.fieldsetValidationSubscription = this.fieldsetChanged$
            .subscribe(set =>
                this.validateFieldset(set, false).catch(err => {
                    debug(`[warn] on-change validation of fieldset [${set.id}] failed: `, err);
                }));
    }

//#region Schema Mapping
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
                readonly: this.isReadonlyField(field),
                initialValue: this.isCreateMode() || _.isEmpty(this.initialValues) ? this.getFieldDefaultValue(field) : initialValue,
                value: initialValue,
                meta: field
            } as FieldComponentContext
        };
    }

    /**
     * Define the fieldset mapper.
     */
    private _mapFieldsetFromSchema(
        fields: ExtendedFieldDescriptor[],
        fieldsetId: string,
        initialValueSelector: initialFieldValueFetcher,
    ): FormFieldSet {
        // Map fields.
        var mapped = fields.map(definition => this._mapFieldFromSchema(fieldsetId, definition, initialValueSelector(definition)));
        debug('mapped fields from the schema:', mapped.map(x => x.ctx.name));

        return <FormFieldSet> {
            id: _.isEmpty(fieldsetId) ? defaultFieldsetId : fieldsetId,
            label: this.translateFieldsetLabel(fieldsetId),
            pointer: '/' + _.intersection(...mapped.map(x => x.ctx.pointer.split('/').filter(x => x != null && x.length > 0))).join('/'),
            validation: FieldContextProvider.createPristineFieldvalidationResult(),
            fields: mapped,
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
            this._mapFieldsetFromSchema(fields, this.schema.entity + '_' + fieldsetId, this.getFieldInitialValue.bind(this)))
                .sort((a, b) => a.pointer === '/' ? -1 : (b.pointer === '/' ? 1 : 0)); // Make sure the default fieldset is always at the top.
    }
//#endregion

//#region State management
    /**
     * Reset every initialized instance to it's initial value.
     */
    public reset(): void {
        this.each(x => !!x.instance && x.instance.reset());
    }

    /**
     * Remove the instances for all fields in the current context.
     *
     * This instance can be reused after this operation.
     */
    public destroy(): void {
        this.each(field => field.instance = void 0);
        if (!this.fieldReadySubscription.closed) {
            this.fieldReadySubscription.unsubscribe();
        }
        if (!this.fieldValidationSubscription.closed) {
            this.fieldValidationSubscription.unsubscribe();
        }
        if (!this.fieldsetRedirectionSubscription.closed) {
            this.fieldsetRedirectionSubscription.unsubscribe();
        }
        if (!this.fieldsetValidationSubscription.closed) {
            this.fieldsetValidationSubscription.unsubscribe();
        }
        this.ready$.complete();
        this.fieldReady$.complete();
        this.fieldChanged$.complete();
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
        var sibbling = new FieldContextProvider(this.schema, this.cache, this.validators, mode, initialValues, this.parent, this.translateMessageOrDefault, this.messages);
        sibbling.visible = this.visible;
        return sibbling;
    }
//#endregion

//#region Field (default) values
    /**
     * Get the initial value for the given field.
     */
    public getFieldInitialValue(field: ExtendedFieldDescriptor): any {
        if (_.isEmpty(this.initialValues)) {
            return void 0;
        }

        var result: any;
        try {
            result = pointerGet(this.initialValues, field.pointer);
        }
        catch (e) {
            if (this.isCreateMode()) {
                var split = field.pointer.split('/');
                if (split.length > 2) {
                    var joined = split.slice(0, split.length - 1).join('/');
                    if (!pointerHas(this.initialValues, joined)) {
                        result = this.getFieldDefaultValue(field);
                    }
                }
            }

            //debug(`getFieldInitialValue: something went wrong trying to fetch the initialValue for the pointer "${field.pointer}".`, e);
        }

        if (result == null && field.isRequired) {
            debug(`getFieldInitialValue: something went wrong fetching the initial value for the required field "${field.id}" on path [${field.pointer}].`);
        }
        return result;
    }

    /**
     * Get the initial value for the given JSON-Pointer.
     */
    public getPointerInitialValue(pnt: string): any {
        if (_.isEmpty(this.initialValues)) {
            return void 0;
        }

        return tryPointerGet(this.initialValues, pnt);
    }

    /**
     * Get the default value for the given field, intelligently looking it up in the parent form.
     */
    public getFieldDefaultValue(field: ExtendedFieldDescriptor): any {
        if (this.isFieldParentIdentifier(field)) {
            // The property is an identifier of it's parent in create mode, fill it with the parent value.
            return this.parent.getFieldValueByName(field.name);
        }
        return field.default;
    }

    /**
     * Returns whether or not the given field represents the identity of it's parent form. (A parent child relation)
     */
    public isFieldParentIdentifier(field: ExtendedFieldDescriptor): boolean {
        return this.parent && this.isCreateMode() && this.parent.schema.identityProperties.indexOf(field.name) > -1 && field.name !== 'name' && field.name !== 'internalname';
    }

    /**
     * Check whether or not the field is readonly.
     *
     * @param field
     */
    public isReadonlyField(field: ExtendedFieldDescriptor): boolean {
        if (this.isViewMode() || this.isFieldParentIdentifier(field)) {
            return true;
        }

        if (Array.isArray(this.readonlyFields)) {
            return this.readonlyFields.indexOf(field.pointer) > -1;
        }

        return false;
    }

    /**
     * Get the value of the field with the given id.
     *
     * @param fieldId Field identity.
     */
    public getFieldValue(matcher: (field: FormFieldViewModel<FormField<any>>) => boolean): any {
        var field = this.find(matcher);
        if (field == null) {
            return void 0;
        }

        if (field.instance) {
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
     * @param pointer Absolute (incl. schema-id), relative or plain JSON-pointer.
     * @param relativeToPointer Relative to what path/field should the pointer be resolved, reuired for relative pointer support.
     */
    public getFieldValueByPointer(pointer: string, relativeToPointer: string = '/'): any | void {
        if (isRelativeJsonPointer(pointer)) {
            return traverseFieldContextsWithRelativePointer(parseRelativePointer(pointer), relativeToPointer, this);
        }
        else if (isAbsoluteJsonPointer(pointer)) {
            return traverseFieldContextsWithAbsolutePointer(parseAbsolutePointer(pointer), this);
        }

        var field = this.find(x => x.ctx.pointer === pointer);
        if (field == null) {
            return this.getPointerInitialValue(pointer);
        }

        if (field.instance) {
            return field.instance.value;
        }

        return this.getFieldInitialValue(field.ctx.meta);
    }
//#endregion

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
            return 'InlineTabField';
        }
        else if (
            descriptor.type === 'array' &&
            ((descriptor.items as JsonSchema)['type'] === 'object' || ((descriptor.items as JsonSchema[])[0] && (descriptor.items as JsonSchema[])[0].type === 'object'))
        ) {
            return 'InlineListField';
        }
        else if (
            descriptor.type === 'array' &&
            (   (descriptor.items as JsonSchema)['type'] === 'integer' || (descriptor.items as JsonSchema)['type'] === 'string' ||
                ((descriptor.items as JsonSchema[])[0] && (descriptor.items as JsonSchema[])[0].type === 'integer') ||
                ((descriptor.items as JsonSchema[])[0] && (descriptor.items as JsonSchema[])[0].type === 'string'))
        ) {
            return 'SelectField';
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

        // Safe default (turns into a JSON editor for unknown subschemas)
        return 'LargeTextField';
    }

//#region Form validation
    /**
     * Augment the given list of sets with any parent
     *
     * @param sets The sets that have changed values in the target schema.
     */
    private augmentRedirectedFieldsetsWithParents(sets: FormFieldSet[]): FormFieldSet[] {
        // If there are multiple fieldsets, make sure data parents are emitted as wel.
        if (this.sets.length > 1 && this.sets.length !== sets.length) {
            var setsLength = sets.length;
            for (var i = 0; i < setsLength; i++) {
                for (const orig of this.sets) {
                    if (sets[i].pointer.startsWith(orig.pointer) && sets.indexOf(orig) === -1) {
                        // This set is a parent (when looking at the data in the resulting schema) of the changed set,
                        // ...so it should be considered changed as well
                        sets.push(orig);
                    }
                }
            }
            return sets;
        }
        return sets;
    }

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
                .then(x => x.validatePointer(field.ctx.pointer, field.instance.value))
                .then(valid => {
                    if (!valid.valid) {
                        return field.validation = {
                            message: (valid.errors || [])
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
            return field.ctx.initialValue === null || typeof field.ctx.initialValue === 'undefined';
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
                return !Array.isArray(field.instance.value);
            default:
                return false;
        }
    }

    /**
     * Validate a single fieldset.
     *
     * @param set The set to validate.
     * @param validateFields Whether or not to revalidate fields if they were found to be valid last time.
     */
    public validateFieldset(set: FormFieldSet, validateFields: boolean = true): Promise<FormFieldsetFieldValidationResult[]> {
        var fields: Promise<FormFieldsetFieldValidationResult[]>;
        if (validateFields || set.validation.valid == false) {
            fields = Promise.all(_.map(set.fields, field => this.validateFieldsetField(field)));
        }
        else {
            fields = Promise.resolve([]);
        }

        return fields.then(results => {
            // Only validate the entire fieldset once all individual fields are valid.
            if (results.every(x => x.valid)) {
                var validation: Promise<ValidationResult>;
                if (set.pointer.length > 1) {
                    validation = this.validator.then(x => x.validatePointer(set.pointer, tryPointerGet(this.getData(set.id), set.pointer)));
                }
                else {
                    validation = this.validator.then(x => x.validate(this.getData()))
                }

                return validation.then(valid => {
                    if (!valid.valid) {
                        results.push(set.validation = {
                            pointer: set.pointer,
                            message: (valid.errors || [])
                                .map(err => this.translateValidationMessage(err))
                                .join(', '),
                            valid: false,
                            level: ValidationLevel.Error,
                        } as FormFieldsetFieldValidationResult);
                    }
                    else {
                        results.push(set.validation = {
                            pointer: set.pointer,
                            message: null,
                            valid: true,
                            level: ValidationLevel.Success,
                        } as FormFieldsetFieldValidationResult);
                    }

                    return results;
                });
            }
            return results;
        });
    }

    /**
     * Validate a field for a fieldset.
     *
     * Differs from the regular field validator, as it adds a path to the field that was validated.
     *
     * @param field The field to validate.
     */
    private validateFieldsetField(field: FormFieldViewModel<FormField<any>>): Promise<FormFieldsetFieldValidationResult> {
        if (!this.isFieldReady(field)) {
            return Promise.resolve(FieldContextProvider.createPristineFieldsetFieldvalidationResult(field.ctx.pointer));
        }

        return this.validateField(field).then((result: FormFieldsetFieldValidationResult) => {
            result.pointer = field.ctx.pointer;
            return result;
        });
    }

    /**
     * Force validation on all fields asynchronously.
     */
    public validate(): Promise<FormFieldsetFieldValidationResult[]> {
        return Promise.all(
            (this.sets as FormFieldSet[]).slice() // Make sure we sort a copy of the original.
                .sort((a, b) => a.pointer === '/' ? 1 : (b.pointer === '/' ? -1 : 0)) // Make sure the default fieldset is always checked last.
                .map(set => this.validateFieldset(set, true)) // Validate each fieldset.
        ).then(results => {
            // Make sure there are no duplicated errors in the root set.
            for (var set of this.sets) {
                if (set.pointer === '/') {
                    continue;
                }

                if (!set.validation.valid && set.validation.message === this.sets[0].validation.message) {
                    this.sets[0].validation = {
                        valid: true,
                        level: ValidationLevel.Success,
                        message: null,
                    };
                    break;
                }
            }
            return _.flatten(results); // Create one large list of the results.
        });
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

    /**
     * Generates an empty/pristine fieldset field validation result.
     */
    public static createPristineFieldsetFieldvalidationResult(pntr: string): FormFieldsetFieldValidationResult {
        return {
            pointer: pntr,
            message: null,
            valid: true,
            level: ValidationLevel.Pristine
        };
    }
//#endregion

//#region Field and fieldset iteration helpers
    /**
     * Find a field by it's property name.
     *
     * @param matcher A predicate to find the field with to retrieve.
     *
     * @return The form field view model.
     */
    public find(matcher: (field: FormFieldViewModel<FormField<any>>) => boolean): FormFieldViewModel<FormField<any>> | null {
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
     * Find a field's view model by it's JSON-pointer.
     *
     * @param pointer The JSON-Pointer of the field to find.
     *
     * @return The view model of the requested field or null when not found.
     */
    public findByPointer(pointer: string): FormFieldViewModel<FormField<any>> | null {
        return this.find(field => field.ctx.pointer === pointer);
    }

    /**
     * Iterates over all fields in the form.
     */
    public each(iterator: (item: FormFieldViewModel<FormField<any>>) => void, visibleOnly: boolean = true): void {
        var i = 0, j = 0, numFields = 0,
            sets = visibleOnly ? this.mapped : this.sets,
            numSets = sets.length;
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
            numSets = sets.length,
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
     * Extract information from all the fields.
     *
     * @param iterator The iterator that will extract the information.
     * @param visibleOnly Whether or not to only iterate over visible fields.
     *
     * @return The extracted information.
     */
    public extractSet<T>(iterator: (item: FormFieldSet) => T, visibleOnly: boolean = true): T[] {
        var sets = visibleOnly ? this.mapped : this.sets,
            i = 0, numSets = sets.length,
            result = [];
        while (i < numSets) {
            result.push(iterator(sets[i]));
            i++;
        }
        return result;
    }

    /**
     * Checks whether the given field is loaded, and if loaded, whether it's done loading.
     */
    public isFieldAvailable(field: FormFieldViewModel<any>): boolean {
        // undefined = busy initializing by directive
        // null = Field-type was not available, can't be initialized.
        // FormField<any> = Field is initialized, and can be considered loaded when "loading" is set to a falsy value.
        return field.instance === null || (field.instance !== null && field.instance !== void 0 && field.instance.loading !== true);
    }

    /**
     * Check whether the given field is visible, and if it is visible, whether it is loaded.
     *
     * If the field is not visible, it does not care about it's ready state, and will always return true.
     */
    public isFieldReady(field: FormFieldViewModel<any>): boolean {
        return !field.visible || (field.instance !== null && field.instance !== void 0);
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
                    pointer: x.pointer,
                    validation: x.validation,
                } as FormFieldSet))
            .filter(x => x.fields.length > 0);
    }
//#endregion

//#region Field information helpers
    /**
     * Whether or not the field with the given pointer will be rendered/visible to the user.
     */
    public isVisibleField(pointer: string): boolean {
        return (this.visible.indexOf(fixJsonPointerPath(pointer)) > -1);
    }
//#endregion

//#region Field(set) translation
    /**
     * Translate the title of a fieldset.
     */
    private translateFieldsetLabel(fieldsetId: string): string {
        const tokens = [String(fieldsetId).toLowerCase() + '_fieldset_title'];
        if (fieldsetId === defaultFieldsetId) {
            tokens.push('entity_' + this.schema.entity + '_name');
        }
        return this.translateToken(tokens);
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
        return this.translateToken(['validation_message_' + _.snakeCase(String(mess.code)).toLowerCase()], mess.message, mess.params);
    }

    /**
     * Translate token.
     *
     * @param tokens
     */
    private translateToken(tokens: string[], defaultValue?: string, params?: IdentityValues): string {
        if (this.translateMessageOrDefault) {
            return this.translateMessageOrDefault(tokens, defaultValue);
        }
        else if (this.messages) {
            var messages = this.messages.getMessages();
            return messages.find(z => z.id === tokens.find(x => _.some(messages, y => y.id === x))).description;
        }
    }
//#endregion

//#region Data retrieval methods
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
     * Get the complete edited data object, merged with the initialValue object.
     *
     * @param fieldsetId Get the data for a specific fieldset *ONLY*.
     *
     * @return The target schema's complete data object, merged with the iniitalValues. (So including properties that do not have a form field.)
     */
    public getData(fieldsetId?: string): any {
        var result: any = this.initialValues ? _.cloneDeep(this.initialValues) : {};

        for (var fieldset of this.sets) {
            if (fieldsetId != null && fieldset.id !== fieldsetId) {
                continue;
            }

            if (fieldset.pointer && fieldset.pointer.length > 1 && !pointerHas(result, fieldset.pointer)) {
                pointerSet(result, fieldset.pointer, {});
            }

            for (var field of fieldset.fields) {
                if (!field.ctx.pointer) {
                    throw new Error('The field by id "${field.ctx.id}" did not have a pointer set; this is required.');
                }

                if (!!field.instance) {
                    if (!this.isUndefinedValue(field)) {
                        pointerSet(result, field.ctx.pointer, field.instance.value);
                    }
                    else if (pointerHas(result, field.ctx.pointer)) {
                        pointerRemove(result, field.ctx.pointer);
                    }
                }
            }
        }

        return result;
    }

    /**
     * Get all values for all fields in the form (the form might not validate for the wrapped schema).
     *
     * Use this method when you update the form using partial JSON Objects when creating an object in a REST api, but it can fill in the defaults itself.
     * Or your forms always contain all properties as fields.
     *
     * @param fieldsetId Get the data for a specific fieldset *ONLY*.
     *
     * @return The form's data model.
     */
    public getFieldData(fieldsetId?: string): any {
        var result: any = {};

        for (var fieldset of this.sets) {
            if (fieldsetId != null && fieldset.id !== fieldsetId) {
                continue;
            }

            if (fieldset.pointer && fieldset.pointer.length > 1 && !pointerHas(result, fieldset.pointer)) {
                pointerSet(result, fieldset.pointer, {});
            }

            for (var field of fieldset.fields) {
                if (!field.ctx.pointer) {
                    throw new Error('The field by id "${field.ctx.id}" did not have a pointer set; this is required.');
                }

                if (!!field.instance) {
                    if (!this.isUndefinedValue(field)) {
                        pointerSet(result, field.ctx.pointer, field.instance.value);
                    }
                    else if (pointerHas(result, field.ctx.pointer)) {
                        pointerRemove(result, field.ctx.pointer);
                    }
                }
                else {
                    if (!!field.ctx.pointer) {
                        pointerSet(result, field.ctx.pointer, field.ctx.initialValue);
                    }
                    else {
                        result[field.ctx.name || field.ctx.id] = field.ctx.initialValue;
                    }
                }
            }
        }

        return result;
    }

    /**
     * Get an object containing only the values of any changed fields.
     */
    public getChangedFieldData(): any {
        var result: any = {};

        for (var fieldset of this.sets) {
            for (var field of fieldset.fields) {
                if (!field.ctx.pointer) {
                    throw new Error('The field by id "${field.ctx.id}" did not have a pointer set; this is required.');
                }

                if (!!field.instance && !!field.instance.dirty && !this.isUndefinedValue(field)) {
                    pointerSet(result, field.ctx.pointer, field.instance.value);
                }
            }
        }

        return result;
    }

    /**
     * Check whether the field value is an empty/voidable value.
     *
     * @param field The field to check.
     */
    private isUndefinedValue(field: FormFieldViewModel<FormField<any>>): boolean {
        if (field.ctx.required) {
            return false;
        }

        var val = field.instance.value;
        switch (field.ctx.meta.type) {
            case 'integer':
                return val === null || val === void 0;
            case 'string':
                return val === '';
            case 'array':
                return val == null || val.length === 0;
            default:
                return false;
        }
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
                        iv = pointerGet(this.initialValues, path);
                    }
                    catch (e) { }

                    var initEmpty = field.instance.initialValue === void 0 || iv === void 0, changeEmpty = field.instance.value === void 0;

                    if (initEmpty && !changeEmpty) {
                        result.push({ op: 'add', path, value: field.instance.value });
                    }
                    else if (!initEmpty && changeEmpty) {
                        if (includeTests) {
                            result.push({ op: 'test', path, value: field.instance.initialValue });
                        }
                        result.push({ op: 'remove', path });
                    }
                    else {
                        if (includeTests) {
                            result.push({ op: 'test', path, value: field.instance.initialValue });
                        }
                        result.push({ op: 'replace', path, value: field.instance.value });
                    }
                }
            }
        });
        return result;
    }
//#endregion

    /**
     * Create an field context provider form an schema and this instance's initial values.
     *
     * @param schema Schema navigator to create the child for.
     * @param pntr The json-pointer pointing to the field that the schema is created for.
     */
    protected createChildFromNavigator(schema: SchemaNavigator, pntr: string): FieldContextProvider {
        // Get all relevant information for the given pointer field or it's parent, and base the mode on it.
        var field: FormFieldViewModel<FormField<any>> = this.findByPointer(pntr),
            isMultiDef = false,
            selector: string;
        if (field == null) {
            var spliced = pntr.split('/');
            selector = spliced.pop();
            field = this.findByPointer(spliced.join('/'));
            isMultiDef = true;

            if (field == null) {
                throw new Error(`The given field "${pntr}" does not exist on this form! Cannot create a child form context for it.`);
            }
        }

        // Determine initial values.
        var initialValues: any = this.initialValues;

        // Determine if it is a newly rooted schema (outlined), or if it is a sub-schema of this form's schema (inlined)
        var outlined = this.schema.original.id !== schema.original.id || schema.propertyPrefix === '/';

        // When the entity is outlined, use the field value as initial values, otherwise, the initial values of this form
        if (outlined) {
            if (field.instance != null) {
                initialValues = field.instance.value;
            }
            else if (field.ctx.value) {
                initialValues = field.ctx.value;
            }
            else {
                initialValues = field.ctx.initialValue;
            }

            if (isMultiDef) {
                initialValues = initialValues[selector];
            }
        }
        else if (!this.isLoading()) {
            initialValues = this.getData();
        }

        // Determine the mode to create it in
        var mode = this.mode;
        if (field.ctx.readonly) { // The field is readonly, and therefore all it's children will be too.
            mode = 'view';
        }
        else if (isMultiDef && (
            (!outlined && !pointerHas(initialValues, pntr)) ||
            (!!outlined && !pointerHas(this.initialValues, pntr))
        )) { // The key doesn't yet exist, and is therefore new.
            mode = 'create';
        }

        // Create the child context
        var ctx = new FieldContextProvider(schema, this.cache, this.validators, mode, initialValues, this, this.translateMessageOrDefault, this.messages);

        // Copy the visible properties that are relevant.
        if (!_.isEmpty(this.visible)) {
            var applicable = this.visible.filter(x => x.startsWith(pntr));
            if (schema.propertyPrefix === pntr + '/') {
                ctx.visible = applicable;
            }
            else {
                ctx.visible = applicable.map(x => x.substr(pntr.length));
            }
        }

        return ctx;
    }

    /**
     * Create an field context provider form an agent and this instance's initial values.
     */
    public createChildFromAgent(agent: IRelatableSchemaAgent, pointer: string): FieldContextProvider {
        if (agent.parent.schema !== this.schema) {
            throw new Error('Given agent is not a child of the current one.');
        }
        return this.createChildFromNavigator(agent.schema, pointer);
    }

    /**
     * Create an field context provider form pointer resolving to a field in the current schema and this instance's initial values.
     *
     * @param pointer The JSON-Pointer pointing to the field to create an child context for.
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

            var schema = this.cache.getSchema(sub[0].$ref);
            if (schema == null) {
                throw new Error(`Unable to find the schema with id "${sub[0].$ref}" for child-context with pointer "${pointer}".`);
            }

            return this.createChildFromNavigator(new SchemaNavigator(schema, void 0, x => this.cache.getSchema(x)), pnt);
        }

        // Create the child if it is embedded.
        return this.createChildFromNavigator(new SchemaNavigator(this.schema.original, pnt, x => this.cache.getSchema(x)), pnt);
    }

    /**
     * Create an field context provider form an agent and some initial values.
     */
    public static createFromAgent(
        agent: EndpointSchemaAgent,
        trans: MessageBundle | translateMessageOrDefaultFunc,
        mode: FormModes = 'edit',
        initialValues?: any,
        parent?: FieldContextProvider,
        readonlyFields?: string[],
    ): FieldContextProvider {
        if (trans instanceof MessageBundle) {
            return new FieldContextProvider(agent.schema, agent['cache'], agent.validators, mode, initialValues, parent, void 0, trans as MessageBundle, readonlyFields);
        }
        return new FieldContextProvider(agent.schema, agent['cache'], agent.validators, mode, initialValues, parent, trans as translateMessageOrDefaultFunc, void 0, readonlyFields);
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
     * Pointer to the common root for all fields contained with it.
     */
    pointer: string;

    /**
     * Validation report containing reports about the validity of the field.
     */
    validation: FormFieldValidationResult;

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
     *
     * undefined = busy initializing by directive
     * null = Field was not avialable, cant be initialized.
     * FormField<any> = Field is initialized, and can be considered loaded when "loading" is set to a falsy value.
     */
    instance?: T;

    /**
     * Instance of the field to track the value for the field etc.
     */
    ctx: FieldComponentContext;
}

type initialFieldValueFetcher = (field: ExtendedFieldDescriptor) => any;

export type translateMessageOrDefaultFunc = (tokens: string[], placeholder?: string, params?: IdentityValues) => string;
