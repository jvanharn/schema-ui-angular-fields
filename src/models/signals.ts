import { OpaqueToken } from '@angular/core';
/**
 * All signaltypes for handling non-normal form states.
 */

/**
 * Form signalling event emitter token.
 *
 * Allows the form to supply the fields with an event emitter which can be used to emit events.
 */
export const formSignalEventEmitterToken = new OpaqueToken('formSignalEventEmitter');

/**
 * Signal send by a field to a form implementation.
 */
export class Signal { }

/**
 * The state of the form has been altered in such a way that the state has been completely invalidated and must be (force-)reloaded.
 * E.g. without confirmation to the user.
 */
export class FormInvalidationSignal extends Signal { }

/**
 * The user or some component performed an action that cancelled the opening of the form, and the component should navigate away from this form.
 */
export class FormCancelationSignal extends Signal { }
