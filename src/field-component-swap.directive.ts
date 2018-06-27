import {
    Directive,
    Input,
    Output,
    EventEmitter,
    Type,
    OnDestroy,

    ComponentRef,
    ViewContainerRef,
    TemplateRef,

    ComponentFactoryResolver,
    ReflectiveInjector,
    ResolvedReflectiveProvider,
    Injector,
    Inject,
    InjectionToken,
    Optional,
} from '@angular/core';
import { IRelatableSchemaAgent } from 'json-schema-services';

import { FormField } from './models/form-field';
import { FieldComponentContext, fieldComponentContextToken } from './models/form-field-context';
import { LinkedDataProvider } from './linked-data-provider.service';
import { FormFieldService } from './form-field.service';
import { FieldContextProvider } from './field-context-provider.service';

import debuglib from 'debug';
import { CachedDataProvider } from './cached-data-provider.service';
const debug = debuglib('schema-ui:field-component-swapper');

/**
 * Field descriptor with properties specific to the form builder.
 */
export const formFieldDescriptorToken = new InjectionToken('ExtendedFieldDescriptorToken');

/**
 * Outlet for components to be loaded in.
 *
 * <ng-template [fieldComponentSwapper]="field.ctx" [swapCmpBindings]="fieldBindings" [swapCmpProjectables]="ctx.projectableNodes"></ng-template>
 */
@Directive({
    selector: '[fieldSwitch]'
})
export class FieldComponentSwitchDirective<T extends FormField<any>> implements OnDestroy {
    /**
     * Component that is loaded.
     */
    private component: Type<T>;

    /**
     * Reference to the loaded field component.
     */
    private componentRef: ComponentRef<T>;

    /**
     * Reference to the set context.
     */
    private context: FieldComponentContext<T>;

    /**
     * (Optionally) The injector to use to resolve dependencies.
     */
    @Input()
    public fieldSwitchInjector: Injector;

    /**
     * (Optionally) The bindings/injectables to add to the injector given above, or the injector injected into this binding.
     */
    @Input()
    public fieldSwitchBindings: ResolvedReflectiveProvider[] = [ ];

    /**
     * (Optionally) List of renderer elements to render inside the new component.
     */
    //@Input()
    //public fieldSwitchProjectables: any[][];

    /**
     * Event fired once the component is created.
     */
    @Output()
    public onCreate: EventEmitter<T> = new EventEmitter<T>(false);

    /**
     * The main setter that set's the context.
     */
    @Input()
    public set fieldSwitch(context: FieldComponentContext<T>) {
        if (!context.meta || !context.meta.field.type) {
            this.error('Unable to initialize; no field.type set on field meta.');
        }

        // If the same context was set again, ignore.
        if (this.context === context) {
            return;
        }

        // Refresh/get the component to initialize based on the meta-data (if we didnt already).
        if (!this.component || (!!this.context && this.context.meta.field.type !== context.meta.field.type)) {
            this.component = this.fields.getFieldComponentByName<T>(context.meta.field.type, this.fieldSwitchInjector || this.vcRef.parentInjector);
            if (!this.component) {
                this.error(`Component could not be found for field.type "${context.meta.field.type}".`);
                return;
            }
        }

        // Collect bindings for the injector.
        let bindings: ResolvedReflectiveProvider[];
        try {
            bindings = ReflectiveInjector.resolve([
                // Provide the form field descriptor if the field only needs that.
                { provide: formFieldDescriptorToken, useValue: context.meta },

                // Provide the form field context as provided to this binding.
                { provide: fieldComponentContextToken, useValue: context },

                // Provide the form field with an helper to retrieve linked field data.
                {
                    provide: LinkedDataProvider,
                    useFactory: linkedDataProviderFactory,
                    deps: ['ISchemaAgent', fieldComponentContextToken, CachedDataProvider, FieldContextProvider],
                }
            ]);
            if (Array.isArray(this.fieldSwitchBindings) && this.fieldSwitchBindings.length > 0) {
                bindings = bindings.concat(this.fieldSwitchBindings);
            }
        }
        catch (e) {
            this.error(`Unable to collect bindings for the injector (ReflectiveInjector.resolve) for field "${context.meta.field.type}".`, e);
            return;
        }

        // Construct the Injector needed to supply injection to the comopnent we will be creating.
        let injector = ReflectiveInjector.fromResolvedProviders(bindings, this.fieldSwitchInjector || this.vcRef.parentInjector);

        // Create component using factory resolver (if it is not registered as entry component, this will fail)
        try {
            var factory = this.cfr.resolveComponentFactory<T>(this.component);
        }
        catch(e) {
            this.error(`Unable to resolve the ComponentFactory for the component.
                This is probably because the component does not exist,
                is not set in the "entryComponents" list
                or is not included in the application bundle for some reason.`, e);
            return;
        }

        // Everything went o.k., we can clear the error message.
        this.vcRef.clear();

        // Create the component instance.
        this.componentRef = this.vcRef.createComponent<T>(
            factory,
            this.vcRef.length,
            injector,
            //this.swapCmpProjectables
        );
        debug(`fieldSwitch(): Created ref for field with id "${context.id}".`);

        // Make sure we reset once the component is destroyed.
        this.componentRef.onDestroy(() => {
            if (this.componentRef == null) {
                return;
            }

            debug('componentRef.onDestroy: Child component destroyed (not by us), propagated on self.');
            this.context = null;
            this.componentRef = null;
            this.component = null;
        });

        // Make sure the change detection cycle is started.
        this.componentRef.changeDetectorRef.detectChanges();

        // Notify the parent component that everything has succeeded, and he will get the instance.
        this.onCreate.emit(this.componentRef.instance);

        // Save the current context for comparisson next time.
        this.context = context;
    }

    public constructor(
        @Inject(ComponentFactoryResolver) private cfr: ComponentFactoryResolver,
        @Inject(ViewContainerRef) private vcRef: ViewContainerRef,
        @Inject(TemplateRef) private tRef: TemplateRef<Object>,
        @Inject(FormFieldService) private fields: FormFieldService,
    ) { }

    /**
     * Called when this component get's destroyed.
     */
    public ngOnDestroy(): void {
        if (!!this.componentRef) {
            // If our child still exists, destroy it too.
            this.componentRef.destroy();
            this.componentRef = null;
        }
    }

    /**
     * Throw an error message, and make the directive display it's errored state.
     */
    protected error(message: string, data?: any): void {
        debug('[warn] ' + message, data);
        console.warn('FieldComponentDirective: ' + message);
        this.onCreate.emit(null);
        this.onCreate.error(message);
        this.vcRef.createEmbeddedView<any>(this.tRef, { errorMessage: message });
    }
}

/**
 * Static, named factory function for the linked data provider.
 */
export function linkedDataProviderFactory(
    agent: IRelatableSchemaAgent,
    field: FieldComponentContext<FormField<any>>,
    provider: CachedDataProvider,
    context: FieldContextProvider,
): LinkedDataProvider {
    return new LinkedDataProvider(agent, field, provider, context);
}
